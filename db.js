import mysql from 'mysql2/promise';
import Redis from 'ioredis';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { fileURLToPath } from 'url';
import { getAgentVersion } from './agent-artifacts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let pool = null;
let isConnected = false;
let redisClient = null;
let isRedisConnected = false;

// ---------------- REDIS CACHE INITIALIZATION ----------------
export function initRedisClient() {
  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  try {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      retryStrategy: (times) => (times <= 3 ? 1000 : null),
      lazyConnect: true
    });

    redisClient.on('connect', () => {
      isRedisConnected = true;
      console.log('✅ Redis Cache connected successfully!');
    });

    redisClient.on('error', (err) => {
      isRedisConnected = false;
      // Silent warning for graceful degradation
    });

    redisClient.connect().catch(() => {
      isRedisConnected = false;
    });
  } catch (err) {
    isRedisConnected = false;
  }
}

export async function cacheGet(key) {
  if (!isRedisConnected || !redisClient) return null;
  try {
    const val = await redisClient.get(key);
    return val ? JSON.parse(val) : null;
  } catch (e) {
    return null;
  }
}

export async function cacheSet(key, value, ttlSec = 30) {
  if (!isRedisConnected || !redisClient) return false;
  try {
    await redisClient.set(key, JSON.stringify(value), 'EX', ttlSec);
    return true;
  } catch (e) {
    return false;
  }
}

export async function cacheDel(key) {
  if (!isRedisConnected || !redisClient) return false;
  try {
    await redisClient.del(key);
    return true;
  } catch (e) {
    return false;
  }
}

export async function cacheDelPattern(pattern) {
  if (!isRedisConnected || !redisClient) return false;
  try {
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) {
      await redisClient.del(...keys);
    }
    return true;
  } catch (e) {
    return false;
  }
}

// ---------------- MYSQL INITIALIZATION & RESILIENCE ----------------
let isConnecting = false;
let dbHealthCheckTimer = null;

export async function attemptConnection() {
  if (isConnecting) return isConnected;
  isConnecting = true;

  const host = process.env.DB_HOST || '127.0.0.1';
  const user = process.env.DB_USER || 'itk_user';
  const password = process.env.DB_PASSWORD || 'itk_password_2026';
  const database = process.env.DB_NAME || 'it_toolkit';
  const port = parseInt(process.env.DB_PORT || '3306', 10);
  const poolSize = parseInt(process.env.DB_POOL_SIZE || '20', 10);

  if (pool) {
    try {
      await pool.end();
    } catch (_) {}
    pool = null;
  }

  try {
    const newPool = mysql.createPool({
      host,
      port,
      user,
      password,
      database,
      waitForConnections: true,
      connectionLimit: poolSize,
      queueLimit: 0,
      multipleStatements: true,
      connectTimeout: 8000
    });

    // Handle unexpected pool errors to log and attempt reconnection instead of crashing
    newPool.on('error', (err) => {
      console.error('⚠️ MySQL pool runtime error:', err.message);
      isConnected = false;
      attemptConnection().catch(e => console.error('Reconnection after pool error failed:', e.message));
    });

    try {
      await newPool.query('SELECT 1 + 1 AS solution');
    } catch (conErr) {
      if ((conErr.code === 'ECONNREFUSED' || conErr.message?.includes('ECONNREFUSED')) && (host === '127.0.0.1' || host === 'localhost')) {
        try {
          const { execSync } = await import('node:child_process');
          execSync('/etc/init.d/mariadb start', { stdio: 'ignore' });
          await new Promise(r => setTimeout(r, 1200));
          await newPool.query('SELECT 1 + 1 AS solution');
        } catch {
          throw conErr;
        }
      } else {
        throw conErr;
      }
    }

    pool = newPool;
    isConnected = true;
    isConnecting = false;
    console.log(`✅ Connected successfully to MySQL Database (${host}:${port}/${database}) [Pool size: ${poolSize}]!`);

    // Automatically synchronize schema & ensure seed records
    await runMigrationsAndSeed();
    return true;
  } catch (err) {
    isConnected = false;
    isConnecting = false;
    if (pool) {
      try { await pool.end(); } catch (_) {}
      pool = null;
    }
    throw err;
  }
}

export function startDbHealthCheck(intervalMs = 30000) {
  if (dbHealthCheckTimer) return dbHealthCheckTimer;
  dbHealthCheckTimer = setInterval(async () => {
    if (!isConnected) {
      console.log('🔄 Periodic DB health-check: retrying MySQL connection...');
      try {
        await attemptConnection();
        console.log('✅ DB recovered! Connected to MySQL Database.');
      } catch (err) {
        // Still down; will retry on next interval
      }
    } else if (pool) {
      try {
        await pool.query('SELECT 1');
      } catch (pingErr) {
        console.warn('⚠️ DB health-check ping failed, marking disconnected:', pingErr.message);
        isConnected = false;
      }
    }
  }, intervalMs);
  if (dbHealthCheckTimer.unref) dbHealthCheckTimer.unref();
  return dbHealthCheckTimer;
}

export function stopDbHealthCheck() {
  if (dbHealthCheckTimer) {
    clearInterval(dbHealthCheckTimer);
    dbHealthCheckTimer = null;
  }
}

export async function initDbPool(options = {}) {
  // Initialize Redis in background
  initRedisClient();

  // Start background worker for batched telemetry flush
  startTelemetryFlushWorker();

  // Always start periodic 30s health-check so disconnected DBs get picked up automatically
  startDbHealthCheck(options.healthCheckIntervalMs || 30000);

  if (isConnected && pool) {
    return true;
  }

  const defaultDelays = process.env.DB_RETRY_DELAYS
    ? process.env.DB_RETRY_DELAYS.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
    : (process.env.NODE_ENV === 'test' ? [50, 100, 150, 200, 250] : [2000, 4000, 8000, 16000, 32000]);

  const delays = options.retryDelays || defaultDelays;
  const attempts = options.maxAttempts || (delays.length + 1);

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      console.log(`[DB Boot] Connection attempt ${attempt}/${attempts}...`);
      await attemptConnection();
      return true;
    } catch (err) {
      console.log(`[DB Boot] MySQL connection attempt ${attempt}/${attempts} not ready: ${err.message}`);
      if (attempt < attempts) {
        const delay = delays[attempt - 1] || delays[delays.length - 1] || 2000;
        console.log(`[DB Boot] Retrying in ${delay}ms...`);
        await new Promise(res => setTimeout(res, delay));
      }
    }
  }

  console.log('[DB Boot] Initial DB connection attempts finished. Operating in resilient fallback mode; periodic background health-check active.');
  return false;
}

async function runMigrationsAndSeed() {
  return runDatabaseMigrations();
}

// ---------------- ENTERPRISE SCHEMA MIGRATION RUNNER ----------------
export async function runDatabaseMigrations() {
  if (!pool || !isConnected) {
    if (memAppliedMigrations.size === 0) {
      memAppliedMigrations.add('001');
      memAppliedMigrations.add('002');
      memAppliedMigrations.add('003');
    }
    return { applied: [], skipped: ['001_init_schema.sql', '002_partitioning.sql', '003_rbac_and_audit.sql'], status: 'FALLBACK_MODE' };
  }

  let lockAcquired = false;
  const result = { applied: [], skipped: [] };

  try {
    // 1. Acquire distributed advisory lock to prevent concurrent execution across instances
    try {
      const [lockRows] = await pool.query("SELECT GET_LOCK('itk_schema_migrations_lock', 15) AS locked");
      lockAcquired = lockRows && lockRows[0] && lockRows[0].locked === 1;
      if (!lockAcquired) {
        console.warn('⚠️ [Migrations] Advisory lock timeout (15s); another instance is currently migrating.');
        return { applied: [], skipped: [], error: 'LOCK_TIMEOUT' };
      }
    } catch (lockErr) {
      console.warn('⚠️ [Migrations] Advisory lock check note:', lockErr.message);
    }

    // 2. Ensure schema_migrations tracking table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`schema_migrations\` (
        \`version\` VARCHAR(64) NOT NULL,
        \`name\` VARCHAR(255) NOT NULL,
        \`applied_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`execution_time_ms\` INT NOT NULL DEFAULT 0,
        \`checksum\` VARCHAR(64) NULL,
        PRIMARY KEY (\`version\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 3. Fetch already applied versions
    const [appliedRows] = await pool.query("SELECT version FROM `schema_migrations`");
    const appliedVersions = new Set((appliedRows || []).map(r => String(r.version)));

    // 4. Discover and order migration files
    const migrationsDir = path.join(__dirname, 'database', 'migrations');
    if (!fs.existsSync(migrationsDir)) {
      console.warn('⚠️ [Migrations] Directory not found:', migrationsDir);
      return result;
    }

    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql') && !f.startsWith('.'))
      .sort();

    for (const file of migrationFiles) {
      const version = file.split('_')[0];
      if (appliedVersions.has(version)) {
        result.skipped.push(file);
        continue;
      }

      console.log(`[Migrations] Applying migration: ${file}...`);
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      const hash = crypto.createHash('sha256').update(sql).digest('hex');

      const t0 = Date.now();
      await pool.query(sql);
      const elapsed = Date.now() - t0;

      await pool.query(
        "INSERT INTO `schema_migrations` (`version`, `name`, `execution_time_ms`, `checksum`, `applied_at`) VALUES (?, ?, ?, ?, NOW(3))",
        [version, file, elapsed, hash]
      );

      result.applied.push({ version, name: file, execution_time_ms: elapsed });
      appliedVersions.add(version);
      memAppliedMigrations.add(version);
      console.log(`[Migrations] ✅ Applied ${file} in ${elapsed}ms (checksum: ${hash.slice(0, 8)})`);
    }

    // 5. Ensure device_uid column and indexes are present
    try {
      await pool.query("ALTER TABLE devices ADD COLUMN device_uid VARCHAR(128) NULL AFTER hostname");
    } catch (_) {}
    try {
      await pool.query("CREATE INDEX idx_devices_uid ON devices (device_uid)");
    } catch (_) {}
    try {
      await pool.query("CREATE INDEX idx_cmd_dev_status_disp ON command_queue (device_id, status, dispatched_at)");
    } catch (_) {}

    // 6. Pre-create upcoming monthly partitions and prune expired partitions
    await maintainTelemetryPartitions();

    console.log(`[Migrations] Migration status: ${result.applied.length} applied, ${result.skipped.length} up to date.`);
    return result;
  } catch (err) {
    console.error('❌ [Migrations] Migration execution failed:', err.message);
    throw err;
  } finally {
    if (lockAcquired && pool) {
      try {
        await pool.query("SELECT RELEASE_LOCK('itk_schema_migrations_lock')");
      } catch (_) {}
    }
  }
}

// ---------------- TELEMETRY PARTITION MAINTENANCE ----------------
export async function maintainTelemetryPartitions(retentionDays = 30) {
  if (!isMysqlConnected() || !pool) {
    return { created: [], dropped: [] };
  }
  const results = { created: [], dropped: [] };

  try {
    // 1. Fetch current partitions
    const [partitions] = await pool.query(`
      SELECT PARTITION_NAME, PARTITION_DESCRIPTION 
      FROM INFORMATION_SCHEMA.PARTITIONS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'telemetry_history' 
        AND PARTITION_NAME IS NOT NULL
    `);

    const existingNames = new Set((partitions || []).map(p => p.PARTITION_NAME));
    const hasFuture = existingNames.has('p_future');

    // 2. Pre-create forward partitions for next 2 months ahead
    const now = new Date();
    for (let offset = 0; offset <= 2; offset++) {
      const targetDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
      const year = targetDate.getUTCFullYear();
      const month = String(targetDate.getUTCMonth() + 1).padStart(2, '0');
      const partName = `p_${year}_${month}`;

      if (!existingNames.has(partName)) {
        // Upper bound for this month is first day of next month
        const nextDate = new Date(Date.UTC(year, targetDate.getUTCMonth() + 1, 1));
        const nYear = nextDate.getUTCFullYear();
        const nMonth = String(nextDate.getUTCMonth() + 1).padStart(2, '0');
        const upperBoundStr = `${nYear}-${nMonth}-01`;

        try {
          if (hasFuture) {
            await pool.query(`
              ALTER TABLE telemetry_history REORGANIZE PARTITION p_future INTO (
                PARTITION ${partName} VALUES LESS THAN (TO_DAYS('${upperBoundStr}')),
                PARTITION p_future VALUES LESS THAN MAXVALUE
              )
            `);
          } else {
            await pool.query(`
              ALTER TABLE telemetry_history ADD PARTITION (
                PARTITION ${partName} VALUES LESS THAN (TO_DAYS('${upperBoundStr}'))
              )
            `);
          }
          results.created.push(partName);
          existingNames.add(partName);
          console.log(`[Partition Maintenance] ✅ Added forward partition ${partName} (< ${upperBoundStr})`);
        } catch (addErr) {
          if (!addErr.message?.includes('Duplicate partition') && !addErr.message?.includes('already exists')) {
            console.warn(`[Partition Maintenance] Notice creating ${partName}:`, addErr.message);
          }
        }
      }
    }

    // 3. Drop partitions older than the retention window
    const cutoffDate = new Date(Date.now() - (retentionDays * 86400000));
    const cutoffToDays = Math.floor(cutoffDate.getTime() / 86400000) + 719528;

    for (const p of (partitions || [])) {
      if (p.PARTITION_NAME === 'p_future' || p.PARTITION_NAME === 'p_historical') continue;
      const partVal = parseInt(p.PARTITION_DESCRIPTION, 10);
      if (!isNaN(partVal) && partVal < cutoffToDays) {
        try {
          await pool.query(`ALTER TABLE telemetry_history DROP PARTITION ${p.PARTITION_NAME}`);
          results.dropped.push(p.PARTITION_NAME);
          console.log(`[Partition Maintenance] 🗑️ Dropped expired partition ${p.PARTITION_NAME}`);
        } catch (dropErr) {
          console.warn(`[Partition Maintenance] Could not drop partition ${p.PARTITION_NAME}:`, dropErr.message);
        }
      }
    }
  } catch (err) {
    console.warn('[Partition Maintenance] Partition maintenance notice:', err.message);
  }

  return results;
}

export function isMysqlConnected() {
  return isConnected && pool !== null;
}

export function getPool() {
  return pool;
}

export function setConnectionStateForTesting(connected, testPool = null) {
  isConnected = !!connected;
  if (testPool !== undefined) {
    pool = testPool;
  }
}

// In-memory fallback datastore for resilient offline/container operation
const memTenants = [
  { id: '00000000-0000-0000-0000-000000000001', name: 'Aaditech Enterprise Corp', slug: 'aaditech-corp', plan: 'enterprise', status: 'active', created_at: new Date() }
];

const memCompanies = [
  { id: 1, tenant_id: '00000000-0000-0000-0000-000000000001', name: 'Aaditech Enterprise', users_count: 3, agents_count: 3, created_at: new Date() }
];

const memUsers = [
  { id: 1, tenant_id: '00000000-0000-0000-0000-000000000001', company_id: 1, username: 'admin', email: 'admin@aaditech.com', password_hash: '$2b$10$TdjPGYqvBhQ/znxrISK4leR0Q7x4QAQW2ZGzOCAx.YK35eHrbROmW', role: 'SUPER_ADMIN', active: 1, status: 'ACTIVE' },
  { id: 2, tenant_id: '00000000-0000-0000-0000-000000000001', company_id: 1, username: 'ops_lead', email: 'ops@aaditech.com', password_hash: '$2b$10$tL4nJuWXUzt/0GCKKGBdYONSEz3DaUwJY/CjeNyFSymTjnLsG3tTu', role: 'OPERATOR', active: 1, status: 'ACTIVE' },
  { id: 3, tenant_id: '00000000-0000-0000-0000-000000000001', company_id: 1, username: 'sec_monitor', email: 'monitor@aaditech.com', password_hash: '$2b$10$NsbjYaSfny5cA4RBHXyw5OtEBfolN57DqRLAzNv2rpA22laPAd1Fe', role: 'MONITORING', active: 1, status: 'ACTIVE' }
];

const memDevices = [
  { id: '1', tenant_id: '00000000-0000-0000-0000-000000000001', company_id: 1, hostname: 'DESKTOP-CORP-01', device_uid: 'dev-uid-desktop-corp-01', os_version: 'Windows 11 Pro', arch: 'x64', ip_address: '192.168.1.101', status: 'online', cpu_usage: '12.5%', memory_usage: '45.2%', disk_free: '120.4 GB', battery: '100% (AC)', bitlocker_status: 'ENCRYPTED', antivirus_name: 'Windows Defender', antivirus_status: 'ACTIVE', firewall_status: 'ACTIVE', last_seen_at: new Date() },
  { id: '2', tenant_id: '00000000-0000-0000-0000-000000000001', company_id: 1, hostname: 'SRV-FINANCE-02', device_uid: 'dev-uid-srv-finance-02', os_version: 'Windows Server 2022', arch: 'x64', ip_address: '192.168.1.20', status: 'online', cpu_usage: '28.0%', memory_usage: '62.1%', disk_free: '450.8 GB', battery: '100% (AC)', bitlocker_status: 'ENCRYPTED', antivirus_name: 'Windows Defender', antivirus_status: 'ACTIVE', firewall_status: 'ACTIVE', last_seen_at: new Date() },
  { id: '3', tenant_id: '00000000-0000-0000-0000-000000000001', company_id: 1, hostname: 'LAPTOP-EXEC-03', device_uid: 'dev-uid-laptop-exec-03', os_version: 'Windows 11 Pro', arch: 'x64', ip_address: '192.168.1.155', status: 'online', cpu_usage: '8.2%', memory_usage: '38.4%', disk_free: '85.0 GB', battery: '92%', bitlocker_status: 'ENCRYPTED', antivirus_name: 'Windows Defender', antivirus_status: 'ACTIVE', firewall_status: 'ACTIVE', last_seen_at: new Date() }
];

const memAlertRules = [
  { id: 'rule-1', tenant_id: '00000000-0000-0000-0000-000000000001', name: 'High CPU Sustained (>85%)', description: 'Alert when CPU exceeds 85% sustained load', metric: 'cpu', condition_op: '>=', threshold: 85.0, duration_mins: 5, severity: 'critical', enabled: 1 },
  { id: 'rule-2', tenant_id: '00000000-0000-0000-0000-000000000001', name: 'Low System Disk Space (<15 GB)', description: 'Alert when free space falls below 15 GB', metric: 'disk', condition_op: '<=', threshold: 15.0, duration_mins: 1, severity: 'warning', enabled: 1 },
  { id: 'rule-3', tenant_id: '00000000-0000-0000-0000-000000000001', name: 'Agent Missed Heartbeat (>10 mins)', description: 'Alert when agent is offline', metric: 'heartbeat', condition_op: '>=', threshold: 10.0, duration_mins: 10, severity: 'critical', enabled: 1 },
  { id: 'rule-4', tenant_id: '00000000-0000-0000-0000-000000000001', name: 'High RAM Memory Load (>90%)', description: 'Alert when RAM usage exceeds 90%', metric: 'ram', condition_op: '>=', threshold: 90.0, duration_mins: 15, severity: 'warning', enabled: 1 }
];

const memGroups = [
  { id: 'grp-1', tenant_id: '00000000-0000-0000-0000-000000000001', name: 'Engineering Laptops', description: 'High performance developer devices', member_count: 8, policy_id: 'pol-1' },
  { id: 'grp-2', tenant_id: '00000000-0000-0000-0000-000000000001', name: 'Finance & Operations', description: 'Secure workstation group for accounting', member_count: 5, policy_id: 'pol-2' },
  { id: 'grp-3', tenant_id: '00000000-0000-0000-0000-000000000001', name: 'Executive Fleet', description: 'VIP devices with priority monitoring', member_count: 3, policy_id: 'pol-1' }
];

const memPolicies = [
  { id: 'pol-1', tenant_id: '00000000-0000-0000-0000-000000000001', name: 'Standard Enterprise Telemetry', checkin_interval_sec: 30, auto_update: 1, maintenance_mode: 0, data_retention_days: 90 },
  { id: 'pol-2', tenant_id: '00000000-0000-0000-0000-000000000001', name: 'High-Security PCI Compliance Policy', checkin_interval_sec: 15, auto_update: 1, maintenance_mode: 0, data_retention_days: 365 }
];

const memRemediationPolicies = [
  { id: 'clean_temp', name: 'Auto Disk Space Remediation', description: 'Automatically cleans Windows Temp...', enabled: 1, trigger_condition: 'disk_free < 20GB', action_type: 'clean_temp_files', executions_count: 14 },
  { id: 'restart_spooler', name: 'Print Spooler Self-Healing', description: 'Restarts Print Spooler service...', enabled: 1, trigger_condition: 'spooler_status == stopped', action_type: 'restart_spooler', executions_count: 8 },
  { id: 'reset_network', name: 'Network Adapter & DNS Auto-Reset', description: 'Flushes DNS cache...', enabled: 1, trigger_condition: 'ping_gateway_failed', action_type: 'reset_network', executions_count: 5 },
  { id: 'clear_bits', name: 'BITS Queue Auto-Flush', description: 'Clears stuck BITS...', enabled: 0, trigger_condition: 'bits_stuck_jobs > 5', action_type: 'clear_bits', executions_count: 2 }
];

const memRemediationLogs = [];
const memCommands = [];
const memAlerts = [];
const memTelemetry = [];
const memProcesses = [];
const memEvents = [];
const memAuditLogs = [];
const memMsiPackages = [];
const memRevokedTokens = new Set();
const memBootstrapTokens = new Set();
const memAppliedMigrations = new Set();
const memTickets = [];
const memSettings = new Map();

let monotonicInsertId = Date.now() * 1000;

export async function executeQuery(sql, params = []) {
  if (isMysqlConnected()) {
    try {
      const [results] = await pool.query(sql, params);
      return results;
    } catch (err) {
      console.warn("MySQL query error, using in-memory engine:", err.message);
    }
  }

  // Resilient fallback SQL emulator for essential query patterns and EXPLAIN plans
  const cleanSql = String(sql).trim();
  const upperSql = cleanSql.toUpperCase();

  if (upperSql.startsWith('EXPLAIN')) {
    return [{
      mocked: true,
      reason: "mysql offline",
      query: cleanSql,
      id: null,
      select_type: null,
      table: null,
      type: null,
      possible_keys: null,
      key: null,
      rows: null
    }];
  }

  if (upperSql.includes('FROM USERS')) {
    if (params.length >= 1) {
      const p = String(params[0]).toLowerCase();
      const p1 = params.length > 1 ? String(params[1]).toLowerCase() : p;
      const u = memUsers.find(x => x.username.toLowerCase() === p || x.email.toLowerCase() === p || x.username.toLowerCase() === p1 || x.email.toLowerCase() === p1 || String(x.id) === p);
      return u ? [u] : [];
    }
    return [...memUsers];
  }

  if (upperSql.includes('FROM TENANTS')) {
    if (params.length > 0 && params[0]) {
      const found = memTenants.find(t => t.id === String(params[0]));
      return found ? [found] : [];
    }
    return [...memTenants];
  }

  if (upperSql.includes('FROM COMPANIES')) {
    return [...memCompanies];
  }

  if (upperSql.includes('FROM DEVICES')) {
    if (upperSql.includes('WHERE')) {
      if (upperSql.includes('WHERE ID') || upperSql.includes('DEVICE_ID')) {
        const idVal = String(params[0] || '').toLowerCase();
        const d = memDevices.find(x => String(x.id).toLowerCase() === idVal);
        return d ? [d] : [];
      }
      if (upperSql.includes('HOSTNAME')) {
        const h = String(params[0] || '').toLowerCase();
        const d = memDevices.find(x => x.hostname.toLowerCase() === h);
        return d ? [d] : [];
      }
      if (upperSql.includes('DEVICE_UID')) {
        const u = String(params[0] || '').toLowerCase();
        const d = memDevices.find(x => (x.device_uid || '').toLowerCase() === u);
        return d ? [d] : [];
      }
      if (upperSql.includes('DEVICE_TOKEN_HASH') || upperSql.includes('AUTH_TOKEN_HASH')) {
        const t = String(params[0] || '');
        const d = memDevices.find(x => (x.device_token_hash && x.device_token_hash === t) || (x.auth_token_hash && x.auth_token_hash === t));
        return d ? [d] : [];
      }
      if (upperSql.includes('STATUS')) {
        return memDevices.filter(x => (x.status || '').toLowerCase() === 'online');
      }
      return [];
    }
    return [...memDevices];
  }

  if (upperSql.includes('FROM AUDIT_LOGS')) {
    return [...memAuditLogs];
  }

  if (upperSql.includes('FROM ALERT_RULES')) {
    if (upperSql.includes('WHERE ID =') && params.length >= 1) {
      const r = memAlertRules.find(x => String(x.id) === String(params[0]));
      return r ? [r] : [];
    }
    if (upperSql.includes('WHERE NAME =') && params.length >= 1) {
      const r = memAlertRules.find(x => String(x.name) === String(params[0]));
      return r ? [r] : [];
    }
    return [...memAlertRules];
  }

  if (upperSql.includes('FROM ALERTS')) {
    if (upperSql.includes('WHERE ID =') && params.length >= 1) {
      const a = memAlerts.find(x => String(x.id) === String(params[0]));
      return a ? [a] : [];
    }
    return [...memAlerts];
  }

  if (upperSql.includes('FROM GROUPS')) {
    return [...memGroups];
  }

  if (upperSql.includes('FROM POLICIES')) {
    return [...memPolicies];
  }

  if (upperSql.includes('FROM REMEDIATION_POLICIES')) {
    if (params.length >= 1) {
      const p = String(params[0]);
      const r = memRemediationPolicies.find(x => x.action_type === p || x.id === p);
      return r ? [r] : [];
    }
    return [...memRemediationPolicies];
  }

  if (upperSql.includes('FROM REMEDIATION_LOGS')) {
    return [...memRemediationLogs];
  }

  if (upperSql.includes('FROM SYSTEM_SETTINGS')) {
    const key = params[0];
    const val = memSettings.get(key);
    return val ? [{ setting_value: JSON.stringify(val) }] : [];
  }

  if (upperSql.includes('FROM REVOKED_TOKENS')) {
    const t = params[0];
    return memRevokedTokens.has(t) ? [{ token_or_jti: t }] : [];
  }

  if (upperSql.includes('SCHEMA_MIGRATIONS')) {
    if (upperSql.includes('SELECT')) {
      return Array.from(memAppliedMigrations).map(v => ({ version: v }));
    }
    if (upperSql.includes('INSERT')) {
      const v = String(params[0] || '');
      memAppliedMigrations.add(v);
      return { affectedRows: 1 };
    }
  }

  if (upperSql.includes('GET_LOCK')) {
    return [{ locked: 1 }];
  }

  if (upperSql.includes('RELEASE_LOCK')) {
    return [{ released: 1 }];
  }

  if (upperSql.includes('FROM TICKETS')) {
    if (upperSql.includes('WHERE ID = ?') || upperSql.includes('ID = ?')) {
      const targetId = String(params[0]);
      const found = memTickets.find(x => String(x.id) === targetId);
      return found ? [found] : [];
    }
    return [...memTickets];
  }

  if (upperSql.includes('FROM USED_BOOTSTRAP_TOKENS')) {
    const hash = params[0];
    if (memBootstrapTokens.has(hash)) {
      return [{ id: 1, token_hash: hash }];
    }
    return [];
  }

  if (upperSql.includes('FROM MSI_PACKAGES')) {
    if (upperSql.includes('BOOTSTRAP_TOKEN_HASH') || upperSql.includes('BOOTSTRAP_TOKEN')) {
      const p = params[0];
      const p2 = params[1] || p;
      const found = memMsiPackages.find(x => x.bootstrap_token_hash === p || x.bootstrap_token === p || x.bootstrap_token_hash === p2 || x.bootstrap_token === p2);
      if (found) {
        if (upperSql.includes('USED = 1') && !found.used) return [];
        return [found];
      }
      return [];
    }
    if (upperSql.includes('WHERE ID = ?') || upperSql.includes('ID = ?') || upperSql.includes('WHERE ID =')) {
      const targetId = String(params[0]);
      const found = memMsiPackages.find(x => String(x.id) === targetId);
      return found ? [found] : [];
    }
    return [...memMsiPackages];
  }

  if (upperSql.includes('FROM COMMAND_QUEUE')) {
    if (upperSql.includes('WHERE')) {
      if (upperSql.includes('DEVICE_ID')) {
        const devId = String(params[0] || '').toLowerCase();
        let list = memCommands.filter(c => 
          (String(c.device_id).toLowerCase() === devId || (c.hostname && String(c.hostname).toLowerCase() === devId)) &&
          (!upperSql.includes("STATUS = 'PENDING'") || c.status.toUpperCase() === 'PENDING')
        );
        if (upperSql.includes('LIMIT')) {
          const lim = Number(params[1]) || 50;
          list = list.slice(0, lim);
        }
        return list;
      }
      if (upperSql.includes('ID = ?') || upperSql.includes('ID=')) {
        const cmdId = String(params[0] || '');
        const c = memCommands.find(x => String(x.id) === cmdId);
        return c ? [c] : [];
      }
    }
    return [...memCommands];
  }

  if (upperSql.includes('FROM DEVICE_PROCESSES')) {
    const devId = String(params[0] || '');
    return memProcesses.filter(p => p.device_id === devId);
  }

  if (upperSql.startsWith('DELETE FROM DEVICE_PROCESSES')) {
    const devId = String(params[0] || '');
    const beforeLen = memProcesses.length;
    for (let i = memProcesses.length - 1; i >= 0; i--) {
      if (memProcesses[i].device_id === devId) {
        memProcesses.splice(i, 1);
      }
    }
    return { affectedRows: beforeLen - memProcesses.length };
  }

  if (upperSql.includes('FROM TELEMETRY_HISTORY')) {
    if (upperSql.includes('WHERE')) {
      const devId = String(params[0] || '').toLowerCase();
      let list = memTelemetry.filter(t => String(t.device_id).toLowerCase() === devId);
      if (upperSql.includes('LIMIT')) {
        const lim = Number(params[1]) || 50;
        list = list.slice(-lim);
      }
      return list;
    }
    return [...memTelemetry];
  }

  if (upperSql.includes('INFORMATION_SCHEMA.PARTITIONS')) {
    return [];
  }

  if (upperSql.startsWith('ALTER TABLE')) {
    return { affectedRows: 0 };
  }

  if (upperSql.startsWith('DELETE FROM TELEMETRY_HISTORY')) {
    const days = Number(params[0]) || 30;
    const cutoff = Date.now() - (days * 86400000);
    const initLen = memTelemetry.length;
    for (let i = memTelemetry.length - 1; i >= 0; i--) {
      const t = new Date(memTelemetry[i].recorded_at || 0).getTime();
      if (t < cutoff) memTelemetry.splice(i, 1);
    }
    return { affectedRows: Math.max(0, initLen - memTelemetry.length) };
  }

  if (upperSql.startsWith('DELETE FROM AUDIT_LOGS')) {
    const days = Number(params[0]) || 730;
    const cutoff = Date.now() - (days * 86400000);
    const initLen = memAuditLogs.length;
    for (let i = memAuditLogs.length - 1; i >= 0; i--) {
      const t = new Date(memAuditLogs[i].created_at || 0).getTime();
      if (t < cutoff) memAuditLogs.splice(i, 1);
    }
    return { affectedRows: Math.max(0, initLen - memAuditLogs.length) };
  }

  if (upperSql.startsWith('DELETE FROM ALERTS')) {
    const days = Number(params[0]) || 90;
    const cutoff = Date.now() - (days * 86400000);
    const initLen = memAlerts.length;
    for (let i = memAlerts.length - 1; i >= 0; i--) {
      const a = memAlerts[i];
      if (a.status === 'resolved') {
        const t = new Date(a.resolved_at || a.created_at || 0).getTime();
        if (t < cutoff) memAlerts.splice(i, 1);
      }
    }
    return { affectedRows: Math.max(0, initLen - memAlerts.length) };
  }

  if (upperSql.startsWith('DELETE FROM COMMAND_QUEUE')) {
    const days = Number(params[0]) || 30;
    const cutoff = Date.now() - (days * 86400000);
    const initLen = memCommands.length;
    for (let i = memCommands.length - 1; i >= 0; i--) {
      const c = memCommands[i];
      const s = String(c.status || '').toUpperCase();
      if (['COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(s)) {
        const t = new Date(c.completed_at || c.dispatched_at || 0).getTime();
        if (t < cutoff) memCommands.splice(i, 1);
      }
    }
    return { affectedRows: Math.max(0, initLen - memCommands.length) };
  }

  if (upperSql.startsWith('INSERT')) {
    return { insertId: ++monotonicInsertId, affectedRows: 1 };
  }

  if (upperSql.startsWith('UPDATE') || upperSql.startsWith('DELETE')) {
    return { affectedRows: 1 };
  }

  return [];
}

// ---------------- TENANTS ----------------
export async function getTenants() {
  const rows = await executeQuery('SELECT * FROM tenants ORDER BY created_at ASC');
  return rows;
}

export async function getTenantById(id) {
  const rows = await executeQuery('SELECT * FROM tenants WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
}

// ---------------- COMPANIES ----------------
export async function getCompanies() {
  const rows = await executeQuery('SELECT * FROM companies ORDER BY id ASC');
  return rows.map(r => ({
    ...r,
    users: r.users_count || 1,
    agents: r.agents_count || 0
  }));
}

export async function getCompanyById(id) {
  const rows = await executeQuery('SELECT * FROM companies WHERE id = ? LIMIT 1', [id]);
  if (!rows[0]) return null;
  const c = rows[0];
  return { ...c, users: c.users_count || 1, agents: c.agents_count || 0 };
}

export async function getCompanyByName(name) {
  const rows = await executeQuery('SELECT * FROM companies WHERE name = ? LIMIT 1', [name]);
  if (!rows[0]) return null;
  const c = rows[0];
  return { ...c, users: c.users_count || 1, agents: c.agents_count || 0 };
}

export async function createCompany(comp) {
  const sql = `
    INSERT INTO companies (name, tenant_id, users_count, agents_count, created_at)
    VALUES (?, ?, ?, ?, NOW(3))
  `;
  const res = await executeQuery(sql, [
    comp.name,
    comp.tenant_id || '00000000-0000-0000-0000-000000000001',
    comp.users || comp.users_count || 1,
    comp.agents || comp.agents_count || 0
  ]);
  return { id: res.insertId, ...comp };
}

export async function updateCompany(id, updates) {
  const fields = [];
  const params = [];
  if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name); }
  if (updates.users_count !== undefined) { fields.push('users_count = ?'); params.push(updates.users_count); }
  if (updates.agents_count !== undefined) { fields.push('agents_count = ?'); params.push(updates.agents_count); }
  if (fields.length === 0) return false;
  params.push(id);
  await executeQuery(`UPDATE companies SET ${fields.join(', ')}, updated_at = NOW(3) WHERE id = ?`, params);
  return true;
}

// ---------------- USERS ----------------
export async function getUsers() {
  const rows = await executeQuery('SELECT * FROM users ORDER BY id ASC');
  return rows.map(u => ({
    ...u,
    active: Boolean(u.active)
  }));
}

export async function getUserById(id) {
  const rows = await executeQuery('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
  if (!rows[0]) return null;
  return { ...rows[0], active: Boolean(rows[0].active) };
}

export async function getUserByUsername(username) {
  if (!username) return null;
  const rows = await executeQuery('SELECT * FROM users WHERE username = ? LIMIT 1', [String(username).trim()]);
  if (!rows[0]) return null;
  return { ...rows[0], active: Boolean(rows[0].active) };
}

export async function getUserByEmail(email) {
  if (!email) return null;
  const rows = await executeQuery('SELECT * FROM users WHERE email = ? LIMIT 1', [String(email).trim()]);
  if (!rows[0]) return null;
  return { ...rows[0], active: Boolean(rows[0].active) };
}

export async function getUserByUsernameOrEmail(identifier) {
  if (!identifier) return null;
  const cleanId = String(identifier).trim();
  const rows = await executeQuery(
    'SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1',
    [cleanId, cleanId]
  );
  if (!rows[0]) return null;
  return { ...rows[0], active: Boolean(rows[0].active) };
}

export async function createUser(user) {
  const sql = `
    INSERT INTO users (tenant_id, company_id, username, email, password_hash, role, active, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(3))
  `;
  const res = await executeQuery(sql, [
    user.tenant_id || '00000000-0000-0000-0000-000000000001',
    user.company_id || 1,
    user.username,
    user.email,
    user.password_hash,
    user.role || 'OPERATOR',
    user.active !== false ? 1 : 0,
    user.status || 'ACTIVE'
  ]);
  const newUser = { id: res.insertId || Date.now(), active: user.active !== false, ...user };
  memUsers.push(newUser);
  return newUser;
}

export async function updateUser(id, updates) {
  const fields = [];
  const params = [];
  if (updates.username !== undefined) { fields.push('username = ?'); params.push(updates.username); }
  if (updates.email !== undefined) { fields.push('email = ?'); params.push(updates.email); }
  if (updates.password_hash !== undefined) { fields.push('password_hash = ?'); params.push(updates.password_hash); }
  if (updates.role !== undefined) { fields.push('role = ?'); params.push(updates.role); }
  if (updates.active !== undefined) { fields.push('active = ?'); params.push(updates.active ? 1 : 0); }
  if (updates.status !== undefined) { fields.push('status = ?'); params.push(updates.status); }
  if (updates.company_id !== undefined) { fields.push('company_id = ?'); params.push(updates.company_id); }
  if (updates.last_login !== undefined) { fields.push('last_login = NOW(3)'); }
  if (fields.length === 0) return false;
  params.push(id);
  await executeQuery(`UPDATE users SET ${fields.join(', ')}, updated_at = NOW(3) WHERE id = ?`, params);
  return true;
}

export async function deleteUser(id) {
  await executeQuery('DELETE FROM users WHERE id = ?', [id]);
  return true;
}

// ---------------- DEVICES / AGENTS ----------------
// High-performance O(1) in-memory cache Map for device hot lookups
// Eliminates redundant DB round-trips for high-frequency agent polling (15-30s intervals)
const deviceLookupCache = new Map();
const DEVICE_CACHE_TTL_MS = 25000; // 25 seconds TTL

export function invalidateDeviceCache(deviceOrId) {
  if (!deviceOrId) {
    deviceLookupCache.clear();
    return;
  }
  if (typeof deviceOrId === 'string') {
    deviceLookupCache.delete(`id:${deviceOrId}`);
    deviceLookupCache.delete(`host:${deviceOrId.toLowerCase()}`);
    deviceLookupCache.delete(`uid:${deviceOrId.toLowerCase()}`);
  } else if (typeof deviceOrId === 'object') {
    if (deviceOrId.id) deviceLookupCache.delete(`id:${deviceOrId.id}`);
    if (deviceOrId.hostname) deviceLookupCache.delete(`host:${deviceOrId.hostname.toLowerCase()}`);
    if (deviceOrId.device_uid) deviceLookupCache.delete(`uid:${deviceOrId.device_uid.toLowerCase()}`);
    if (deviceOrId.device_token_hash) deviceLookupCache.delete(`hash:${deviceOrId.device_token_hash}`);
    if (deviceOrId.auth_token_hash) deviceLookupCache.delete(`hash:${deviceOrId.auth_token_hash}`);
  }
}

export async function getDevices(filters = {}) {
  const cacheKey = 'cache:devices:list';
  if (!filters || Object.keys(filters).length === 0) {
    const cached = await cacheGet(cacheKey);
    if (cached) return cached;
  }

  let sql = 'SELECT * FROM devices';
  const conditions = [];
  const params = [];

  if (filters.status) {
    const s = String(filters.status).toLowerCase();
    if (s === 'active' || s === 'online') {
      conditions.push("(status = 'online' OR status = 'ACTIVE')");
    } else if (s === 'offline') {
      conditions.push("(status = 'offline' OR status = 'OFFLINE')");
    } else {
      conditions.push('status = ?');
      params.push(filters.status);
    }
  }
  if (filters.tenant_id) {
    conditions.push('tenant_id = ?');
    params.push(filters.tenant_id);
  }
  if (filters.company_id) {
    conditions.push('company_id = ?');
    params.push(filters.company_id);
  }
  if (filters.os_type) {
    const ost = String(filters.os_type).toUpperCase();
    if (ost === 'WINDOWS') conditions.push("os_version LIKE '%Windows%'");
    else if (ost === 'MACOS') conditions.push("os_version LIKE '%macOS%'");
    else if (ost === 'LINUX') conditions.push("os_version LIKE '%Linux%'");
  }
  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`;
  }
  sql += ' ORDER BY last_seen_at DESC';

  const rows = await executeQuery(sql, params);
  const formatted = rows.map(formatDeviceRecord);

  if (!filters || Object.keys(filters).length === 0) {
    await cacheSet(cacheKey, formatted, 20);
  }
  return formatted;
}

function formatDeviceRecord(row) {
  if (!row) return null;
  return {
    ...row,
    os: row.os_version,
    ip: row.ip_address,
    last_seen: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : new Date().toISOString(),
    agent_token_revoked: Boolean(row.agent_token_revoked),
    cpu_usage: row.cpu_usage || '15%',
    memory_usage: row.memory_usage || '45%',
    disk_free: row.disk_free || `${row.disk_free_gb || 250} GB`,
    battery: row.battery || '100% (AC)'
  };
}

export async function getDeviceById(id) {
  if (!id) return null;
  const key = `id:${id}`;
  const cached = deviceLookupCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.record;

  const rows = await executeQuery('SELECT * FROM devices WHERE id = ? LIMIT 1', [String(id)]);
  let rec = formatDeviceRecord(rows[0]);
  if (!rec) {
    const memMatch = memDevices.find(d => String(d.id) === String(id));
    if (memMatch) rec = formatDeviceRecord(memMatch);
  }
  if (rec) {
    const expiresAt = Date.now() + DEVICE_CACHE_TTL_MS;
    deviceLookupCache.set(key, { record: rec, expiresAt });
    if (rec.hostname) deviceLookupCache.set(`host:${rec.hostname.toLowerCase()}`, { record: rec, expiresAt });
    if (rec.device_uid) deviceLookupCache.set(`uid:${rec.device_uid.toLowerCase()}`, { record: rec, expiresAt });
    if (rec.device_token_hash) deviceLookupCache.set(`hash:${rec.device_token_hash}`, { record: rec, expiresAt });
  }
  return rec;
}

export async function getDeviceByHostname(hostname) {
  if (!hostname) return null;
  const hTrim = String(hostname).trim();
  const key = `host:${hTrim.toLowerCase()}`;
  const cached = deviceLookupCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.record;

  const rows = await executeQuery('SELECT * FROM devices WHERE hostname = ? LIMIT 1', [hTrim]);
  let rec = formatDeviceRecord(rows[0]);
  if (!rec) {
    const memMatch = memDevices.find(d => d.hostname && d.hostname.toLowerCase() === hTrim.toLowerCase());
    if (memMatch) rec = formatDeviceRecord(memMatch);
  }
  if (rec) {
    const expiresAt = Date.now() + DEVICE_CACHE_TTL_MS;
    deviceLookupCache.set(key, { record: rec, expiresAt });
    if (rec.id) deviceLookupCache.set(`id:${rec.id}`, { record: rec, expiresAt });
    if (rec.device_uid) deviceLookupCache.set(`uid:${rec.device_uid.toLowerCase()}`, { record: rec, expiresAt });
    if (rec.device_token_hash) deviceLookupCache.set(`hash:${rec.device_token_hash}`, { record: rec, expiresAt });
  }
  return rec;
}

export async function getDeviceByUid(deviceUid) {
  if (!deviceUid) return null;
  const uTrim = String(deviceUid).trim();
  const key = `uid:${uTrim.toLowerCase()}`;
  const cached = deviceLookupCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.record;

  const rows = await executeQuery('SELECT * FROM devices WHERE device_uid = ? LIMIT 1', [uTrim]);
  let rec = formatDeviceRecord(rows[0]);
  if (!rec) {
    const memMatch = memDevices.find(d => d.device_uid && d.device_uid.toLowerCase() === uTrim.toLowerCase());
    if (memMatch) rec = formatDeviceRecord(memMatch);
  }
  if (rec) {
    const expiresAt = Date.now() + DEVICE_CACHE_TTL_MS;
    deviceLookupCache.set(key, { record: rec, expiresAt });
    if (rec.id) deviceLookupCache.set(`id:${rec.id}`, { record: rec, expiresAt });
    if (rec.hostname) deviceLookupCache.set(`host:${rec.hostname.toLowerCase()}`, { record: rec, expiresAt });
    if (rec.device_token_hash) deviceLookupCache.set(`hash:${rec.device_token_hash}`, { record: rec, expiresAt });
  }
  return rec;
}

export async function getDeviceByTokenHash(hash) {
  if (!hash) return null;
  const key = `hash:${hash}`;
  const cached = deviceLookupCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.record;

  const rows = await executeQuery(
    'SELECT * FROM devices WHERE device_token_hash = ? OR auth_token_hash = ? LIMIT 1',
    [hash, hash]
  );
  let rec = formatDeviceRecord(rows[0]);
  if (!rec) {
    const memMatch = memDevices.find(d => d.device_token_hash === hash || d.auth_token_hash === hash);
    if (memMatch) rec = formatDeviceRecord(memMatch);
  }
  if (rec) {
    const expiresAt = Date.now() + DEVICE_CACHE_TTL_MS;
    deviceLookupCache.set(key, { record: rec, expiresAt });
    if (rec.id) deviceLookupCache.set(`id:${rec.id}`, { record: rec, expiresAt });
    if (rec.hostname) deviceLookupCache.set(`host:${rec.hostname.toLowerCase()}`, { record: rec, expiresAt });
    if (rec.device_uid) deviceLookupCache.set(`uid:${rec.device_uid.toLowerCase()}`, { record: rec, expiresAt });
  }
  return rec;
}

export async function syncDeviceToDb(dev) {
  try {
    let devId = dev.id ? String(dev.id) : null;
    if (!devId && dev.hostname) {
      const existing = await getDeviceByHostname(dev.hostname);
      if (existing && existing.id) devId = existing.id;
    }
    if (!devId) {
      devId = dev.device_uid || crypto.randomUUID();
    }
    dev.id = devId;

    const sql = `
      INSERT INTO devices (
        id, tenant_id, company_id, hostname, device_uid, os_version, arch, ip_address, 
        status, cpu_model, total_ram_gb, disk_total_gb, disk_free_gb, 
        cpu_usage, memory_usage, disk_free, battery,
        bitlocker_status, antivirus_name, antivirus_status, firewall_status, 
        security_score, agent_version, device_token_hash, device_token_prefix,
        agent_token_revoked, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))
      ON DUPLICATE KEY UPDATE
        hostname = VALUES(hostname),
        device_uid = COALESCE(VALUES(device_uid), device_uid),
        os_version = VALUES(os_version),
        ip_address = VALUES(ip_address),
        status = VALUES(status),
        cpu_model = COALESCE(VALUES(cpu_model), cpu_model),
        total_ram_gb = COALESCE(VALUES(total_ram_gb), total_ram_gb),
        disk_total_gb = COALESCE(VALUES(disk_total_gb), disk_total_gb),
        disk_free_gb = VALUES(disk_free_gb),
        cpu_usage = COALESCE(VALUES(cpu_usage), cpu_usage),
        memory_usage = COALESCE(VALUES(memory_usage), memory_usage),
        disk_free = COALESCE(VALUES(disk_free), disk_free),
        battery = COALESCE(VALUES(battery), battery),
        bitlocker_status = VALUES(bitlocker_status),
        antivirus_name = VALUES(antivirus_name),
        antivirus_status = VALUES(antivirus_status),
        firewall_status = VALUES(firewall_status),
        security_score = VALUES(security_score),
        agent_version = VALUES(agent_version),
        device_token_hash = COALESCE(VALUES(device_token_hash), device_token_hash),
        device_token_prefix = COALESCE(VALUES(device_token_prefix), device_token_prefix),
        agent_token_revoked = VALUES(agent_token_revoked),
        last_seen_at = NOW(3);
    `;
    await executeQuery(sql, [
      devId,
      dev.tenant_id || '00000000-0000-0000-0000-000000000001',
      dev.company_id || 1,
      dev.hostname,
      dev.device_uid || dev.deviceUid || null,
      dev.os_version || dev.os || 'Windows 11 Pro',
      dev.arch || 'x64',
      dev.ip_address || dev.ip || '127.0.0.1',
      dev.status || 'online',
      dev.cpu_model || null,
      dev.total_ram_gb || 16.0,
      dev.disk_total_gb || 512.0,
      dev.disk_free_gb || 256.0,
      dev.cpu_usage || '15%',
      dev.memory_usage || '45%',
      dev.disk_free || '250 GB',
      dev.battery || '100% (AC)',
      dev.bitlocker_status || 'PROTECTED',
      dev.antivirus_name || 'Windows Defender',
      dev.antivirus_status || 'ACTIVE',
      dev.firewall_status || 'ENABLED',
      dev.security_score || 95,
      dev.agent_version || getAgentVersion(),
      dev.device_token_hash || null,
      dev.device_token_prefix || null,
      dev.agent_token_revoked ? 1 : 0
    ]);

    // Update in-memory fallback list
    const existingIdx = memDevices.findIndex(d => d.id === devId || d.hostname === dev.hostname || (dev.device_uid && d.device_uid === dev.device_uid));
    if (existingIdx >= 0) {
      memDevices[existingIdx] = { ...memDevices[existingIdx], ...dev };
    } else {
      memDevices.push({ ...dev, id: devId });
    }

    // Explicit cache invalidation
    invalidateDeviceCache(dev);
    await cacheDel('cache:devices:list');
    return true;
  } catch (err) {
    console.error('syncDeviceToDb error:', err.message);
    return false;
  }
}

export async function updateDevice(id, updates) {
  const memIdx = memDevices.findIndex(d => String(d.id) === String(id));
  if (memIdx >= 0) {
    memDevices[memIdx] = { ...memDevices[memIdx], ...updates };
  }
  const fields = [];
  const params = [];
  for (const [key, val] of Object.entries(updates)) {
    if (key === 'id') continue;
    fields.push(`\`${key}\` = ?`);
    params.push(val);
  }
  if (fields.length > 0) {
    params.push(String(id));
    await executeQuery(`UPDATE devices SET ${fields.join(', ')}, last_seen_at = NOW(3) WHERE id = ?`, params);
  }
  invalidateDeviceCache(id);
  if (memIdx >= 0) invalidateDeviceCache(memDevices[memIdx]);
  await cacheDel('cache:devices:list');
  return true;
}

export async function deleteDevice(id) {
  const memIdx = memDevices.findIndex(d => String(d.id) === String(id));
  if (memIdx >= 0) {
    const dev = memDevices[memIdx];
    memDevices.splice(memIdx, 1);
    invalidateDeviceCache(dev);
  }
  await executeQuery('DELETE FROM devices WHERE id = ?', [String(id)]);
  invalidateDeviceCache(id);
  await cacheDel('cache:devices:list');
  return true;
}

// ---------------- TELEMETRY (BATCHED & RESILIENT) ----------------
const telemetryQueue = [];
let telemetryFlushTimer = null;
const TELEMETRY_FLUSH_INTERVAL_MS = 1500;
const TELEMETRY_MAX_QUEUE_SIZE = 100;

function normalizeMetricPoint(deviceId, m = {}) {
  const devId = String(deviceId || m.device_id || 'unknown');
  const cpuPct = m.cpu_pct !== undefined ? parseFloat(m.cpu_pct) : parseFloat(m.cpu?.utilization_pct || 0);
  const ramPct = m.ram_pct !== undefined ? parseFloat(m.ram_pct) : parseFloat(m.ram?.utilization_pct || 0);
  const diskFree = m.disk_free_gb !== undefined ? parseFloat(m.disk_free_gb) : parseFloat(m.disk?.free_gb || 0);
  const netLatency = m.net_latency_ms !== undefined ? parseFloat(m.net_latency_ms) : parseFloat(m.network?.latency_ms || 24);
  const recAt = m.recorded_at ? new Date(m.recorded_at) : new Date();

  return {
    device_id: devId,
    cpu_pct: isNaN(cpuPct) ? 0 : cpuPct,
    ram_pct: isNaN(ramPct) ? 0 : ramPct,
    disk_free_gb: isNaN(diskFree) ? 0 : diskFree,
    net_latency_ms: isNaN(netLatency) ? 24 : netLatency,
    recorded_at: recAt
  };
}

export async function flushTelemetryQueue() {
  if (telemetryQueue.length === 0) return 0;
  const batch = telemetryQueue.splice(0, telemetryQueue.length);
  if (batch.length === 0) return 0;

  if (isMysqlConnected() && pool) {
    try {
      const rows = batch.map(b => [
        b.device_id,
        b.cpu_pct,
        b.ram_pct,
        b.disk_free_gb,
        b.net_latency_ms,
        b.recorded_at
      ]);
      const sql = `
        INSERT INTO telemetry_history (
          device_id, cpu_pct, ram_pct, disk_free_gb, net_latency_ms, recorded_at
        ) VALUES ?
      `;
      await pool.query(sql, [rows]);
    } catch (err) {
      console.error('Error executing batched telemetry insert:', err.message);
    }
  }
  return batch.length;
}

export function startTelemetryFlushWorker(intervalMs = TELEMETRY_FLUSH_INTERVAL_MS) {
  if (telemetryFlushTimer) return telemetryFlushTimer;
  telemetryFlushTimer = setInterval(() => {
    flushTelemetryQueue().catch(err => console.error('Telemetry batch flush error:', err.message));
  }, intervalMs);
  if (telemetryFlushTimer.unref) telemetryFlushTimer.unref();
  return telemetryFlushTimer;
}

export async function insertTelemetryBatch(records) {
  if (!Array.isArray(records) || records.length === 0) return 0;
  const normalized = [];
  for (const item of records) {
    const pt = normalizeMetricPoint(item.device_id, item);
    normalized.push(pt);
    memTelemetry.push(pt);
  }

  if (isMysqlConnected() && pool) {
    try {
      const rows = normalized.map(b => [
        b.device_id,
        b.cpu_pct,
        b.ram_pct,
        b.disk_free_gb,
        b.net_latency_ms,
        b.recorded_at
      ]);
      const sql = `
        INSERT INTO telemetry_history (
          device_id, cpu_pct, ram_pct, disk_free_gb, net_latency_ms, recorded_at
        ) VALUES ?
      `;
      await pool.query(sql, [rows]);
    } catch (err) {
      console.error('insertTelemetryBatch error:', err.message);
    }
  }
  return normalized.length;
}

export async function insertTelemetryRecord(deviceId, metrics) {
  if (!metrics) return false;

  // Support direct array batch insertion
  if (Array.isArray(metrics)) {
    const records = metrics.map(m => ({ ...m, device_id: deviceId }));
    await insertTelemetryBatch(records);
    return true;
  }

  const point = normalizeMetricPoint(deviceId, metrics);
  memTelemetry.push(point);
  telemetryQueue.push(point);

  // If buffer reaches limit, flush immediately
  if (telemetryQueue.length >= TELEMETRY_MAX_QUEUE_SIZE) {
    await flushTelemetryQueue();
  }
  return true;
}

export async function getTelemetryHistory(deviceId, limit = 50) {
  // Ensure any queued telemetry is flushed to DB before reading
  await flushTelemetryQueue();

  const rows = await executeQuery(
    'SELECT * FROM telemetry_history WHERE device_id = ? ORDER BY recorded_at DESC LIMIT ?',
    [String(deviceId), limit]
  );
  return rows;
}

// ---------------- PROCESSES (ATOMIC TRANSACTION) ----------------
export function getMemProcesses() {
  return memProcesses;
}

export async function syncDeviceProcesses(deviceId, processes) {
  if (!Array.isArray(processes) || processes.length === 0) return false;
  const devIdStr = String(deviceId);

  const updateMemoryProcesses = () => {
    const existingFiltered = memProcesses.filter(p => p.device_id !== devIdStr);
    memProcesses.length = 0;
    memProcesses.push(...existingFiltered);
    for (const p of processes.slice(0, 100)) {
      memProcesses.push({
        device_id: devIdStr,
        pid: p.pid || 0,
        name: p.name || 'Unknown',
        cpu_pct: parseFloat(p.cpu_pct || 0),
        ram_mb: parseFloat(p.ram_mb || 0),
        path: p.path || null,
        user_account: p.user_account || null,
        updated_at: new Date()
      });
    }
  };

  // Single atomic transaction on MySQL connection pool
  if (isMysqlConnected() && pool) {
    let conn = null;
    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();

      await conn.query('DELETE FROM device_processes WHERE device_id = ?', [devIdStr]);

      const values = processes.slice(0, 100).map(p => [
        devIdStr,
        p.pid || 0,
        p.name || 'Unknown',
        parseFloat(p.cpu_pct || 0),
        parseFloat(p.ram_mb || 0),
        p.path || null,
        p.user_account || null
      ]);

      if (values.length > 0) {
        const insertSql = `
          INSERT INTO device_processes (device_id, pid, name, cpu_pct, ram_mb, path, user_account, updated_at)
          VALUES ?
        `;
        await conn.query(insertSql, [values]);
      }

      await conn.commit();
      updateMemoryProcesses();
      return true;
    } catch (err) {
      if (conn) {
        try {
          await conn.rollback();
        } catch (rbErr) {
          console.error('syncDeviceProcesses rollback error:', rbErr.message);
        }
      }
      console.error('syncDeviceProcesses transaction error:', err.message);
      return false;
    } finally {
      if (conn) {
        conn.release();
      }
    }
  }

  // In-memory fallback tracking
  updateMemoryProcesses();
  return true;
}

export async function getDeviceProcesses(deviceId) {
  const rows = await executeQuery(
    'SELECT * FROM device_processes WHERE device_id = ? ORDER BY cpu_pct DESC LIMIT 100',
    [String(deviceId)]
  );
  if (rows && rows.length > 0) {
    return rows;
  }
  return memProcesses.filter(p => p.device_id === String(deviceId));
}

// ---------------- COMMANDS ----------------
export async function queueCommandInDb(cmd) {
  try {
    const cmdId = cmd.id ? String(cmd.id) : crypto.randomUUID();
    cmd.id = cmdId;
    const memCmd = {
      id: cmdId,
      device_id: String(cmd.device_id || cmd.agent_id),
      agent_id: String(cmd.device_id || cmd.agent_id),
      hostname: cmd.hostname || null,
      command_type: cmd.kind || cmd.command_type,
      kind: cmd.kind || cmd.command_type,
      payload: typeof cmd.payload === 'string' ? JSON.parse(cmd.payload || '{}') : (cmd.payload || {}),
      hmac_signature: cmd.hmac_signature || null,
      signed_content: cmd.signed_content || null,
      status: (cmd.status || 'pending').toLowerCase(),
      dispatched_by: cmd.dispatched_by || 'ADMIN',
      dispatched_at: new Date()
    };
    memCommands.push(memCmd);

    const sql = `
      INSERT INTO command_queue (
        id, device_id, hostname, command_type, payload, hmac_signature, signed_content, status, dispatched_by, dispatched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))
    `;
    await executeQuery(sql, [
      cmdId,
      String(cmd.device_id || cmd.agent_id),
      cmd.hostname || null,
      cmd.kind || cmd.command_type,
      JSON.stringify(cmd.payload || {}),
      cmd.hmac_signature || null,
      cmd.signed_content || null,
      (cmd.status || 'PENDING').toUpperCase(),
      cmd.dispatched_by || 'ADMIN'
    ]);
    return true;
  } catch (err) {
    console.error('queueCommandInDb error:', err.message);
    return false;
  }
}

export async function getCommands(filters = {}) {
  let sql = 'SELECT * FROM command_queue';
  const conditions = [];
  const params = [];
  if (filters.status) {
    conditions.push('status = ?');
    params.push(String(filters.status).toUpperCase());
  }
  if (filters.device_id) {
    conditions.push('device_id = ?');
    params.push(String(filters.device_id));
  }
  if (filters.hostname) {
    conditions.push('hostname = ?');
    params.push(String(filters.hostname));
  }
  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`;
  }
  sql += ' ORDER BY dispatched_at DESC';

  const rows = await executeQuery(sql, params);
  if (rows && rows.length > 0) {
    return rows.map(r => ({
      ...r,
      agent_id: r.device_id,
      kind: r.command_type,
      payload: typeof r.payload === 'string' ? JSON.parse(r.payload || '{}') : (r.payload || {}),
      result: { output: r.stdout || '', stderr: r.stderr || '', exit_code: r.exit_code }
    }));
  }

  let filtered = [...memCommands];
  if (filters.status) {
    filtered = filtered.filter(c => c.status.toLowerCase() === String(filters.status).toLowerCase());
  }
  if (filters.device_id) {
    filtered = filtered.filter(c => String(c.device_id) === String(filters.device_id));
  }
  if (filters.hostname) {
    filtered = filtered.filter(c => c.hostname && c.hostname.toLowerCase() === String(filters.hostname).toLowerCase());
  }
  return filtered;
}

export async function getCommandById(id) {
  const c = memCommands.find(x => String(x.id) === String(id));
  if (c) {
    return {
      ...c,
      agent_id: c.device_id,
      kind: c.command_type,
      payload: typeof c.payload === 'string' ? JSON.parse(c.payload || '{}') : (c.payload || {}),
      result: c.result || { output: c.stdout || '', stderr: c.stderr || '', exit_code: c.exit_code || 0 }
    };
  }
  const rows = await executeQuery('SELECT * FROM command_queue WHERE id = ? LIMIT 1', [String(id)]);
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    ...r,
    agent_id: r.device_id,
    kind: r.command_type,
    payload: typeof r.payload === 'string' ? JSON.parse(r.payload || '{}') : (r.payload || {}),
    result: { output: r.stdout || '', stderr: r.stderr || '', exit_code: r.exit_code }
  };
}

export async function getPendingCommandsForDevice(deviceId, limit = 50) {
  const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 50, 500));
  const rows = await executeQuery(
    "SELECT * FROM command_queue WHERE device_id = ? AND status = 'PENDING' ORDER BY dispatched_at ASC LIMIT ?",
    [String(deviceId), safeLimit]
  );
  if (rows && rows.length > 0) {
    return rows.map(r => ({
      ...r,
      agent_id: r.device_id,
      kind: r.command_type,
      payload: typeof r.payload === 'string' ? JSON.parse(r.payload || '{}') : (r.payload || {})
    }));
  }
  const memResults = memCommands.filter(c => 
    (String(c.device_id).toLowerCase() === String(deviceId).toLowerCase() || 
     (c.hostname && String(c.hostname).toLowerCase() === String(deviceId).toLowerCase())) &&
    (c.status === 'pending' || c.status === 'PENDING')
  ).slice(0, safeLimit);
  return memResults.map(r => ({
    ...r,
    agent_id: r.device_id,
    kind: r.command_type,
    payload: typeof r.payload === 'string' ? JSON.parse(r.payload || '{}') : (r.payload || {})
  }));
}

export async function markCommandPickedUp(id) {
  const c = memCommands.find(x => String(x.id) === String(id));
  if (c) {
    c.status = 'in_progress';
    c.picked_up_at = new Date();
  }
  await executeQuery(
    "UPDATE command_queue SET status = 'in_progress', picked_up_at = NOW(3) WHERE id = ?",
    [String(id)]
  );
  return true;
}

export async function completeCommandInDb(cmdId, status, stdout, stderr, exitCode) {
  const c = memCommands.find(x => String(x.id) === String(cmdId));
  if (c) {
    c.status = status || 'completed';
    c.stdout = stdout || '';
    c.stderr = stderr || '';
    c.exit_code = exitCode !== undefined ? exitCode : 0;
    c.completed_at = new Date();
    c.result = { output: stdout || '', stderr: stderr || '', exit_code: exitCode !== undefined ? exitCode : 0 };
  }
  try {
    const sql = `
      UPDATE command_queue 
      SET status = ?, stdout = ?, stderr = ?, exit_code = ?, executed_at = NOW(3), completed_at = NOW(3)
      WHERE id = ?
    `;
    await executeQuery(sql, [status, stdout, stderr, exitCode, String(cmdId)]);
    return true;
  } catch (err) {
    console.error('completeCommandInDb error:', err.message);
    return false;
  }
}

// ---------------- ALERTS ----------------
export async function getAlerts(filters = {}) {
  let sql = 'SELECT * FROM alerts';
  const conditions = [];
  const params = [];
  if (filters.status) {
    conditions.push('status = ?');
    params.push(filters.status);
  }
  if (filters.severity) {
    conditions.push('severity = ?');
    params.push(filters.severity);
  }
  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`;
  }
  sql += ' ORDER BY created_at DESC';

  const rows = await executeQuery(sql, params);
  return rows.map(r => ({
    ...r,
    agent_id: r.device_id,
    rule: r.rule_name
  }));
}

export async function getAlertById(id) {
  const rows = await executeQuery('SELECT * FROM alerts WHERE id = ? LIMIT 1', [id]);
  if (!rows[0]) return null;
  const r = rows[0];
  return { ...r, agent_id: r.device_id, rule: r.rule_name };
}

export async function createAlert(alt) {
  const sql = `
    INSERT INTO alerts (tenant_id, device_id, agent_id, hostname, rule, rule_name, severity, message, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))
  `;
  const res = await executeQuery(sql, [
    alt.tenant_id || '00000000-0000-0000-0000-000000000001',
    String(alt.device_id || alt.agent_id || ''),
    alt.agent_id || null,
    alt.hostname || 'Unknown',
    alt.rule || alt.rule_name || 'System Alert',
    alt.rule_name || alt.rule || 'System Alert',
    alt.severity || 'warning',
    alt.message || '',
    alt.status || 'open'
  ]);
  const alertObj = {
    id: res.insertId,
    tenant_id: alt.tenant_id || '00000000-0000-0000-0000-000000000001',
    device_id: String(alt.device_id || alt.agent_id || ''),
    agent_id: alt.agent_id || null,
    hostname: alt.hostname || 'Unknown',
    rule: alt.rule || alt.rule_name || 'System Alert',
    rule_name: alt.rule_name || alt.rule || 'System Alert',
    severity: alt.severity || 'warning',
    message: alt.message || '',
    status: alt.status || 'open',
    created_at: new Date()
  };
  memAlerts.push(alertObj);
  return alertObj;
}

export async function updateAlert(id, updates) {
  const idx = memAlerts.findIndex(a => a.id === id || String(a.id) === String(id));
  if (idx >= 0) {
    memAlerts[idx] = { ...memAlerts[idx], ...updates };
  }
  const fields = [];
  const params = [];
  if (updates.status) { fields.push('status = ?'); params.push(updates.status); }
  if (updates.message) { fields.push('message = ?'); params.push(updates.message); }
  if (updates.status === 'resolved') { fields.push('resolved_at = NOW(3)'); }
  if (fields.length === 0) return false;
  params.push(id);
  await executeQuery(`UPDATE alerts SET ${fields.join(', ')} WHERE id = ?`, params);
  return true;
}

export async function resolveAlert(id) {
  const idx = memAlerts.findIndex(a => a.id === id || String(a.id) === String(id));
  if (idx >= 0) {
    memAlerts[idx].status = 'resolved';
    memAlerts[idx].resolved_at = new Date();
  }
  await executeQuery("UPDATE alerts SET status = 'resolved', resolved_at = NOW(3) WHERE id = ?", [id]);
  return true;
}

// ---------------- ALERT RULES ----------------
let alertRulesCache = null;
let alertRulesCacheExpires = 0;

export function invalidateAlertRulesCache() {
  alertRulesCache = null;
  alertRulesCacheExpires = 0;
}

export async function getAlertRules() {
  const now = Date.now();
  if (alertRulesCache && now < alertRulesCacheExpires) {
    return alertRulesCache;
  }
  const rows = await executeQuery('SELECT * FROM alert_rules ORDER BY created_at ASC');
  const rules = rows.map(r => ({
    ...r,
    enabled: Boolean(r.enabled),
    condition: r.condition_json ? (typeof r.condition_json === 'string' ? JSON.parse(r.condition_json) : r.condition_json) : { threshold_gb: r.threshold, memory_pct: r.threshold, cpu_pct: r.threshold }
  }));
  alertRulesCache = rules;
  alertRulesCacheExpires = now + 30000; // 30 seconds TTL
  return rules;
}

export async function getAlertRuleById(id) {
  const rows = await executeQuery('SELECT * FROM alert_rules WHERE id = ? LIMIT 1', [id]);
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    ...r,
    enabled: Boolean(r.enabled),
    condition: r.condition_json ? (typeof r.condition_json === 'string' ? JSON.parse(r.condition_json) : r.condition_json) : { threshold: r.threshold }
  };
}

export async function getAlertRuleByName(name) {
  const rows = await executeQuery('SELECT * FROM alert_rules WHERE name = ? LIMIT 1', [name]);
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    ...r,
    enabled: Boolean(r.enabled),
    condition: r.condition_json ? (typeof r.condition_json === 'string' ? JSON.parse(r.condition_json) : r.condition_json) : { threshold: r.threshold }
  };
}

export async function createAlertRule(rule) {
  const ruleId = rule.id || `rule-${crypto.randomUUID()}`;
  const sql = `
    INSERT INTO alert_rules (id, tenant_id, name, description, metric, condition_op, threshold, duration_mins, severity, enabled, condition_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))
  `;
  await executeQuery(sql, [
    ruleId,
    rule.tenant_id || '00000000-0000-0000-0000-000000000001',
    rule.name,
    rule.description || '',
    rule.metric || 'cpu',
    rule.condition_op || '>=',
    rule.threshold || 80,
    rule.duration_mins || 5,
    rule.severity || 'warning',
    rule.enabled !== false ? 1 : 0,
    JSON.stringify(rule.condition || {})
  ]);
  invalidateAlertRulesCache();
  return { id: ruleId, ...rule };
}

export async function updateAlertRule(id, updates) {
  const fields = [];
  const params = [];
  if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name); }
  if (updates.description !== undefined) { fields.push('description = ?'); params.push(updates.description); }
  if (updates.metric !== undefined) { fields.push('metric = ?'); params.push(updates.metric); }
  if (updates.condition_op !== undefined) { fields.push('condition_op = ?'); params.push(updates.condition_op); }
  if (updates.threshold !== undefined) { fields.push('threshold = ?'); params.push(updates.threshold); }
  if (updates.duration_mins !== undefined) { fields.push('duration_mins = ?'); params.push(updates.duration_mins); }
  if (updates.severity !== undefined) { fields.push('severity = ?'); params.push(updates.severity); }
  if (updates.enabled !== undefined) { fields.push('enabled = ?'); params.push(updates.enabled ? 1 : 0); }
  if (updates.condition !== undefined) { fields.push('condition_json = ?'); params.push(JSON.stringify(updates.condition)); }
  if (fields.length === 0) return false;
  params.push(id);
  await executeQuery(`UPDATE alert_rules SET ${fields.join(', ')} WHERE id = ?`, params);
  invalidateAlertRulesCache();
  return true;
}

export async function deleteAlertRule(id) {
  await executeQuery('DELETE FROM alert_rules WHERE id = ?', [id]);
  invalidateAlertRulesCache();
  return true;
}

// ---------------- GROUPS ----------------
export async function getGroups() {
  const rows = await executeQuery('SELECT * FROM groups ORDER BY created_at ASC');
  return rows;
}

export async function getGroupById(id) {
  const rows = await executeQuery('SELECT * FROM groups WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
}

export async function createGroup(grp) {
  const grpId = grp.id || `grp-${crypto.randomUUID()}`;
  const sql = `
    INSERT INTO groups (id, tenant_id, name, description, member_count, policy_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, NOW(3))
  `;
  await executeQuery(sql, [
    grpId,
    grp.tenant_id || '00000000-0000-0000-0000-000000000001',
    grp.name,
    grp.description || '',
    grp.member_count || 0,
    grp.policy_id || null
  ]);
  return { id: grpId, ...grp };
}

export async function updateGroup(id, updates) {
  const fields = [];
  const params = [];
  if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name); }
  if (updates.description !== undefined) { fields.push('description = ?'); params.push(updates.description); }
  if (updates.member_count !== undefined) { fields.push('member_count = ?'); params.push(updates.member_count); }
  if (updates.policy_id !== undefined) { fields.push('policy_id = ?'); params.push(updates.policy_id); }
  if (fields.length === 0) return false;
  params.push(id);
  await executeQuery(`UPDATE groups SET ${fields.join(', ')}, updated_at = NOW(3) WHERE id = ?`, params);
  return true;
}

export async function deleteGroup(id) {
  await executeQuery('DELETE FROM groups WHERE id = ?', [id]);
  return true;
}

// ---------------- POLICIES ----------------
export async function getPolicies() {
  const rows = await executeQuery('SELECT * FROM policies ORDER BY created_at ASC');
  return rows.map(r => ({
    ...r,
    auto_update: Boolean(r.auto_update),
    maintenance_mode: Boolean(r.maintenance_mode)
  }));
}

export async function getPolicyById(id) {
  const rows = await executeQuery('SELECT * FROM policies WHERE id = ? LIMIT 1', [id]);
  if (!rows[0]) return null;
  return {
    ...rows[0],
    auto_update: Boolean(rows[0].auto_update),
    maintenance_mode: Boolean(rows[0].maintenance_mode)
  };
}

export async function createPolicy(pol) {
  const polId = pol.id || `pol-${crypto.randomUUID()}`;
  const sql = `
    INSERT INTO policies (id, tenant_id, name, checkin_interval_sec, auto_update, maintenance_mode, data_retention_days, config, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(3))
  `;
  await executeQuery(sql, [
    polId,
    pol.tenant_id || '00000000-0000-0000-0000-000000000001',
    pol.name,
    pol.checkin_interval_sec || 30,
    pol.auto_update !== false ? 1 : 0,
    pol.maintenance_mode ? 1 : 0,
    pol.data_retention_days || 90,
    JSON.stringify(pol.config || {})
  ]);
  return { id: polId, ...pol };
}

export async function updatePolicy(id, updates) {
  const fields = [];
  const params = [];
  if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name); }
  if (updates.checkin_interval_sec !== undefined) { fields.push('checkin_interval_sec = ?'); params.push(updates.checkin_interval_sec); }
  if (updates.auto_update !== undefined) { fields.push('auto_update = ?'); params.push(updates.auto_update ? 1 : 0); }
  if (updates.maintenance_mode !== undefined) { fields.push('maintenance_mode = ?'); params.push(updates.maintenance_mode ? 1 : 0); }
  if (updates.data_retention_days !== undefined) { fields.push('data_retention_days = ?'); params.push(updates.data_retention_days); }
  if (updates.config !== undefined) { fields.push('config = ?'); params.push(JSON.stringify(updates.config)); }
  if (fields.length === 0) return false;
  params.push(id);
  await executeQuery(`UPDATE policies SET ${fields.join(', ')}, updated_at = NOW(3) WHERE id = ?`, params);
  return true;
}

export async function deletePolicy(id) {
  await executeQuery('DELETE FROM policies WHERE id = ?', [id]);
  return true;
}

// ---------------- MSI PACKAGES & BOOTSTRAP TOKENS ----------------
export async function getMsiPackages() {
  const rows = await executeQuery('SELECT * FROM msi_packages ORDER BY created_at DESC');
  return rows.map(r => ({
    ...r,
    used: Boolean(r.used)
  }));
}

export async function getMsiPackageById(id) {
  const rows = await executeQuery('SELECT * FROM msi_packages WHERE id = ? LIMIT 1', [id]);
  if (!rows[0]) return null;
  return { ...rows[0], used: Boolean(rows[0].used) };
}

export async function getMsiPackageByTokenHash(hash) {
  const rows = await executeQuery(
    'SELECT * FROM msi_packages WHERE bootstrap_token_hash = ? LIMIT 1',
    [hash]
  );
  if (!rows[0]) return null;
  return { ...rows[0], used: Boolean(rows[0].used) };
}

export async function createMsiPackage(pkg) {
  const pkgId = pkg.id || crypto.randomUUID();
  pkg.id = pkgId;
  const pkgRecord = {
    id: pkgId,
    tenant_id: pkg.tenant_id || '00000000-0000-0000-0000-000000000001',
    package_name: pkg.package_name,
    version: pkg.version || '1.0.0',
    bootstrap_token: pkg.bootstrap_token || null,
    bootstrap_token_hash: pkg.bootstrap_token_hash || null,
    token_expires_at: pkg.token_expires_at ? new Date(pkg.token_expires_at) : new Date(Date.now() + 86400000),
    used: pkg.used ? 1 : 0,
    created_by: pkg.created_by || 'ADMIN',
    file_path: pkg.file_path || null,
    download_url: pkg.download_url || null,
    file_hash_sha256: pkg.file_hash_sha256 || null,
    downloads_count: pkg.downloads_count || 0,
    created_at: new Date()
  };
  memMsiPackages.push(pkgRecord);

  const sql = `
    INSERT INTO msi_packages (
      id, tenant_id, package_name, version, bootstrap_token, bootstrap_token_hash,
      token_expires_at, used, created_by, file_path, download_url, file_hash_sha256,
      downloads_count, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))
  `;
  await executeQuery(sql, [
    pkgId,
    pkg.tenant_id || '00000000-0000-0000-0000-000000000001',
    pkg.package_name,
    pkg.version || '1.0.0',
    pkg.bootstrap_token || null,
    pkg.bootstrap_token_hash || null,
    pkg.token_expires_at ? new Date(pkg.token_expires_at) : new Date(Date.now() + 86400000),
    pkg.used ? 1 : 0,
    pkg.created_by || 'ADMIN',
    pkg.file_path || null,
    pkg.download_url || null,
    pkg.file_hash_sha256 || null,
    pkg.downloads_count || 0
  ]);
  return pkg;
}

export async function markMsiPackageUsed(id, hostname = null) {
  const p = memMsiPackages.find(x => x.id === id);
  if (p) {
    p.used = 1;
    p.used_at = new Date();
    p.used_by_device = hostname;
  }
  await executeQuery(
    'UPDATE msi_packages SET used = 1, used_at = NOW(3), used_by_device = ? WHERE id = ?',
    [hostname, id]
  );
  return true;
}

export async function incrementMsiDownloads(id) {
  const p = memMsiPackages.find(x => x.id === id);
  if (p) {
    p.downloads_count = (p.downloads_count || 0) + 1;
  }
  await executeQuery(
    'UPDATE msi_packages SET downloads_count = downloads_count + 1 WHERE id = ?',
    [id]
  );
  return true;
}

export async function isBootstrapTokenUsed(tokenOrHash) {
  const hash = tokenOrHash.length === 64 ? tokenOrHash : crypto.createHash('sha256').update(String(tokenOrHash).trim()).digest('hex');

  if (memBootstrapTokens.has(hash) || memBootstrapTokens.has(tokenOrHash)) {
    return true;
  }

  // Check used_bootstrap_tokens table
  const usedRows = await executeQuery(
    'SELECT id FROM used_bootstrap_tokens WHERE token_hash = ? LIMIT 1',
    [hash]
  );
  if (usedRows && usedRows.length > 0) return true;

  // Check msi_packages table
  const pkgRows = await executeQuery(
    'SELECT id FROM msi_packages WHERE (bootstrap_token = ? OR bootstrap_token_hash = ?) AND used = 1 LIMIT 1',
    [tokenOrHash, hash]
  );
  return Boolean(pkgRows && pkgRows.length > 0);
}

export async function markBootstrapTokenUsed(token, tokenHash, hostname, tenantId) {
  const hash = tokenHash || (token ? crypto.createHash('sha256').update(String(token).trim()).digest('hex') : '');
  if (!hash) return false;

  memBootstrapTokens.add(hash);
  if (token) memBootstrapTokens.add(token);

  const memPkg = memMsiPackages.find(p => p.bootstrap_token === token || p.bootstrap_token_hash === hash);
  if (memPkg) {
    memPkg.used = 1;
    memPkg.used_at = new Date();
    memPkg.used_by_device = hostname;
  }

  await executeQuery(
    'INSERT IGNORE INTO used_bootstrap_tokens (token_hash, token, device_hostname, tenant_id, used_at) VALUES (?, ?, ?, ?, NOW(3))',
    [hash, token || null, hostname || null, tenantId || null]
  );

  // Also update msi_packages if matching
  await executeQuery(
    'UPDATE msi_packages SET used = 1, used_at = NOW(3), used_by_device = ? WHERE bootstrap_token = ? OR bootstrap_token_hash = ?',
    [hostname, token, hash]
  );
  return true;
}

// ---------------- TICKETS ----------------
export async function getTickets() {
  const rows = await executeQuery('SELECT * FROM tickets ORDER BY created_at DESC');
  return rows;
}

export async function getTicketById(id) {
  const rows = await executeQuery('SELECT * FROM tickets WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
}

export async function createTicket(ticket) {
  const ticketId = ticket.id || `${ticket.project || 'ITSUP'}-${crypto.randomUUID()}`;
  ticket.id = ticketId;
  memTickets.push({
    id: ticketId,
    tenant_id: ticket.tenant_id || '00000000-0000-0000-0000-000000000001',
    system: ticket.system || 'Jira',
    title: ticket.title,
    status: ticket.status || 'Open',
    severity: ticket.severity || 'Medium',
    agent: ticket.agent || null,
    created_at: new Date()
  });
  const sql = `
    INSERT INTO tickets (id, tenant_id, system, title, status, severity, agent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NOW(3))
  `;
  await executeQuery(sql, [
    ticketId,
    ticket.tenant_id || '00000000-0000-0000-0000-000000000001',
    ticket.system || 'Jira',
    ticket.title,
    ticket.status || 'Open',
    ticket.severity || 'Medium',
    ticket.agent || null
  ]);
  return ticket;
}

export async function updateTicket(id, updates) {
  const fields = [];
  const params = [];
  if (updates.status) { fields.push('status = ?'); params.push(updates.status); }
  if (updates.severity) { fields.push('severity = ?'); params.push(updates.severity); }
  if (updates.title) { fields.push('title = ?'); params.push(updates.title); }
  if (fields.length === 0) return false;
  params.push(id);
  await executeQuery(`UPDATE tickets SET ${fields.join(', ')}, updated_at = NOW(3) WHERE id = ?`, params);
  return true;
}

// ---------------- REMEDIATION POLICIES & LOGS ----------------
export async function getRemediationPolicies() {
  const rows = await executeQuery('SELECT * FROM remediation_policies ORDER BY id ASC');
  return rows.map(r => ({ ...r, enabled: Boolean(r.enabled) }));
}

export async function getRemediationPolicyById(id) {
  const rows = await executeQuery('SELECT * FROM remediation_policies WHERE id = ? LIMIT 1', [id]);
  if (!rows[0]) return null;
  return { ...rows[0], enabled: Boolean(rows[0].enabled) };
}

export async function getRemediationPolicyByActionType(actionType) {
  if (!actionType) return null;
  const rows = await executeQuery('SELECT * FROM remediation_policies WHERE action_type = ? LIMIT 1', [String(actionType)]);
  if (!rows[0]) return null;
  return { ...rows[0], enabled: Boolean(rows[0].enabled) };
}

export async function createRemediationPolicy(pol) {
  const polId = pol.id || `rem-${crypto.randomUUID()}`;
  pol.id = polId;
  const sql = `
    INSERT INTO remediation_policies (id, name, description, enabled, trigger_condition, action_type, executions_count)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;
  await executeQuery(sql, [
    polId,
    pol.name,
    pol.description || '',
    pol.enabled !== false ? 1 : 0,
    pol.trigger_condition || '',
    pol.action_type,
    pol.executions_count || 0
  ]);
  return pol;
}

export async function updateRemediationPolicy(id, updates) {
  const fields = [];
  const params = [];
  if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name); }
  if (updates.description !== undefined) { fields.push('description = ?'); params.push(updates.description); }
  if (updates.enabled !== undefined) { fields.push('enabled = ?'); params.push(updates.enabled ? 1 : 0); }
  if (updates.trigger_condition !== undefined) { fields.push('trigger_condition = ?'); params.push(updates.trigger_condition); }
  if (updates.action_type !== undefined) { fields.push('action_type = ?'); params.push(updates.action_type); }
  if (updates.executions_count !== undefined) { fields.push('executions_count = ?'); params.push(updates.executions_count); }
  if (fields.length === 0) return false;
  params.push(id);
  await executeQuery(`UPDATE remediation_policies SET ${fields.join(', ')} WHERE id = ?`, params);
  return true;
}

export async function logRemediation(entry) {
  const memEntry = { id: Date.now(), ...entry, executed_at: new Date() };
  memRemediationLogs.push(memEntry);
  const sql = `
    INSERT INTO remediation_logs (hostname, policy_name, action, status, executed_at)
    VALUES (?, ?, ?, ?, NOW(3))
  `;
  const res = await executeQuery(sql, [
    entry.hostname,
    entry.policy_name,
    entry.action,
    entry.status || 'success'
  ]);
  return { id: res?.insertId || memEntry.id, ...entry };
}

export async function getRemediationLogs(limit = 100) {
  const rows = await executeQuery(
    'SELECT * FROM remediation_logs ORDER BY executed_at DESC LIMIT ?',
    [limit]
  );
  return rows;
}

// ---------------- EVENTS ----------------
export async function addEvent(event) {
  const sql = `
    INSERT INTO events (hostname, kind, sanitized, payload, captured_at)
    VALUES (?, ?, ?, ?, NOW(3))
  `;
  const res = await executeQuery(sql, [
    event.hostname,
    event.kind,
    event.sanitized !== false ? 1 : 0,
    JSON.stringify(event.payload || {})
  ]);
  const newEvt = { id: res.insertId, ...event, captured_at: new Date() };
  memEvents.push(newEvt);
  return newEvt;
}

export async function getEvents(hostname = null, limit = 100, kind = null) {
  let sql = 'SELECT * FROM events';
  const conditions = [];
  const params = [];
  if (hostname) {
    conditions.push('hostname = ?');
    params.push(String(hostname).trim());
  }
  if (kind) {
    conditions.push('kind = ?');
    params.push(String(kind).trim());
  }
  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`;
  }
  sql += ' ORDER BY captured_at DESC LIMIT ?';
  params.push(limit);

  const rows = await executeQuery(sql, params);
  return rows.map(r => ({
    ...r,
    sanitized: Boolean(r.sanitized),
    payload: typeof r.payload === 'string' ? JSON.parse(r.payload || '{}') : (r.payload || {})
  }));
}

// ---------------- AUDIT LOGS ----------------
export async function logAuditToDb(entry) {
  const id = entry.id || crypto.randomUUID();
  try {
    const sql = `
      INSERT INTO audit_logs (
        id, tenant_id, actor_id, actor_email, actor, action, target_resource, details, ip_address, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))
    `;
    await executeQuery(sql, [
      id,
      entry.tenant_id || '00000000-0000-0000-0000-000000000001',
      entry.actor_id || null,
      entry.actor_email || null,
      entry.actor || entry.actor_email || 'SYSTEM',
      entry.action,
      entry.target_resource,
      JSON.stringify(entry.details || {}),
      entry.ip_address || entry.client_ip || '127.0.0.1'
    ]);
  } catch (err) {
    console.error('logAuditToDb error:', err.message);
  }
  // Bounded memory store for audit logs
  memAuditLogs.push({
    id,
    tenant_id: entry.tenant_id || '00000000-0000-0000-0000-000000000001',
    actor_id: entry.actor_id || null,
    actor_email: entry.actor_email || null,
    actor: entry.actor || entry.actor_email || 'SYSTEM',
    action: entry.action,
    target_resource: entry.target_resource,
    details: entry.details || {},
    client_ip: entry.ip_address || entry.client_ip || '127.0.0.1',
    created_at: new Date()
  });
  return true;
}

export async function getAuditLogs(limit = 100) {
  const rows = await executeQuery(
    'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?',
    [limit]
  );
  return rows.map(r => ({
    ...r,
    details: typeof r.details === 'string' ? JSON.parse(r.details || '{}') : (r.details || {}),
    client_ip: r.ip_address
  }));
}

// ---------------- SYSTEM SETTINGS (Retention, Branding, TicketConfig, Webhook) ----------------
export async function getSetting(key, defaultValue = null) {
  try {
    const rows = await executeQuery('SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 1', [key]);
    if (!rows[0]) return defaultValue;
    const val = rows[0].setting_value;
    return typeof val === 'string' ? JSON.parse(val) : val;
  } catch (err) {
    return defaultValue;
  }
}

export async function setSetting(key, value) {
  memSettings.set(key, value);
  const sql = `
    INSERT INTO system_settings (setting_key, setting_value, updated_at)
    VALUES (?, ?, NOW(3))
    ON DUPLICATE KEY UPDATE
      setting_value = VALUES(setting_value),
      updated_at = NOW(3)
  `;
  await executeQuery(sql, [key, JSON.stringify(value)]);
  return true;
}

export async function getRetentionSettings() {
  const defaults = {
    raw_telemetry_days: 30,
    aggregated_metrics_days: 365,
    audit_logs_days: 730,
    resolved_alerts_days: 90,
    completed_commands_days: 30,
    slack_webhook_url: process.env.SLACK_WEBHOOK_URL || '',
    teams_webhook_url: process.env.TEAMS_WEBHOOK_URL || '',
    email_notifications_enabled: true,
    notification_email: 'sec-alerts@aaditech.com'
  };
  const saved = await getSetting('retentionSettings', defaults);
  return { ...defaults, ...saved };
}

export async function updateRetentionSettings(updates) {
  const current = await getRetentionSettings();
  const merged = { ...current, ...updates };
  await setSetting('retentionSettings', merged);
  return merged;
}

// ---------------- DATA RETENTION ENGINE ----------------
let lastRetentionRun = null;
let retentionSchedulerTimer = null;

export function getLastRetentionRun() {
  return lastRetentionRun;
}

export async function runDataRetentionPurge() {
  const startTime = Date.now();
  const retention = await getRetentionSettings();

  const rawTelemetryDays = Math.max(1, parseInt(retention.raw_telemetry_days, 10) || 30);
  const auditLogsDays = Math.max(1, parseInt(retention.audit_logs_days, 10) || 730);
  const resolvedAlertsDays = Math.max(1, parseInt(retention.resolved_alerts_days, 10) || 90);
  const completedCommandsDays = Math.max(1, parseInt(retention.completed_commands_days, 10) || 30);

  const purged = {
    telemetry_history: 0,
    audit_logs: 0,
    alerts: 0,
    command_queue: 0,
    events: 0,
    total: 0,
    dropped_partitions: []
  };

  try {
    // 1. Maintain telemetry range partitions: create forward partitions & drop expired partitions
    try {
      const partResults = await maintainTelemetryPartitions(rawTelemetryDays);
      if (partResults && Array.isArray(partResults.dropped) && partResults.dropped.length > 0) {
        purged.dropped_partitions.push(...partResults.dropped);
      }
    } catch (_) {}

    // 2. Fallback check for DB-level partitions on telemetry_history to drop expired partitions
    try {
      const partitionRows = await executeQuery(`
        SELECT PARTITION_NAME, PARTITION_DESCRIPTION 
        FROM INFORMATION_SCHEMA.PARTITIONS 
        WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'telemetry_history' 
          AND PARTITION_NAME IS NOT NULL 
          AND PARTITION_NAME != 'p_future'
      `);

      if (Array.isArray(partitionRows) && partitionRows.length > 0) {
        const cutoffDate = new Date(Date.now() - (rawTelemetryDays * 86400000));
        const cutoffToDays = Math.floor(cutoffDate.getTime() / 86400000) + 719528;
        for (const part of partitionRows) {
          const partVal = parseInt(part.PARTITION_DESCRIPTION, 10);
          if (!isNaN(partVal) && partVal < cutoffToDays && !purged.dropped_partitions.includes(part.PARTITION_NAME)) {
            try {
              await executeQuery(`ALTER TABLE telemetry_history DROP PARTITION ${part.PARTITION_NAME}`);
              purged.dropped_partitions.push(part.PARTITION_NAME);
            } catch (pErr) {
              console.warn(`Could not drop partition ${part.PARTITION_NAME}:`, pErr.message);
            }
          }
        }
      }
    } catch (_) {
      // Partition query not supported or table unpartitioned; proceed to standard delete
    }

    // Standard bulk deletion on indexed timestamp columns
    const resTelem = await executeQuery(
      'DELETE FROM telemetry_history WHERE recorded_at < NOW() - INTERVAL ? DAY',
      [rawTelemetryDays]
    );
    purged.telemetry_history = (resTelem && resTelem.affectedRows) || 0;

    const resAudit = await executeQuery(
      'DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL ? DAY',
      [auditLogsDays]
    );
    purged.audit_logs = (resAudit && resAudit.affectedRows) || 0;

    const resAlerts = await executeQuery(
      "DELETE FROM alerts WHERE status = 'resolved' AND (resolved_at < NOW() - INTERVAL ? DAY OR (resolved_at IS NULL AND created_at < NOW() - INTERVAL ? DAY))",
      [resolvedAlertsDays, resolvedAlertsDays]
    );
    purged.alerts = (resAlerts && resAlerts.affectedRows) || 0;

    const resCmds = await executeQuery(
      "DELETE FROM command_queue WHERE status IN ('COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED') AND (completed_at < NOW() - INTERVAL ? DAY OR (completed_at IS NULL AND dispatched_at < NOW() - INTERVAL ? DAY))",
      [completedCommandsDays, completedCommandsDays]
    );
    purged.command_queue = (resCmds && resCmds.affectedRows) || 0;

    // In-memory prune for degraded mode and memory bounding
    const now = Date.now();
    const telemCutoff = now - (rawTelemetryDays * 86400000);
    const auditCutoff = now - (auditLogsDays * 86400000);
    const alertCutoff = now - (resolvedAlertsDays * 86400000);
    const cmdCutoff = now - (completedCommandsDays * 86400000);

    const initialTelemLen = memTelemetry.length;
    for (let i = memTelemetry.length - 1; i >= 0; i--) {
      const t = new Date(memTelemetry[i].recorded_at || 0).getTime();
      if (t < telemCutoff) memTelemetry.splice(i, 1);
    }
    purged.telemetry_history += Math.max(0, initialTelemLen - memTelemetry.length);

    const initialAuditLen = memAuditLogs.length;
    for (let i = memAuditLogs.length - 1; i >= 0; i--) {
      const t = new Date(memAuditLogs[i].created_at || 0).getTime();
      if (t < auditCutoff) memAuditLogs.splice(i, 1);
    }
    purged.audit_logs += Math.max(0, initialAuditLen - memAuditLogs.length);

    const initialAlertLen = memAlerts.length;
    for (let i = memAlerts.length - 1; i >= 0; i--) {
      const a = memAlerts[i];
      if (a.status === 'resolved') {
        const t = new Date(a.resolved_at || a.created_at || 0).getTime();
        if (t < alertCutoff) memAlerts.splice(i, 1);
      }
    }
    purged.alerts += Math.max(0, initialAlertLen - memAlerts.length);

    const initialCmdLen = memCommands.length;
    for (let i = memCommands.length - 1; i >= 0; i--) {
      const c = memCommands[i];
      const s = String(c.status || '').toUpperCase();
      if (['COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(s)) {
        const t = new Date(c.completed_at || c.dispatched_at || 0).getTime();
        if (t < cmdCutoff) memCommands.splice(i, 1);
      }
    }
    purged.command_queue += Math.max(0, initialCmdLen - memCommands.length);

    const initialEvtLen = memEvents.length;
    for (let i = memEvents.length - 1; i >= 0; i--) {
      const t = new Date(memEvents[i].captured_at || 0).getTime();
      if (t < telemCutoff) {
        memEvents.splice(i, 1);
      }
    }
    purged.events += Math.max(0, initialEvtLen - memEvents.length);

    purged.total = purged.telemetry_history + purged.audit_logs + purged.alerts + purged.command_queue + purged.events;
  } catch (err) {
    console.error('runDataRetentionPurge error:', err.message);
  }

  const durationMs = Date.now() - startTime;
  lastRetentionRun = {
    timestamp: new Date().toISOString(),
    duration_ms: durationMs,
    purged_rows: purged,
    settings_applied: {
      raw_telemetry_days: rawTelemetryDays,
      audit_logs_days: auditLogsDays,
      resolved_alerts_days: resolvedAlertsDays,
      completed_commands_days: completedCommandsDays
    },
    status: 'SUCCESS'
  };

  try {
    await logAuditToDb({
      actor: 'SYSTEM_CRON',
      action: 'DATA_RETENTION_PURGE_COMPLETED',
      target_resource: 'Database',
      details: lastRetentionRun
    });
  } catch (_) {}

  return lastRetentionRun;
}

export function initRetentionScheduler(intervalMs = 3600000) {
  if (retentionSchedulerTimer) clearInterval(retentionSchedulerTimer);

  setTimeout(() => {
    runDataRetentionPurge().catch(e => console.error('Retention initial run notice:', e.message));
  }, 4000);

  retentionSchedulerTimer = setInterval(() => {
    runDataRetentionPurge().catch(e => console.error('Scheduled retention purge error:', e.message));
  }, intervalMs);

  return retentionSchedulerTimer;
}

export async function getTicketConfig() {
  const defaults = {
    system: 'jira',
    url: 'https://aaditech.atlassian.net',
    project: 'ITSUP',
    auto_create_on_critical: true
  };
  const saved = await getSetting('ticketConfig', defaults);
  return { ...defaults, ...saved };
}

export async function updateTicketConfig(updates) {
  const current = await getTicketConfig();
  const merged = { ...current, ...updates };
  await setSetting('ticketConfig', merged);
  return merged;
}

export async function getBranding() {
  const defaults = {
    company_name: 'Aaditech Enterprise',
    server_host: 'localhost',
    branding: { color: '#38bdf8', logo_text: 'IT-Toolkit' },
    build_mode: 'github',
    github_repo: 'rehman2671/Aaditech-toolkit',
    github_token: process.env.GITHUB_TOKEN || process.env.API_TOKEN || '',
    rollout_target: '',
    default_company_id: 1,
    setup_complete: true
  };
  const saved = await getSetting('branding', defaults);
  return { ...defaults, ...saved };
}

export async function updateBranding(updates) {
  const current = await getBranding();
  const merged = { ...current, ...updates };
  await setSetting('branding', merged);
  return merged;
}

export async function getWebhookConfig() {
  const defaults = {
    enabled: false,
    url: '',
    type: 'generic',
    token: ''
  };
  const saved = await getSetting('webhookConfig', defaults);
  return { ...defaults, ...saved };
}

export async function updateWebhookConfig(updates) {
  const current = await getWebhookConfig();
  const merged = { ...current, ...updates };
  await setSetting('webhookConfig', merged);
  return merged;
}

// ---------------- TOKEN REVOCATION ----------------
export async function revokeTokenInDb(tokenOrJti) {
  if (!tokenOrJti) return false;
  memRevokedTokens.add(tokenOrJti);
  await executeQuery(
    'INSERT IGNORE INTO revoked_tokens (token_or_jti, revoked_at) VALUES (?, NOW(3))',
    [tokenOrJti]
  );
  return true;
}

export async function isTokenRevokedInDb(tokenOrJti) {
  if (!tokenOrJti) return false;
  const rows = await executeQuery(
    'SELECT token_or_jti FROM revoked_tokens WHERE token_or_jti = ? LIMIT 1',
    [tokenOrJti]
  );
  return Boolean(rows && rows.length > 0);
}

// ---------------- FEATURES & PATCHES ----------------
export async function getFeatures() {
  const defaults = [
    { name: "bitlocker", label: "BitLocker Protection", description: "Collects BitLocker encryption and key escrow status.", script: "Enterprise/agent/collectors/Get-BitLockerStatus.ps1", enabled: true, config: { enforce: true } },
    { name: "disk_health", label: "Disk Health & SMART", description: "Monitors drive SMART status and remaining capacity.", script: "Enterprise/agent/collectors/Get-DiskHealth.ps1", enabled: true, config: { threshold_gb: 20 } },
    { name: "software_inventory", label: "Software Inventory", description: "Audits installed software for compliance.", script: "Enterprise/agent/collectors/Get-SoftwareInventory.ps1", enabled: true, config: { include_system: false } },
    { name: "system_health", label: "System Health & Uptime", description: "Monitors CPU, RAM, uptime, and reboot pending status.", script: "Enterprise/agent/collectors/Get-SystemHealth.ps1", enabled: true, config: { interval_seconds: 300 } },
    { name: "windows_updates", label: "Windows Update Status", description: "Tracks OS update compliance and pending patches.", script: "Enterprise/agent/collectors/Get-WindowsUpdateStatus.ps1", enabled: true, config: { auto_install_critical: true } },
    { name: "hardware_inventory", label: "Hardware Inventory", description: "Collects CPU, RAM, motherboard and battery wear telemetry.", script: "Enterprise/agent/collectors/Get-HardwareInventory.ps1", enabled: true, config: {} },
    { name: "license_info", label: "License Audit", description: "Audits Windows and Office key product IDs (admin only).", script: "Enterprise/agent/collectors/Get-LicenseInfo.ps1", enabled: false, config: {} }
  ];
  const saved = await getSetting('featuresConfig', defaults);
  return saved || defaults;
}

export async function updateFeature(name, updates) {
  const features = await getFeatures();
  const idx = features.findIndex(f => f.name === name);
  if (idx !== -1) {
    if (updates.enabled !== undefined) features[idx].enabled = updates.enabled;
    if (updates.config) features[idx].config = updates.config;
    await setSetting('featuresConfig', features);
    return features[idx];
  }
  return null;
}

export async function getPatchInventory() {
  const defaults = [
    { id: "kb-5034441", title: "2026-08 Cumulative Security Update for Windows 11 (KB5034441)", severity: "Critical", status: "PENDING_APPROVAL", affected_devices: 4, release_date: "2026-08-01" },
    { id: "kb-5034123", title: "Security Update for .NET Framework 4.8.1 (KB5034123)", severity: "Important", status: "APPROVED", affected_devices: 2, release_date: "2026-07-15" }
  ];
  const saved = await getSetting('patchInventory', defaults);
  return saved || defaults;
}

export async function updatePatchStatus(id, status) {
  const patches = await getPatchInventory();
  const patch = patches.find(p => p.id === id);
  if (patch) {
    patch.status = status;
    await setSetting('patchInventory', patches);
    return patch;
  }
  return null;
}

