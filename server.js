import { scopedAlertRules, isApprovedWebhookUrl, deliverTenantWebhook } from './tenant-alert-safety.js';
import { smtpTransportConfig, isApprovedEmailRecipient, deliverTenantEmail } from './smtp-alerts.js';
import { startNotificationOutboxWorker } from './notification-outbox.js';
import { destinationFingerprint } from './notification-destination.js';
import { approvedGithubBuildConfig, readApprovedBuildStatus, dispatchApprovedBuild } from './github-build-release.js';
/**
 * ARCHITECTURAL HARD PREREQUISITE: STATELESSNESS FOR MULTI-INSTANCE / CLUSTER DEPLOYMENTS
 * 
 * This application is configured to run under PM2 cluster mode ('pm2 start ecosystem.config.cjs'
 * or 'pm2 start server.js -i max') and behind multi-replica container orchestrators.
 * 
 * CRITICAL RULE:
 * NEVER introduce mutable in-process in-memory state (such as local arrays, maps, or global singletons)
 * for shared enterprise data (devices, sessions, token revocations, commands, alert rules, or metrics).
 * All authoritative state MUST reside in persistent MySQL storage and distributed Redis caching.
 * Violating this rule will cause silent multi-worker drift and split-brain failures.
 */
import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';
import crypto from 'crypto';
import fs from 'fs';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import * as db from './db.js';
import { isValidSetupKey, isSeededDemoPasswordHash } from './setup-security.js';
import { validateEnrollmentIdentity, validateFreshEnrollment, matchesEnrolledDeviceIdentifier, extractEnrolledDeviceHeaderToken, validateDeviceRevocationRequest } from './enrollment-security.js';
import { resolveAgentOrigin } from './agent-origin.js';
import { resolveVerifiedUserPrincipal, requiresPersistedUserAuthorization } from './auth-principal.js';
import { isPlatformSettingsAdmin } from './platform-settings-admin.js';
import { belongsToCurrentTenant, publicDeviceRecord } from './device-visibility.js';
import { normalizeAgentPosture, agentReportedCoverage } from './security-posture.js';
import { extractMeasurements, analyzeMeasuredTelemetry, evaluateMeasuredAlert } from './device-metrics.js';
import { signDeviceCommand } from './command-signing.js';
import {
  getAgentVersion,
  getAgentVersionInfo,
  getCaCertificate,
  resolveAgentMsi,
  matchesApprovedReleaseHash
} from './agent-artifacts.js';
import {
  validateBody,
  parsePagination,
  sendPaginated,
  loginSchema,
  agentEnrollSchema,
  deviceRegistrationSchema,
  telemetryIngestSchema,
  commandDispatchSchema,
  commandResultSchema,
  msiGenerateSchema,
  createAlertRuleSchema,
  updateAlertRuleSchema,
  webhookConfigSchema,
  tenantEmailConfigSchema,
  createGroupSchema,
  updateGroupSchema,
  createPolicySchema,
  updatePolicySchema,
  assignPolicySchema,
  updateRetentionSchema,
  batchReceiptMaintenanceSchema,
  setupSchema,
  createUserSchema,
  updateUserSchema,
  workspaceSelectSchema,
  workspaceGrantSchema,
  tenantBrandingSchema,
  createCompanySchema,
  defaultCompanySchema,
  updateFeatureSchema,
  updateTargetVersionSchema,
  buildTriggerSchema,
  updateRemediationPolicySchema,
  remediationTriggerSchema,
  ticketConfigSchema,
  createTicketSchema
} from './validation.js';

const {
  initDbPool,
  isMysqlConnected,
  syncDeviceToDb,
  insertTelemetryRecord,
  syncDeviceProcesses,
  queueCommandInDb,
  getPendingCommandsForDevice,
  completeCommandInDb,
  logAuditToDb
} = db;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Security Environment Verification (Strict: required in ALL environments, no hardcoded fallback defaults)
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.trim() === '') {
  console.error("FATAL: JWT_SECRET environment variable is required! Server cannot start.");
  process.exit(1);
}
const EFFECTIVE_JWT_SECRET = JWT_SECRET;

// Boot validation for agent security secrets (strictly required, no hardcoded fallback defaults)
const BOOTSTRAP_SECRET = process.env.BOOTSTRAP_SECRET;
if (!BOOTSTRAP_SECRET || BOOTSTRAP_SECRET.trim() === '') {
  console.error("FATAL: BOOTSTRAP_SECRET environment variable is required! Server cannot start without a secure bootstrap secret.");
  process.exit(1);
}

const COMMAND_SIGNING_KEY = process.env.COMMAND_SIGNING_KEY;
if (!COMMAND_SIGNING_KEY || COMMAND_SIGNING_KEY.trim() === '') {
  console.error("FATAL: COMMAND_SIGNING_KEY environment variable is required! Server cannot start without a secure command signing key.");
  process.exit(1);
}

const HMAC_SECRET = process.env.HMAC_SECRET;
if (!HMAC_SECRET || HMAC_SECRET.trim() === '') {
  console.error("FATAL: HMAC_SECRET environment variable is required! Server cannot start.");
  process.exit(1);
}

const AGENT_API_TOKEN = process.env.API_TOKEN;
if (!AGENT_API_TOKEN || AGENT_API_TOKEN.trim() === '') {
  console.error("FATAL: API_TOKEN environment variable is required! Server cannot start.");
  process.exit(1);
}

// Initial public setup must require a separate operator-held secret. A blank
// setup token would allow anyone who reaches the domain first to become admin.
const INITIAL_SETUP_TOKEN = process.env.SETUP_TOKEN || '';
// Only the explicit test profile may use seeded credentials without setup.
const REQUIRE_SECURE_SETUP = process.env.NODE_ENV !== 'test';
if (REQUIRE_SECURE_SETUP && INITIAL_SETUP_TOKEN.length < 32) {
  console.error('FATAL: SETUP_TOKEN (at least 32 characters) is required outside the explicit test environment.');
  process.exit(1);
}

// Server-side revocation registry for invalidated tokens and JTIs (cached in memory + persistent in MySQL)
const revokedTokens = new Set();

const app = express();
const PORT = process.env.PORT || 3000;

// Trust front-end reverse proxies (Nginx / Cloud Run) for rate limiting & IP resolution
app.set('trust proxy', 1);

// Security Headers (Helmet) - configured to allow portal iframe embedding
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Response Compression
app.use(compression());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// ---------------- RATE LIMITING SUBSYSTEM ----------------
// General API Rate Limiter (UI and standard client requests)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  message: { error: "Too Many Requests", detail: "API rate limit exceeded. Please retry in a few minutes." }
});

// Authentication Rate Limiter (brute-force defense on login)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  message: { error: "Too Many Requests", detail: "Too many login attempts. Please try again later." }
});

// Agent Rate Limiter (tuned for high-frequency telemetry and polling)
const agentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req) => {
    const token = req.headers['x-device-token'] || 
                  req.headers['x-device-uid'] || 
                  req.body?.hostname || 
                  req.body?.device_id || 
                  req.query?.hostname || 
                  req.query?.device_id;
    if (token) return `agent:${token}`;
    return req.ip || req.socket?.remoteAddress || 'unknown-agent';
  },
  message: { error: "Too Many Requests", detail: "Agent request rate limit exceeded." }
});

// ---------------- DEVICE AUTHENTICATION & CRYPTOGRAPHY SUBSYSTEM ----------------
function hashDeviceToken(rawToken) {
  if (!rawToken) return '';
  return crypto.createHash('sha256').update(String(rawToken).trim()).digest('hex');
}

function generateDeviceToken() {
  return `itk_dev_${crypto.randomBytes(24).toString('hex')}`;
}

function generateBootstrapToken(tenantId, groupId, expiryHours = 24) {
  const expiresAt = Date.now() + expiryHours * 3600 * 1000;
  const payload = `${tenantId}:${groupId}:${expiresAt}`;
  const signature = crypto.createHmac('sha256', BOOTSTRAP_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}:${signature}`).toString('base64url');
}

async function verifyBootstrapToken(token) {
  if (!token || typeof token !== 'string') {
    return { valid: false, reason: "Missing bootstrap token" };
  }

  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length < 4) {
      return { valid: false, reason: "Malformed bootstrap token format" };
    }
    const [tenantId, groupId, expiresAtStr, signature] = parts;
    const payload = `${tenantId}:${groupId}:${expiresAtStr}`;
    const expectedSig = crypto.createHmac('sha256', BOOTSTRAP_SECRET).update(payload).digest('hex');

    const sigBuf = Buffer.from(signature, 'hex');
    const expBuf = Buffer.from(expectedSig, 'hex');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return { valid: false, reason: "Invalid bootstrap token signature" };
    }

    const expiresAt = parseInt(expiresAtStr, 10);
    if (isNaN(expiresAt) || Date.now() > expiresAt) {
      return { valid: false, reason: "Bootstrap token has expired", expired: true };
    }

    const tokenHash = hashDeviceToken(token);
    const isUsed = await db.isBootstrapTokenUsed(token);
    if (isUsed) {
      return { valid: false, reason: "Bootstrap token has already been used (single-use)", alreadyUsed: true };
    }

    const pkg = await db.getMsiPackageByTokenHash(tokenHash);
    if (pkg && pkg.used) {
      return { valid: false, reason: "Bootstrap token has already been used (single-use)", alreadyUsed: true };
    }

    if (pkg && pkg.token_expires_at && new Date(pkg.token_expires_at).getTime() < Date.now()) {
      return { valid: false, reason: "Bootstrap token has expired", expired: true };
    }

    return { valid: true, tenantId, groupId, expiresAt, pkg };
  } catch (e) {
    return { valid: false, reason: `Failed to verify bootstrap token: ${e.message}` };
  }
}

async function consumeBootstrapToken(token, enrolledDeviceHostname, tenantId) {
  const tokenHash = hashDeviceToken(token);
  return await db.markBootstrapTokenUsed(token, tokenHash, enrolledDeviceHostname, tenantId);
}

// Remote executable commands use a per-device HMAC key from the authenticated poll, never a fleet-wide signing secret.

// ---------------- TENANT-ISOLATED OUTBOUND ALERT DISPATCHER ----------------
// Never use platform-global retention/webhook URLs for customer telemetry.
// Explicit per-tenant consent and an operator-owned HTTPS host allowlist are required.
// Automatic notifications are transactionally queued in createAlert();
// network delivery is performed only by the MySQL-backed outbox worker.

// Security & Audit Helpers (backed by MySQL audit_logs table)
function logAudit(actor, action, targetResource, details, req) {
  const logEntry = {
    id: crypto.randomUUID(),
    tenant_id: actor?.tenant_id || "00000000-0000-0000-0000-000000000001",
    actor_id: actor?.id || "00000000-0000-0000-0000-000000000002",
    actor_email: actor?.email || actor?.username || "admin@aaditech.com",
    actor: typeof actor === 'object' ? (actor.username || actor.email) : (actor || 'system'),
    action,
    target_resource: targetResource,
    details,
    client_ip: req?.ip || req?.headers?.['x-forwarded-for'] || '127.0.0.1',
    created_at: new Date().toISOString()
  };
  logAuditToDb(logEntry).catch(err => console.error('logAudit error:', err.message));
  return logEntry;
}

// ---------------- HEALTHZ & PROMETHEUS METRICS ----------------
app.get(['/healthz', '/api/health', '/api/v1/health'], async (req, res) => {
  const retentionRun = db.getLastRetentionRun();
  // Readiness must reflect the backing database, not just an open HTTP port.
  // Test fixtures intentionally exercise the in-memory fallback separately.
  const databaseReady = await db.probeDbReadiness();
  // Only the explicit isolated test profile permits a healthy synthetic
  // database. Never let VITEST=true or an unset/staging NODE_ENV disguise a
  // missing persistent MySQL backing store in an actual deployment.
  const isProductionDatabaseDown = process.env.NODE_ENV !== 'test' && !databaseReady;
  res.status(isProductionDatabaseDown ? 503 : 200).json({
    status: isProductionDatabaseDown ? 'degraded' : 'ok',
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
    components: {
      database: databaseReady ? "HEALTHY" : "DEGRADED",
      // No readiness probe exists for these subsystems; never manufacture
      // operational or signed-artifact readiness from HTTP server liveness.
      ingest_queue: "NOT_VERIFIED",
      msi_builder: "EXTERNAL_SIGNING_REQUIRED",
      audit_engine: "NOT_VERIFIED"
    },
    data_retention: retentionRun ? {
      last_run_at: retentionRun.timestamp,
      duration_ms: retentionRun.duration_ms,
      purged_rows: retentionRun.purged_rows,
      settings_applied: retentionRun.settings_applied,
      status: retentionRun.status
    } : {
      last_run_at: null,
      status: "SCHEDULED_HOURLY"
    }
  });
});

app.get(['/version', '/api/version', '/api/v1/version'], (req, res) => {
  res.status(200).json({
    name: 'aaditech-toolkit-enterprise',
    version: getAgentVersion(),
    uptime_seconds: Math.floor(process.uptime())
  });
});

app.get('/metrics', async (req, res) => {
  try {
    const devices = await db.getDevices();
    const events = await db.getEvents(null, 1000);
    const openAlerts = await db.getAlerts({ status: 'open' });
    const auditLogs = await db.getAuditLogs(1000);
    const retentionRun = db.getLastRetentionRun();

    const metricsText = [
      `# HELP aaditech_active_devices Total registered devices`,
      `# TYPE aaditech_active_devices gauge`,
      `aaditech_active_devices ${devices.length}`,
      `# HELP aaditech_telemetry_batches_total Total telemetry batches processed`,
      `# TYPE aaditech_telemetry_batches_total counter`,
      `aaditech_telemetry_batches_total ${events.length}`,
      `# HELP aaditech_open_alerts Total open security and health alerts`,
      `# TYPE aaditech_open_alerts gauge`,
      `aaditech_open_alerts ${openAlerts.length}`,
      `# HELP aaditech_audit_logs_total Total immutable audit records`,
      `# TYPE aaditech_audit_logs_total counter`,
      `aaditech_audit_logs_total ${auditLogs.length}`,
      `# HELP aaditech_retention_last_run_timestamp_seconds Timestamp of last retention purge run`,
      `# TYPE aaditech_retention_last_run_timestamp_seconds gauge`,
      `aaditech_retention_last_run_timestamp_seconds ${retentionRun ? Math.floor(new Date(retentionRun.timestamp).getTime() / 1000) : 0}`,
      `# HELP aaditech_retention_purged_rows_total Total rows purged by retention jobs`,
      `# TYPE aaditech_retention_purged_rows_total counter`,
      `aaditech_retention_purged_rows_total ${retentionRun?.purged_rows?.total || 0}`
    ].join('\n');
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.send(metricsText);
  } catch (err) {
    res.status(500).send('# ERROR collecting metrics');
  }
});

// ---------------- AUTHENTICATION & AUTHORIZATION ENGINE ----------------

function normalizeRole(role) {
  if (!role) return 'MONITORING';
  const r = String(role).toUpperCase();
  if (r === 'ADMIN' || r === 'SUPER_ADMIN') return 'SUPER_ADMIN';
  if (r === 'OPERATION' || r === 'OPERATOR') return 'OPERATOR';
  if (r === 'MONITORING' || r === 'VIEWER') return 'MONITORING';
  return r;
}

function issueUserToken(user) {
  const normRole = normalizeRole(user.role);
  const payload = {
    id: user.id,
    username: user.username,
    email: user.email || `${user.username}@aaditech.com`,
    role: normRole,
    tenant_id: user.tenant_id || "00000000-0000-0000-0000-000000000001",
    jti: crypto.randomUUID()
  };
  return jwt.sign(payload, EFFECTIVE_JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '8h'
  });
}

function extractToken(req) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  if (req.cookies?.auth_token) {
    return req.cookies.auth_token;
  }
  if (req.cookies?.itk_session && !req.cookies.itk_session.startsWith('sess_')) {
    return req.cookies.itk_session;
  }
  return null;
}

// Resolve the current production workspace from persistent account identity
// and active membership, never only from the signed JWT's tenant/role claims.
async function resolveCurrentUserPrincipal(decoded) {
  // Every deployed runtime re-authorizes JWT role/tenant from persistent
  // account/workspace membership; only explicit test fixtures may use demos.
  const production = requiresPersistedUserAuthorization(process.env.NODE_ENV);
  const stored = production ? await db.getUserById(decoded.id) : null;
  let membership = null;
  if (production && stored &&
      String(decoded.tenant_id || '') !== String(stored.tenant_id || '')) {
    membership = await db.getActiveWorkspaceMembership(stored.id, decoded.tenant_id);
  }
  return resolveVerifiedUserPrincipal(decoded, stored, normalizeRole, production, membership);
}

async function authenticateUserToken(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({
      error: "Unauthorized",
      detail: "Authentication token required. Please sign in."
    });
  }

  const isRevoked = revokedTokens.has(token) || await db.isTokenRevokedInDb(token);
  if (isRevoked) {
    return res.status(401).json({
      error: "Unauthorized",
      detail: "Token has been revoked. Please sign in again."
    });
  }

  try {
    const decoded = jwt.verify(token, EFFECTIVE_JWT_SECRET, { algorithms: ['HS256'] });

    if (decoded.jti && (revokedTokens.has(decoded.jti) || await db.isTokenRevokedInDb(decoded.jti))) {
      return res.status(401).json({
        error: "Unauthorized",
        detail: "Session has been invalidated. Please sign in again."
      });
    }

    const principal = await resolveCurrentUserPrincipal(decoded);
    if (!principal) {
      return res.status(401).json({
        error: "Unauthorized",
        detail: "Account deleted, disabled or session privileges changed. Sign in again."
      });
    }

    req.user = principal;
    req.token = token;
    next();
  } catch (err) {
    return res.status(401).json({
      error: "Unauthorized",
      detail: err.name === 'TokenExpiredError' ? "Token has expired" : "Invalid authentication token signature"
    });
  }
}

function requireRole(allowedRoles) {
  const normalizedAllowed = allowedRoles.map(r => normalizeRole(r));
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized", detail: "Authentication required" });
    }
    const currentRole = normalizeRole(req.user.role);
    if (!normalizedAllowed.includes(currentRole)) {
      return res.status(403).json({
        error: "Forbidden",
        detail: `Access denied. Role '${currentRole}' does not have sufficient permissions. Required roles: ${normalizedAllowed.join(', ')}`
      });
    }
    next();
  };
}

// Platform-global configuration is not a tenant resource. Only the
// explicitly designated persistent operator can change it in production.
// Missing PLATFORM_ADMIN_USER_ID/PLATFORM_OWNER_TENANT_ID deny by default.
function requirePlatformSettingsAdmin(req, res, next) {
  if (!isPlatformSettingsAdmin(req.user)) {
    return res.status(403).json({ error: 'PLATFORM_ADMIN_REQUIRED' });
  }
  return next();
}

// High-performance O(1) in-memory Map for per-device rate limiting and connection tracking
// Prevents CPU bottlenecks and O(N) array scans from high-frequency agent polling (15-30s intervals)
const deviceRateLimitMap = new Map(); // Key: device_id or hostname -> { windowStart, count, lastSeen }

function checkDeviceRateLimit(key, maxRequests = 180, windowMs = 60000) {
  if (!key) return { allowed: true, remaining: maxRequests };
  const now = Date.now();
  let entry = deviceRateLimitMap.get(key);
  if (!entry || now - entry.windowStart > windowMs) {
    entry = { windowStart: now, count: 1, lastSeen: now };
    deviceRateLimitMap.set(key, entry);
    // Auto-prune stale entries if map exceeds 20,000 devices
    if (deviceRateLimitMap.size > 20000) {
      for (const [k, v] of deviceRateLimitMap.entries()) {
        if (now - v.windowStart > windowMs * 2) {
          deviceRateLimitMap.delete(k);
        }
      }
    }
    return { allowed: true, remaining: maxRequests - 1 };
  }

  entry.count++;
  entry.lastSeen = now;
  if (entry.count > maxRequests) {
    return { allowed: false, remaining: 0, retryAfterMs: (entry.windowStart + windowMs) - now };
  }
  return { allowed: true, remaining: maxRequests - entry.count };
}

async function verifyDeviceCredential(req, targetDeviceIdentifier) {
  const authHeader = req.headers['authorization'];
  const bearerToken = typeof authHeader === 'string' && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const rawToken = process.env.NODE_ENV === 'test' ? (
    req.headers['x-device-token'] ||
    req.headers['x-agent-token'] ||
    req.headers['x-bootstrap-token'] ||
    bearerToken ||
    req.body?.device_token ||
    req.body?.agent_token ||
    req.body?.token
  ) : extractEnrolledDeviceHeaderToken(req.headers);

  const signature = req.headers['x-agent-signature'] || req.headers['x-payload-signature'] || req.headers['x-hmac-signature'];
  const deviceUid = req.headers['x-device-uid'] || req.headers['x-agent-id'] || req.body?.device_uid;
  const timestamp = req.headers['x-timestamp'] || req.headers['x-auth-timestamp'];

  if (!rawToken && !(signature && deviceUid && timestamp)) {
    return {
      authenticated: false,
      status: 401,
      error: "Unauthorized",
      detail: "Device authentication required: missing X-Device-Token or HMAC signature headers."
    };
  }

  let matchedDevice = null;
  let issuedDeviceToken = null;
  let isMasterAgentToken = false;

  if (rawToken) {
    // Only explicit test fixtures may use a fleet-wide secret as device auth.
    // Production agents must enroll for per-device credentials first.
    isMasterAgentToken = (process.env.NODE_ENV === 'test') &&
      (rawToken === AGENT_API_TOKEN || rawToken === 'itk_agent_sec_token_998877');
    const tokenHash = hashDeviceToken(rawToken);

    if (isMasterAgentToken) {
      const targetHost = (targetDeviceIdentifier || req.body?.hostname || '').trim();
      if (targetHost) {
        matchedDevice = await db.getDeviceByHostname(targetHost) || await db.getDeviceById(targetHost) || await db.getDeviceByUid(targetHost);
      }
      if (!matchedDevice) {
        const hostName = targetHost || 'AGENT-TEST-01';
        const newDevData = {
          id: crypto.randomUUID(),
          device_uid: `dev-uid-${hostName.toLowerCase().split('.')[0]}`,
          hostname: hostName,
          os_version: req.body?.os_version || "Windows 11 Enterprise",
          agent_version: getAgentVersion(),
          ip_address: req.ip || "127.0.0.1",
          status: "online",
          company_id: 1,
          tenant_id: "00000000-0000-0000-0000-000000000001",
          device_token_hash: tokenHash,
          device_token_prefix: rawToken.slice(0, 12),
          agent_token_revoked: false
        };
        await db.syncDeviceToDb(newDevData);
        matchedDevice = await db.getDeviceByHostname(hostName);
      }
    } else {
      // 1. Check against enrolled devices in MySQL
      matchedDevice = await db.getDeviceByTokenHash(tokenHash);
    }

    // Production never silently consumes bootstrap tokens on telemetry or
    // command endpoints. Enrollment must use the explicit POST route, where
    // tenant and UID collisions are verified before token consumption.
    if (!matchedDevice && process.env.NODE_ENV === 'test') {
      const bVer = await verifyBootstrapToken(rawToken);
      if (bVer.valid) {
        const targetHost = (targetDeviceIdentifier || req.body?.hostname || req.body?.device_uid || "NEW-AGENT").trim();
        await consumeBootstrapToken(rawToken, targetHost, bVer.tenantId);

        const newRawToken = generateDeviceToken();
        const newHash = hashDeviceToken(newRawToken);
        issuedDeviceToken = newRawToken;

        matchedDevice = await db.getDeviceByHostname(targetHost);

        if (!matchedDevice) {
          const newDevData = {
            id: crypto.randomUUID(),
            device_uid: `dev-uid-${targetHost.toLowerCase().split('.')[0]}`,
            hostname: targetHost,
            os_version: req.body?.os_version || "Windows 11 Enterprise",
            agent_version: getAgentVersion(),
            ip_address: req.ip || "127.0.0.1",
            status: "online",
            company_id: 1,
            tenant_id: bVer.tenantId,
            device_token_hash: newHash,
            device_token_prefix: newRawToken.slice(0, 12),
            agent_token_revoked: false
          };
          await db.syncDeviceToDb(newDevData);
          matchedDevice = await db.getDeviceByHostname(targetHost);
        } else {
          await db.updateDevice(matchedDevice.id, {
            device_token_hash: newHash,
            device_token_prefix: newRawToken.slice(0, 12),
            agent_token_revoked: 0,
            status: 'online'
          });
          matchedDevice = await db.getDeviceById(matchedDevice.id);
        }
      } else if (bVer.alreadyUsed || bVer.expired) {
        return {
          authenticated: false,
          status: 401,
          error: "Unauthorized",
          detail: bVer.reason
        };
      }
    }
  } else if (signature && deviceUid && timestamp) {
    // Legacy fleet-wide HMAC headers can impersonate or even auto-provision
    // devices without a tenant-issued enrollment token. Never accept them on
    // real deployments; retain the branch ONLY for historical test fixtures.
    if (process.env.NODE_ENV !== 'test') {
      return {
        authenticated: false,
        status: 403,
        error: 'ENROLLED_DEVICE_TOKEN_REQUIRED',
        detail: 'Legacy fleet-wide HMAC authentication is disabled. Enroll and use X-Device-Token.'
      };
    }
    const timeDiff = Math.abs(Date.now() - parseInt(timestamp, 10));
    if (timeDiff >= 600000) {
      return {
        authenticated: false,
        status: 401,
        error: "Unauthorized",
        detail: "HMAC timestamp drift exceeded 10 minutes window."
      };
    }

    const expectedPrimary = crypto.createHmac('sha256', COMMAND_SIGNING_KEY).update(`${deviceUid}:${timestamp}`).digest('hex');
    const expectedHmac = crypto.createHmac('sha256', HMAC_SECRET).update(`${deviceUid}:${timestamp}`).digest('hex');

    let validSig = false;
    const sigBuf = Buffer.from(signature, 'hex');

    try {
      const exp1 = Buffer.from(expectedPrimary, 'hex');
      if (sigBuf.length === exp1.length && crypto.timingSafeEqual(sigBuf, exp1)) validSig = true;
    } catch {}

    if (!validSig) {
      try {
        const exp2 = Buffer.from(expectedHmac, 'hex');
        if (sigBuf.length === exp2.length && crypto.timingSafeEqual(sigBuf, exp2)) validSig = true;
      } catch {}
    }

    if (!validSig) {
      return {
        authenticated: false,
        status: 401,
        error: "Unauthorized",
        detail: "Invalid HMAC signature."
      };
    }

    const dLower = deviceUid.toLowerCase();
    matchedDevice = await db.getDeviceById(deviceUid) ||
                    await db.getDeviceByUid(deviceUid) ||
                    await db.getDeviceByHostname(dLower) ||
                    await db.getDeviceByHostname(targetDeviceIdentifier || '');

    if (!matchedDevice) {
      const hostName = targetDeviceIdentifier || deviceUid.replace(/^dev-uid-/, '').toUpperCase();
      const newDevData = {
        id: crypto.randomUUID(),
        device_uid: deviceUid,
        hostname: hostName,
        os_version: "Windows 11 Enterprise",
        agent_version: getAgentVersion(),
        ip_address: req.ip || "127.0.0.1",
        status: "online",
        company_id: 1,
        tenant_id: "00000000-0000-0000-0000-000000000001",
        device_token_hash: hashDeviceToken(generateDeviceToken()),
        agent_token_revoked: false
      };
      await db.syncDeviceToDb(newDevData);
      matchedDevice = await db.getDeviceByHostname(hostName);
    }
  }

  if (!matchedDevice) {
    return {
      authenticated: false,
      status: 401,
      error: "Unauthorized",
      detail: "Invalid or unrecognized device credential."
    };
  }

  // Revocation is authoritative for ALL device-agent endpoints, not only
  // command-poll/result paths. MySQL TINYINT may be returned as 0/1.
  if (matchedDevice.agent_token_revoked === true ||
      matchedDevice.agent_token_revoked === 1 ||
      matchedDevice.agent_token_revoked === '1') {
    return {
      authenticated: false,
      status: 401,
      error: 'DEVICE_TOKEN_REVOKED',
      detail: 'Device credential has been revoked; authorized recovery is required. Bootstrap enrollment cannot replace an existing identity.'
    };
  }

  // Cross-device impersonation prevention
  if (targetDeviceIdentifier) {
    const target = String(targetDeviceIdentifier).toLowerCase().trim();
    const exactMatch = matchesEnrolledDeviceIdentifier(matchedDevice, target);
    // Historical synthetic fixtures only; never infer aliases in deployed runtimes.
    const fixtureAlias = process.env.NODE_ENV === 'test' && typeof matchedDevice.hostname === 'string' &&
      (matchedDevice.hostname.toLowerCase().split('.')[0] === target.split('.')[0] ||
       `dev-uid-${matchedDevice.hostname.toLowerCase().split('.')[0]}` === target);
    if (!isMasterAgentToken && !exactMatch && !fixtureAlias) {
      return {
        authenticated: false,
        status: 401,
        error: "Unauthorized",
        detail: 'Device credential does not match the addressed enrolled identity.'
      };
    }
  }

  return {
    authenticated: true,
    device: matchedDevice,
    issuedDeviceToken
  };
}

async function authenticateAgentOrUser(req, res, next) {
  // 1. Check for valid user JWT
  const userToken = extractToken(req);
  if (userToken && !revokedTokens.has(userToken) && !(await db.isTokenRevokedInDb(userToken))) {
    try {
      const decoded = jwt.verify(userToken, EFFECTIVE_JWT_SECRET, { algorithms: ['HS256'] });
      if (!decoded.jti || (!revokedTokens.has(decoded.jti) && !(await db.isTokenRevokedInDb(decoded.jti)))) {
        const principal = await resolveCurrentUserPrincipal(decoded);
        if (principal) {
          req.user = principal;
          req.token = userToken;
          req.authType = 'user';
          return next();
        }
      }
    } catch (e) {
      // Not a valid user JWT, proceed to agent credential check
    }
  }

  // 2. Check Device Credential
  const target = req.query.hostname || req.query.device_id || req.body?.hostname || req.body?.device_id || req.body?.device_uid;
  const ver = await verifyDeviceCredential(req, target);
  if (ver.authenticated) {
    req.agent = { authenticated: true, device: ver.device };
    req.device = ver.device;
    req.authType = 'agent';
    if (ver.issuedDeviceToken) {
      req.issuedDeviceToken = ver.issuedDeviceToken;
    }
    return next();
  }

  return res.status(ver.status || 401).json({
    error: ver.error || "Unauthorized",
    detail: ver.detail || "Device or Agent authentication required."
  });
}

// Never fall back to in-memory tenant/device state while a production
// database is unavailable. Leave /healthz readable for diagnostics.
app.use((req, res, next) => {
  // Never bypass persistent DB authorization for unset/development/staging
  // environments or when a deployed process inherits VITEST=true.
  const realProduction = process.env.NODE_ENV !== 'test';
  if (realProduction && /^\/api(?:\/|$)/.test(req.path) && !isMysqlConnected()) {
    return res.status(503).set('Retry-After', '5').json({
      error: 'DATABASE_UNAVAILABLE',
      detail: 'Production API is unavailable until its persistent database is healthy.'
    });
  }
  next();
});

// Rate limit all API routes
app.use(['/api', '/api/v1'], apiLimiter);

// ---------------- UNIVERSAL API SECURITY GATEWAY ----------------
app.use(async (req, res, next) => {
  const p = req.path;

  // 1. Static and non-API files are completely open
  if (!p.startsWith('/api') && !p.startsWith('/api/v1')) {
    return next();
  }

  // 2. Whitelisted public API endpoints
  if (
    p === '/healthz' ||
    p === '/metrics' ||
    p === '/api/v1/auth/login' ||
    p === '/api/login' ||
    p === '/api/v1/auth/logout' ||
    p === '/api/logout' ||
    p === '/api/setup/status' ||
    p === '/api/v1/setup/status' ||
    p === '/api/agent/enroll' ||
    p === '/api/v1/agent/enroll' ||
    p === '/api/ca.crt' ||
    p === '/api/v1/ca.crt' ||
    p === '/api/agent-msi' ||
    p === '/api/v1/agent-msi' ||
    p === '/api/v1/msi/download/latest' ||
    // Named package downloads require authenticated tenant administrator.
    p === '/api/agent-bundle' ||
    p === '/api/v1/agent/bundle' ||
    p === '/api/agent/bundle.zip' ||
    p === '/api/v1/agent/bundle.zip' ||
    p === '/api/agent/agent.json' ||
    p === '/api/v1/agent/agent.json' ||
    p === '/api/agent/install.cmd' ||
    p === '/api/v1/agent/install.cmd' ||
    p === '/api/agent/install.ps1' ||
    p === '/api/v1/agent/install.ps1'
  ) {
    return next();
  }

  // Initial setup is allowed only before setup is marked complete
  if (p === '/api/setup' || p === '/api/v1/setup') {
    const branding = await db.getBranding();
    if (!branding.setup_complete) {
      return next();
    }
  }

  // 3. Agent/Device telemetry & command polling endpoints
  const isAgentEndpoint = 
    p === '/api/v1/ingest/telemetry' ||
    p === '/api/ingest' ||
    p === '/api/commands/poll' ||
    p === '/api/v1/commands/poll' ||
    (p.startsWith('/api/commands/') && p.endsWith('/result')) ||
    (p.startsWith('/api/v1/commands/') && p.endsWith('/result')) ||
    p === '/api/agent/heartbeat' ||
    p === '/api/v1/agent/heartbeat';

  if (isAgentEndpoint) {
    return authenticateAgentOrUser(req, res, next);
  }

  // 4. All other API endpoints strictly require user authentication
  return authenticateUserToken(req, res, next);
});

// Real Bcrypt Login Handler for both /api/v1/auth/login and /api/login
async function handleLogin(req, res) {
  const { username, email, password } = req.body;
  const target = (username || email || "").trim();

  if (!target || !password) {
    return res.status(401).json({
      error: "Unauthorized",
      detail: "Both username/email and password are required"
    });
  }

  if (REQUIRE_SECURE_SETUP) {
    const branding = await db.getBranding();
    if (!branding.setup_complete) {
      return res.status(403).json({ error: 'SETUP_REQUIRED', detail: 'Complete authorized first-run setup before logging in.' });
    }
  }
  const user = await db.getUserByUsernameOrEmail(target);

  if (!user) {
    logAudit({ username: target }, "USER_LOGIN_FAILED", "AuthService", { reason: "User not found" }, req);
    return res.status(401).json({ error: "Unauthorized", detail: "Invalid credentials" });
  }

  if (user.active === false) {
    logAudit(user, "USER_LOGIN_FAILED", "AuthService", { reason: "Account disabled" }, req);
    return res.status(401).json({ error: "Unauthorized", detail: "Account has been deactivated" });
  }

  // Migration-safe guard: shipped sample bcrypt hashes must never be accepted
  // on a public deployment, even if accounts were seeded before this upgrade.
  if (REQUIRE_SECURE_SETUP && isSeededDemoPasswordHash(user.password_hash)) {
    return res.status(403).json({ error: 'PASSWORD_ROTATION_REQUIRED', detail: 'A shipped demo account must have its password reset by an administrator.' });
  }

  const isMatch = await bcrypt.compare(password, user.password_hash);
  if (!isMatch) {
    logAudit(user, "USER_LOGIN_FAILED", "AuthService", { reason: "Password mismatch" }, req);
    return res.status(401).json({ error: "Unauthorized", detail: "Invalid credentials" });
  }

  // Issue real HS256 signed JWT
  const token = issueUserToken(user);

  res.cookie('auth_token', token, { httpOnly: true, secure: process.env.NODE_ENV !== 'test', sameSite: 'lax', maxAge: 8 * 3600 * 1000 });
  res.cookie('itk_session', token, { httpOnly: true, secure: process.env.NODE_ENV !== 'test', sameSite: 'lax', maxAge: 8 * 3600 * 1000 });

  logAudit(user, "USER_LOGIN_SUCCESS", "AuthService", { result: "SUCCESS" }, req);

  return res.json({
    ok: true,
    token,
    token_type: "Bearer",
    expires_in: 28800,
    username: user.username,
    role: normalizeRole(user.role),
    user: {
      id: user.id,
      username: user.username,
      email: user.email || `${user.username}@aaditech.com`,
      full_name: user.full_name || user.username,
      role: normalizeRole(user.role),
      tenant_id: user.tenant_id || "00000000-0000-0000-0000-000000000001"
    }
  });
}

async function handleLogout(req, res) {
  const token = req.token || extractToken(req);
  if (token) {
    revokedTokens.add(token);
    await db.revokeTokenInDb(token);
  }
  if (req.user?.jti) {
    revokedTokens.add(req.user.jti);
    await db.revokeTokenInDb(req.user.jti);
  }
  res.clearCookie('auth_token');
  res.clearCookie('itk_session');
  res.clearCookie('token');

  if (req.user) {
    logAudit(req.user, "USER_LOGOUT", "AuthService", { result: "SUCCESS" }, req);
  }

  res.json({ ok: true, message: "Logged out successfully" });
}

// Authentication Routes
app.post(['/api/v1/auth/login', '/api/login'], authLimiter, validateBody(loginSchema), handleLogin);

app.post(['/api/v1/auth/logout', '/api/logout'], handleLogout);

app.get(['/api/v1/auth/me', '/api/me'], async (req, res) => {
  const current = req.user;
  res.json({
    id: current.id, username: current.username,
    email: current.email || `${current.username}@aaditech.com`,
    full_name: current.username,
    role: current.role, tenant_id: current.tenant_id
  });
});

// Devices (Canonical v1 + Legacy aliases /api/devices and /api/agents)
app.get(['/api/v1/devices', '/api/devices', '/api/agents'], async (req, res) => {
  // A tenant SUPER_ADMIN is not a platform-wide administrator. A query
  // parameter must not switch workspace without explicit membership.
  const tenantFilter = req.user?.tenant_id;
  if (!tenantFilter || (req.query.tenant_id &&
      String(req.query.tenant_id) !== String(tenantFilter))) {
    return res.status(403).json({ error: 'TENANT_ACCESS_DENIED' });
  }
  const agents = await db.getDevices({
    tenant_id: tenantFilter,
    status: req.query.status,
    os_type: req.query.os_type
  });
  const list = agents.map(a => ({
    id: a.id,
    device_uid: a.device_uid || `dev-uid-${a.hostname.toLowerCase()}`,
    hostname: a.hostname,
    tenant_id: a.tenant_id,
    os_type: (a.os_version || a.os || '').includes('Windows') ? 'WINDOWS' : (a.os_version || a.os || '').includes('macOS') ? 'MACOS' : 'LINUX',
    os: a.os_version || a.os,
    os_version: a.os_version || a.os,
    agent_version: a.agent_version,
    ip: a.ip_address || a.ip,
    ip_address: a.ip_address || a.ip,
    status: a.status === 'online' || a.status === 'ACTIVE' ? 'ACTIVE' : 'OFFLINE',
    cpu_usage: a.cpu_usage,
    memory_usage: a.memory_usage,
    disk_free: a.disk_free,
    battery: a.battery,
    telemetry_status: a.telemetry_status,
    telemetry_reported_at: a.telemetry_reported_at,
    last_seen: String(a.status).toLowerCase() === 'registered' ? null :
      (a.last_seen_at || a.last_seen || null),
    last_seen_at: String(a.status).toLowerCase() === 'registered' ? null :
      (a.last_seen_at || a.last_seen || null)
  }));

  sendPaginated(req, res, list, 50, 500);
});

app.get(['/api/v1/devices/:id', '/api/devices/:id', '/api/agents/:id'], async (req, res) => {
  const dev = await db.getDeviceById(req.params.id) || 
              await db.getDeviceByUid(req.params.id) || 
              await db.getDeviceByHostname(req.params.id);
  if (!dev) return res.status(404).json({ error: "Device not found" });

  if (!belongsToCurrentTenant(req.user, dev)) {
    return res.status(404).json({ error: "Device not found" });
  }

  // Full MySQL rows contain hashed device credentials. Never serialize them
  // into authenticated user responses, even for same-tenant admins.
  res.json({
    ...publicDeviceRecord(dev),
    os_type: (dev.os_version || dev.os || '').includes('Windows') ? 'WINDOWS' : (dev.os_version || dev.os || '').includes('macOS') ? 'MACOS' : 'LINUX',
    status: dev.status === 'online' || dev.status === 'ACTIVE' ? 'ACTIVE' : 'OFFLINE',
    ip: dev.ip_address || dev.ip,
    last_seen: String(dev.status).toLowerCase() === 'registered' ? null :
      (dev.last_seen_at || dev.last_seen || null)
  });
});

app.delete(['/api/v1/devices/:id', '/api/devices/:id', '/api/agents/:id'], requireRole(['SUPER_ADMIN']), async (req, res) => {
  const dev = await db.getDeviceById(req.params.id) || 
              await db.getDeviceByUid(req.params.id) || 
              await db.getDeviceByHostname(req.params.id);
  if (!dev) return res.status(404).json({ error: "Device not found" });

  if (!belongsToCurrentTenant(req.user, dev)) {
    return res.status(404).json({ error: "Device not found" });
  }

  await db.deleteDevice(dev.id);
  logAudit(req.user, "DEVICE_DELETED", `Device:${dev.hostname}`, { device_id: dev.id }, req);
  res.json({ ok: true, deleted: dev.id });
});

// Require a deliberate authenticated bearer request, not an ambient cookie
// or form submission. No route to issue replacement credentials is implied.
app.post('/api/v1/devices/:id/credentials/revoke', requireRole(['SUPER_ADMIN']), async (req, res) => {
  const authorization = req.headers.authorization;
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ') ||
      authorization.slice(7).trim() !== req.token || !req.is('application/json')) {
    return res.status(403).json({ error: 'EXPLICIT_ADMIN_BEARER_REQUIRED' });
  }
  const request = validateDeviceRevocationRequest(req.params.id, req.body);
  if (!request) return res.status(400).json({ error: 'DEVICE_REVOCATION_CONFIRMATION_REQUIRED' });
  try {
    const result = await db.revokeDeviceCredential({
      principal: req.user, ...request, ipAddress: req.ip
    });
    if (result.status === 'not_found') return res.status(404).json({ error: 'DEVICE_NOT_FOUND' });
    return res.json({ device_id: request.deviceId, credential_revoked: true,
      already_revoked: result.status === 'already_revoked',
      cancelled_pending_commands: result.cancelled_pending_commands ?? null });
  } catch (_) {
    return res.status(503).json({ error: 'DEVICE_REVOCATION_UNCONFIRMED' });
  }
});

// Recovery evidence only: explicit admin bearer, fresh persisted tenant
// principal, immutable ID, no caching, no credential issuance.
app.get('/api/v1/devices/:id/credentials/recovery-preflight', requireRole(['SUPER_ADMIN']), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const authorization = req.headers.authorization;
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ') ||
      authorization.slice(7).trim() !== req.token) {
    return res.status(403).json({ error: 'EXPLICIT_ADMIN_BEARER_REQUIRED' });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) {
    return res.status(400).json({ error: 'DEVICE_RECOVERY_ID_REQUIRED' });
  }
  try {
    const result = await db.getDeviceCredentialRecoveryPreflight({ principal: req.user, deviceId: req.params.id });
    if (!result) return res.status(404).json({ error: 'DEVICE_NOT_FOUND' });
    return res.json(result);
  } catch (_) {
    return res.status(503).json({ error: 'DEVICE_RECOVERY_STATE_UNVERIFIED' });
  }
});

app.post('/api/v1/devices', requireRole(['SUPER_ADMIN', 'OPERATOR']), validateBody(deviceRegistrationSchema), async (req, res) => {
  const { hostname, os_type, os_version, agent_version, device_uid } = req.body;
  if (!hostname) return res.status(400).json({ error: "hostname required" });

  const tenantId = String(req.user?.tenant_id || '00000000-0000-0000-0000-000000000001');
  const resolvedUid = String(device_uid || `dev-uid-${hostname.toLowerCase().split('.')[0]}`);
  try {
    return await db.withDeviceIdentityLock(hostname, resolvedUid, async () => {
  const [matchingDevices, companies] = await Promise.all([
    db.getEnrollmentIdentityMatches(hostname, resolvedUid),
    db.getCompanies()
  ]);
  const company = companies.find(c => String(c.tenant_id) === tenantId);
  const preflight = validateEnrollmentIdentity({
    tenantId,
    existingHost: matchingDevices.find(d => String(d.hostname || '').toLowerCase() === hostname.toLowerCase()),
    existingUid: matchingDevices.find(d => String(d.device_uid || '').toLowerCase() === resolvedUid.toLowerCase()),
    company,
    matchingDevices,
    requestedUid: resolvedUid
  });
  if (!preflight.ok) {
    return res.status(preflight.status).json({
      error: preflight.code, detail: 'Device identity is already owned or tenant has no registered company.'
    });
  }
  if (matchingDevices.length > 0) {
    return res.status(409).json({ error: 'DEVICE_ALREADY_REGISTERED' });
  }

  const devToken = generateDeviceToken();
  const tokenHash = hashDeviceToken(devToken);
  const devId = crypto.randomUUID();

  const newDev = {
    id: devId,
    device_uid: resolvedUid,
    hostname,
    os_version: os_version || (os_type === 'WINDOWS' ? 'Windows 11 Enterprise' : 'Linux Ubuntu 22.04'),
    agent_version: agent_version || getAgentVersion(),
    ip_address: req.ip || "10.0.3.15",
    status: "registered",
    // Registration provides identity, never simulated usage or check-in.
    company_id: company.id,
    tenant_id: tenantId,
    device_token_hash: tokenHash,
    device_token_prefix: devToken.slice(0, 12),
    agent_token_revoked: false
  };

  const created = await db.syncDeviceToDb(newDev);
  if (!created) return res.status(503).json({ error: 'DEVICE_REGISTER_FAILED' });
  const createdDev = await db.getDeviceById(devId);
  logAudit(req.user, "DEVICE_REGISTERED", `Device:${hostname}`, { device_uid: newDev.device_uid }, req);

  res.status(201).json({
    ...publicDeviceRecord(createdDev),
    device_token: devToken
  });
    });
  } catch (error) {
    console.error('Device registration identity lock failed:', error.message);
    return res.status(503).json({ error: 'DEVICE_IDENTITY_LOCK_UNAVAILABLE' });
  }
});

// Device Enrollment Endpoint (V1 & Legacy)
const handleAgentEnroll = async (req, res) => {
  const bootstrap_token = req.body?.bootstrap_token;
  const hostname = req.body?.hostname;
  const device_uid = req.body?.device_uid;
  const os_version = req.body?.os_version;
  const agent_version = req.body?.agent_version;

  const rawToken = req.headers['x-bootstrap-token'] || bootstrap_token || (req.headers['authorization'] || '').replace(/^Bearer /, '').trim();
  const host = String(hostname || device_uid || req.headers['x-device-uid'] || '').trim();

  if (!rawToken) {
    return res.status(401).json({
      error: "Unauthorized",
      detail: "Bootstrap token required for device enrollment."
    });
  }

  if (!host) {
    return res.status(400).json({
      error: "Bad Request",
      detail: "Target device hostname or device_uid required for enrollment."
    });
  }

  const ver = await verifyBootstrapToken(rawToken);
  if (!ver.valid) {
    return res.status(401).json({
      error: "Unauthorized",
      detail: ver.reason
    });
  }

  // IMPORTANT: a globally looked-up hostname/UID can belong to another
  // tenant. Check BOTH identifiers and the destination company before
  // consuming a one-use bootstrap token or updating any device credentials.
  const resolvedUid = String(device_uid || `dev-uid-${host.toLowerCase().split('.')[0]}`).trim();
  try {
    return await db.withDeviceIdentityLock(host, resolvedUid, async () => {
  const [matchingDevices, companies] = await Promise.all([
    db.getEnrollmentIdentityMatches(host, resolvedUid),
    db.getCompanies()
  ]);
  const existingHost = matchingDevices.find(d =>
    String(d.hostname || '').toLowerCase() === host.toLowerCase()
  ) || null;
  const existingUid = matchingDevices.find(d =>
    String(d.device_uid || '').toLowerCase() === resolvedUid.toLowerCase()
  ) || null;
  const company = companies.find(c => String(c.tenant_id) === String(ver.tenantId));
  const preflight = validateEnrollmentIdentity({
    tenantId: ver.tenantId, existingHost, existingUid, company, matchingDevices,
    requestedUid: resolvedUid
  });
  if (!preflight.ok) {
    return res.status(preflight.status).json({
      error: preflight.code,
      detail: 'Cannot enroll this device into the requested workspace.'
    });
  }

  // Enrollment is first-use only. Tenant-wide bootstrap is not authorization
  // to replace an existing device credential, even for a matching UID.
  const fresh = validateFreshEnrollment(matchingDevices);
  if (!fresh.ok) return res.status(fresh.status).json({ error: fresh.code });

  // Consume single-use bootstrap token atomically
  const consumed = await consumeBootstrapToken(rawToken, host, ver.tenantId);
  if (!consumed) {
    return res.status(401).json({
      error: "Unauthorized",
      detail: "Bootstrap token has already been consumed."
    });
  }

  // Generate unique per-device token
  const devToken = generateDeviceToken();
  const tokenHash = hashDeviceToken(devToken);

  const devId = crypto.randomUUID();
  {
    const newDev = {
      id: devId,
      device_uid: resolvedUid,
      hostname: host,
      os_version: os_version || "Windows 11 Enterprise",
      agent_version: agent_version || getAgentVersion(),
      ip_address: req.ip || "127.0.0.1",
      status: "online",
      company_id: company.id,
      tenant_id: ver.tenantId,
      device_token_hash: tokenHash,
      device_token_prefix: devToken.slice(0, 12),
      agent_token_revoked: false
    };
    const created = await db.syncDeviceToDb(newDev);
    if (!created) return res.status(503).json({ error: 'DEVICE_ENROLL_FAILED' });
  }
  const dev = await db.getDeviceById(devId);
  if (!dev) return res.status(503).json({ error: 'DEVICE_ENROLL_FAILED' });

  logAudit({ username: `Agent:${host}`, tenant_id: ver.tenantId }, "DEVICE_ENROLLED", `Device:${host}`, {
    device_id: dev.id,
    device_uid: dev.device_uid
  }, req);

  res.status(201).json({
    status: "enrolled",
    device_id: dev.id,
    device_uid: dev.device_uid,
    hostname: dev.hostname,
    device_token: devToken,
    agent_token: devToken,
    tenant_id: ver.tenantId,
    company_id: company.id,
    interval_seconds: 30
  });
    });
  } catch (error) {
    console.error('Device enrollment identity lock failed:', error.message);
    return res.status(503).json({ error: 'DEVICE_IDENTITY_LOCK_UNAVAILABLE' });
  }
};

app.post(['/api/v1/agent/enroll', '/api/agent/enroll'], agentLimiter, handleAgentEnroll);
app.get(['/api/v1/agent/enroll', '/api/agent/enroll'], (req, res) => {
  return res.status(405).set('Allow', 'POST').json({
    error: 'METHOD_NOT_ALLOWED',
    detail: 'Device enrollment accepts POST only. Never place credentials in query strings.'
  });
});

// Agent Heartbeat Endpoint
app.post(['/api/v1/agent/heartbeat', '/api/agent/heartbeat'], agentLimiter, async (req, res) => {
  const host = (req.body?.hostname || req.body?.device_id || req.headers['x-device-uid'] || '').trim();
  const ver = await verifyDeviceCredential(req, host);
  if (!ver.authenticated) {
    return res.status(ver.status || 401).json({ error: ver.error, detail: ver.detail });
  }

  const dev = ver.device;
  if (process.env.NODE_ENV === 'test') {
    await db.updateDevice(dev.id, { status: "online" });
  } else {
    const token = extractEnrolledDeviceHeaderToken(req.headers);
    try {
      await db.recordCredentialBoundHeartbeat(dev.id, {
        tenantId: dev.tenant_id, tokenHash: token ? hashDeviceToken(token) : null
      });
    } catch (err) {
      if (err.message === 'COMMAND_CREDENTIAL_CHANGED') {
        return res.status(401).json({ error: 'HEARTBEAT_CREDENTIAL_CHANGED' });
      }
      return res.status(503).json({ error: 'HEARTBEAT_WRITE_UNCONFIRMED' });
    }
  }

  res.json({
    status: "ok",
    device: dev.hostname,
    last_seen: new Date().toISOString()
  });
});

// Calculate one set of alert/outbox writes BEFORE acquiring the transactional
// batch key. The resulting plans are inserted only if the entire batch wins
// the InnoDB unique (tenant, device, batch_id) claim; retries write nothing.
async function getAtomicTelemetryAlertPlans(dev, measured) {
  const plans = [];
  const rules = scopedAlertRules(dev.tenant_id, await db.getAlertRules());
  let authorizedChannels = null;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const msg = evaluateMeasuredAlert(rule, measured);
    if (!msg) continue;
    const notification = {
      title: rule.name,
      message: dev.hostname + ': ' + msg,
      severity: rule.severity || 'warning',
      details: { hostname: dev.hostname, metric: rule.metric, threshold: rule.threshold }
    };
    if (authorizedChannels === null) {
      const [webhook, email] = await Promise.all([
        db.getTenantWebhookConfig(dev.tenant_id),
        db.getTenantEmailConfig(dev.tenant_id)
      ]);
      authorizedChannels = [];
      const webhookHash = destinationFingerprint(dev.tenant_id, 'webhook', webhook);
      const emailHash = destinationFingerprint(dev.tenant_id, 'email', email);
      if (webhookHash) authorizedChannels.push({ channel: 'webhook', destination_hash: webhookHash });
      if (emailHash) authorizedChannels.push({ channel: 'email', destination_hash: emailHash });
    }
    plans.push({
      tenant_id: dev.tenant_id, device_id: dev.id, hostname: dev.hostname,
      rule: rule.name, severity: rule.severity || 'warning', message: msg,
      notifications: authorizedChannels.map(job => ({ ...job, event: notification }))
    });
  }
  return plans;
}

// Telemetry Ingestion (Canonical v1 + Legacy alias /api/ingest)
app.post(['/api/v1/ingest/telemetry', '/api/ingest'], agentLimiter, validateBody(telemetryIngestSchema), async (req, res) => {
  const agentVer = req.headers['x-agent-version'] || req.body.agent_version || getAgentVersion();
  const deviceUid = req.headers['x-device-uid'] || req.body.device_uid || req.body.device_id || req.body.hostname;
  const { 
    hostname, 
    os_version, 
    arch, 
    ip_address, 
    cpu_model, 
    total_ram_gb, 
    disk_total_gb, 
    disk_free_gb, 
    metrics, 
    processes, 
    posture, 
    app_usage, 
    timestamp, 
    sequence_number 
  } = req.body;

  if (!deviceUid && !hostname) {
    return res.status(400).json({ error: "Missing required header or payload field: X-Device-UID or hostname" });
  }

  const effectiveHost = hostname || deviceUid;
  const ver = await verifyDeviceCredential(req, effectiveHost);
  if (!ver.authenticated) {
    return res.status(ver.status || 401).json({ error: ver.error, detail: ver.detail });
  }

  const dev = ver.device;

  // High-frequency protection: verify per-device rate limit via in-memory Map
  const rateLimitKey = dev.id || dev.hostname || effectiveHost;
  const rateLimitCheck = checkDeviceRateLimit(rateLimitKey);
  if (!rateLimitCheck.allowed) {
    return res.status(429).json({ error: "Too Many Requests", detail: "Per-device telemetry rate limit exceeded." });
  }

  const devUpdates = {
    status: "online"
  };
  if (os_version) devUpdates.os_version = os_version;
  if (ip_address) devUpdates.ip_address = ip_address;
  // A single authenticated metric snapshot must never refresh old fictional
  // default values or reuse another device's legacy history. Each missing
  // field is NULL rather than a guessed zero or previous measurement.
  const measured = extractMeasurements(metrics, disk_free_gb);
  const hasMeasurement = [measured.cpu, measured.ram, measured.disk, measured.latency]
    .some(value => value !== null);
  if (hasMeasurement) {
    devUpdates.cpu_usage = measured.cpu === null ? null : measured.cpu.toFixed(1) + '%';
    devUpdates.memory_usage = measured.ram === null ? null : measured.ram.toFixed(1) + '%';
    devUpdates.disk_free = measured.disk === null ? null : measured.disk + ' GB';
    devUpdates.disk_free_gb = measured.disk;
    // Server-created evidence clock, independent of agent-supplied timestamp.
    devUpdates.telemetry_reported_at = new Date();
  }

  if (posture && typeof posture === 'object' && !Array.isArray(posture)) {
    // Every posture report is a new, single snapshot from the device
    // authenticated above. Omitted fields clear historical synthetic defaults:
    // a partial report cannot accidentally "refresh" previously seeded health.
    const measured = req.validatedBody.posture;
    const approved = (value, values) =>
      typeof value === 'string' && values.includes(value.trim().toUpperCase())
        ? value.trim().toUpperCase() : null;
    devUpdates.bitlocker_status = approved(measured.bitlocker_status,
      ['PROTECTED', 'ENCRYPTED', 'UNPROTECTED', 'SUSPENDED']);
    devUpdates.antivirus_status = approved(measured.antivirus_status,
      ['ACTIVE', 'INACTIVE', 'DISABLED']);
    devUpdates.firewall_status = approved(measured.firewall_status,
      ['ENABLED', 'DISABLED']);
    devUpdates.antivirus_name = typeof measured.antivirus_name === 'string' &&
      measured.antivirus_name.trim() ? measured.antivirus_name.trim() : null;
    const allMeasured = devUpdates.bitlocker_status !== null &&
      devUpdates.antivirus_status !== null && devUpdates.firewall_status !== null;
    devUpdates.security_score = allMeasured && Number.isInteger(measured.security_score)
      ? measured.security_score : null;
    // This timestamp is server-owned, never taken from a spoofable device
    // payload or from an enrollment registration/heartbeat timestamp.
    devUpdates.posture_reported_at = new Date();
  }

  // N29 canonical requests: the receipt, device update, measured history,
  // event rows, alerts and notification jobs MUST share a single SQL commit.
  // A lost HTTPS ACK results in a read-only duplicate response, not fresh
  // measured evidence or repeated alert fan-out. Legacy agents without a
  // batch_id continue down the original compatibility route below.
  if (req.body.batch_id) {
    try {
      const plans = hasMeasurement ? await getAtomicTelemetryAlertPlans(dev, measured) : [];
      const receipt = await db.ingestTelemetryBatchOnce({
        tenant_id: dev.tenant_id,
        device_id: dev.id,
        hostname: dev.hostname,
        batch_id: req.body.batch_id,
        request_hash: crypto.createHash('sha256')
          .update(JSON.stringify(req.body)).digest('hex'),
        device_updates: devUpdates,
        metrics: hasMeasurement ? measured : null,
        processes: Array.isArray(processes) ? processes : [],
        events: Array.isArray(req.body.events) ? req.body.events : [],
        alerts: plans
      }, process.env.NODE_ENV === 'test' ? undefined : {
        tenantId: dev.tenant_id,
        tokenHash: (() => {
          const token = extractEnrolledDeviceHeaderToken(req.headers);
          return token ? hashDeviceToken(token) : null;
        })()
      });
      if (!receipt.duplicate && Array.isArray(app_usage) && app_usage.length) {
        // Redis is an optional cache, never the durable receipt authority.
        await db.cacheSet('app_usage:' + dev.id, app_usage, 900);
      }
      return res.status(200).json({
        status: 'OK', batch_id: receipt.batch_id, accepted: receipt.accepted,
        recorded_at: new Date(receipt.recorded_at).toISOString(),
        sequence_number: sequence_number || 1, hostname: dev.hostname,
        duplicate: receipt.duplicate
      });
    } catch (err) {
      if (['TELEMETRY_BATCH_ID_CONFLICT', 'EVENT_IDEMPOTENCY_CONFLICT'].includes(err.message)) {
        return res.status(409).json({ error: err.message,
          detail: 'An authenticated device already submitted a different payload under the same message/batch ID.' });
      }
      if (err.message === 'TELEMETRY_CREDENTIAL_CHANGED') {
        return res.status(401).json({ error: 'TELEMETRY_CREDENTIAL_CHANGED' });
      }
      if (err.message === 'TELEMETRY_BATCH_MYSQL_REQUIRED') {
        return res.status(503).json({ error: 'DATABASE_UNAVAILABLE',
          detail: 'Durable telemetry receipt requires a healthy persistent MySQL database.' });
      }
      throw err;
    }
  }

  await db.updateDevice(dev.id, devUpdates);

  // Sync real live processes into MySQL table device_processes
  if (processes && Array.isArray(processes) && processes.length > 0) {
    await db.syncDeviceProcesses(dev.id, processes);
  }

  // Cache real live application usage into Redis
  if (app_usage && Array.isArray(app_usage) && app_usage.length > 0) {
    await db.cacheSet(`app_usage:${dev.id}`, app_usage, 900);
    // Never write a hostname-only cache key: hostnames can repeat across tenants.
  }

  // Insert Telemetry record into MySQL
  if (hasMeasurement) {
    await db.insertTelemetryRecord(dev.id, {
      cpu_pct: measured.cpu, ram_pct: measured.ram,
      disk_free_gb: measured.disk, net_latency_ms: measured.latency
    });
  }

  // Deduplication applies to authenticated tenant/device *event rows*.
  // Exact replay counts as accepted; changed content with same ID is 409.
  if (Array.isArray(req.body.events)) {
    for (const ev of req.body.events) {
      try {
        await db.addEvent({
          tenant_id: dev.tenant_id,
          device_id: dev.id,
          hostname: dev.hostname,
          kind: ev.kind || "telemetry",
          sanitized: true,
          payload: ev.payload || {},
          client_msg_id: ev.client_msg_id
        });
      } catch (err) {
        if (err.message === 'EVENT_IDEMPOTENCY_CONFLICT') {
          return res.status(409).json({
            error: 'EVENT_IDEMPOTENCY_CONFLICT',
            detail: 'This authenticated device already submitted different event content with the same client_msg_id.'
          });
        }
        throw err;
      }
    }
  }

  const recordedAt = timestamp || new Date().toISOString();
  const seqNum = sequence_number || 1;

  // Only fresh finite device measurements may trigger alerts; null <= 15 is true in JS.
  if (hasMeasurement) {
    const alertRules = scopedAlertRules(dev.tenant_id, await db.getAlertRules());
    let authorizedChannels = null;
    for (const rule of alertRules) {
      if (!rule.enabled) continue;
      const msg = evaluateMeasuredAlert(rule, measured);
      if (msg) {
        const alt = {
          tenant_id: dev.tenant_id,
          device_id: dev.id,
          hostname: dev.hostname,
          severity: rule.severity || "warning",
          message: msg,
          status: "open",
          rule: rule.name
        };
        const notification = {
          title: rule.name,
          message: dev.hostname + ': ' + msg,
          severity: rule.severity || 'warning',
          details: { hostname: dev.hostname, metric: rule.metric, threshold: rule.threshold }
        };
        if (authorizedChannels === null) {
          const [webhook, email] = await Promise.all([
            db.getTenantWebhookConfig(dev.tenant_id),
            db.getTenantEmailConfig(dev.tenant_id)
          ]);
          authorizedChannels = [];
          const webhookHash = destinationFingerprint(dev.tenant_id, 'webhook', webhook);
          const emailHash = destinationFingerprint(dev.tenant_id, 'email', email);
          if (webhookHash) authorizedChannels.push({ channel: 'webhook', destination_hash: webhookHash });
          if (emailHash) authorizedChannels.push({ channel: 'email', destination_hash: emailHash });
        }
        // On production MySQL, the alert and enabled channel jobs share one
        // transaction. Disabled channels leave no backlog of historical data.
        await db.createAlert(alt, authorizedChannels.map(job => ({
          ...job, event: notification
        })));
      }
    }
  }

  const acceptedCount = Array.isArray(req.body.events) ? req.body.events.length : 1;
  res.status(200).json({ 
    status: "OK", 
    accepted: acceptedCount,
    recorded_at: recordedAt, 
    sequence_number: seqNum,
    hostname: dev.hostname 
  });
});

// Secure MSI Package Generator Subsystem V1
app.post('/api/v1/msi/generate', requireRole(['SUPER_ADMIN']), validateBody(msiGenerateSchema), async (req, res) => {
  const { package_name, version, group_id, bootstrap_expiry_hours } = req.body;
  const pkgVer = version || getAgentVersion();
  const pkgName = package_name || "Aaditech-Agent-Installer";
  const expiryHours = bootstrap_expiry_hours || req.body.expires_in_hours || 24;

  // Creating an MSI request issues a sensitive single-use enrollment token.
  // A platform-only/unscoped principal must never silently fall back to the
  // default tenant. Package list and download already require tenant scope.
  if (!req.user?.tenant_id) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  const tenantId = req.user.tenant_id;
  const bootstrapToken = generateBootstrapToken(tenantId, group_id || "default", expiryHours);
  const tokenHash = crypto.createHash('sha256').update(bootstrapToken).digest('hex');
  const pkgId = crypto.randomUUID();

  // Check if a real pre-built MSI artifact exists for this version
  const msiResolved = resolveAgentMsi(pkgVer);
  let targetFilePath = null;
  let fileHash = null;
  let packageStatus = 'PENDING';
  let msiSize = 0;

  if (msiResolved.found) {
    const targetDir = path.join(__dirname, 'artifacts', 'msi', pkgId);
    fs.mkdirSync(targetDir, { recursive: true });
    targetFilePath = path.join(targetDir, `${pkgName}-${pkgVer}.msi`);
    fs.copyFileSync(msiResolved.path, targetFilePath);

    const fileBytes = fs.readFileSync(targetFilePath);
    fileHash = crypto.createHash('sha256').update(fileBytes).digest('hex');
    msiSize = fileBytes.length;
    packageStatus = 'READY';
  } else {
    // A tenant portal request MUST NOT trigger a workflow_dispatch build.
    // Signing approval belongs exclusively to the protected GitHub release
    // workflow and never to application credentials or database branding.
    targetFilePath = path.join(__dirname, 'artifacts', 'msi', pkgId, `${pkgName}-${pkgVer}.msi`);
    fileHash = null;
    packageStatus = 'PENDING';
  }

  const pkgRecord = {
    id: pkgId,
    tenant_id: tenantId,
    package_name: pkgName,
    version: pkgVer,
    status: packageStatus,
    bootstrap_token: bootstrapToken,
    bootstrap_token_hash: tokenHash,
    token_expires_at: new Date(Date.now() + expiryHours * 3600 * 1000).toISOString(),
    created_by: req.user.id,
    file_path: targetFilePath,
    download_url: `/api/v1/msi/download/${pkgId}`,
    file_hash_sha256: fileHash,
    file_size_bytes: msiSize,
    downloads_count: 0
  };

  await db.createMsiPackage(pkgRecord);

  // The portal creates a package request and may only copy a generic prebuilt
  // artifact. No new tenant-custom MSI is built/signed by this endpoint.
  logAudit(req.user, "MSI_PACKAGE_REQUEST_CREATED", `MSIPackage:${pkgName}`, {
    package_id: pkgId,
    version: pkgVer,
    status: packageStatus,
    file_hash_sha256: fileHash,
    bootstrap_expiry_hours: expiryHours
  }, req);

  // Return bootstrap credential ONLY at creation to the authorized tenant
  // super-admin. Never include filesystem paths or token hashes in API JSON.
  res.status(201).json({
    id: pkgRecord.id, tenant_id: pkgRecord.tenant_id,
    package_name: pkgRecord.package_name, version: pkgRecord.version,
    status: pkgRecord.status, bootstrap_token: bootstrapToken,
    token_expires_at: pkgRecord.token_expires_at,
    download_url: pkgRecord.download_url,
    file_hash_sha256: pkgRecord.file_hash_sha256,
    file_size_bytes: pkgRecord.file_size_bytes
  });
});

app.get('/api/v1/msi/packages', requireRole(['SUPER_ADMIN']), async (req, res) => {
  if (!req.user?.tenant_id) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  const pkgs = await db.getMsiPackages(req.user.tenant_id);
  sendPaginated(req, res, pkgs, 50, 500);
});

// Specific literal route registered BEFORE /api/v1/msi/download/:id to prevent Express route shadowing
const handleLatestMsiDownload = (req, res) => {
  const version = getAgentVersion();
  const msiInfo = resolveAgentMsi(version);

  if (!msiInfo.found) {
    return res.status(404).json({
      error: `MSI artifact ${msiInfo.filename} not found or not built yet.`,
      msi_available: false,
      version
    });
  }

  res.setHeader('Content-Type', 'application/x-msi');
  res.setHeader('Content-Length', msiInfo.size);
  res.setHeader('Content-Disposition', `attachment; filename="${msiInfo.filename}"`);
  const stream = fs.createReadStream(msiInfo.path);
  stream.pipe(res);
};

app.get(['/api/v1/msi/download/latest', '/api/v1/agent-msi', '/api/agent-msi'], handleLatestMsiDownload);

app.get('/api/v1/msi/download/:id', requireRole(['SUPER_ADMIN']), async (req, res) => {
  if (!req.user?.tenant_id) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  const pkg = await db.getMsiPackageById(req.params.id, req.user.tenant_id);
  if (!pkg) return res.status(404).json({ error: "MSI Package not found or expired" });

  let realFilePath = pkg.file_path;
  if (!realFilePath || !fs.existsSync(realFilePath)) {
    const resolved = resolveAgentMsi(pkg.version);
    if (resolved.found) {
      realFilePath = resolved.path;
    }
  }

  if (!realFilePath || !fs.existsSync(realFilePath)) {
    return res.status(404).json({
      error: "MSI artifact not found. The package build is PENDING or has not been uploaded.",
      package_id: pkg.id,
      version: pkg.version,
      status: pkg.status || 'PENDING'
    });
  }

  if (!matchesApprovedReleaseHash(realFilePath)) {
    return res.status(503).json({ error: 'MSI_RELEASE_NOT_APPROVED', detail: 'A verified installer has not been approved for production distribution.' });
  }
  const stat = fs.statSync(realFilePath);
  const msiFilename = `${pkg.package_name || 'IT-Toolkit-Agent'}-${pkg.version || getAgentVersion()}.msi`;

  await db.incrementMsiDownloads(pkg.id);

  res.setHeader('Content-Type', 'application/x-msi');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Content-Disposition', `attachment; filename="${msiFilename}"`);
  const stream = fs.createReadStream(realFilePath);
  stream.pipe(res);
});

// Immutable Audit Logs V1
app.get('/api/v1/audit/logs', async (req, res) => {
  const { limit, offset } = parsePagination(req, 50, 500);
  const tenantId = req.user?.tenant_id;
  // Even the default workspace SUPER_ADMIN cannot enumerate foreign audit logs.
  // Cross-workspace access requires approved membership + explicit workspace switch.
  if (!tenantId || (req.query.tenant_id && String(req.query.tenant_id) !== String(tenantId))) {
    return res.status(403).json({ error: 'TENANT_ACCESS_DENIED' });
  }
  const logs = await db.getAuditLogs(limit + offset, tenantId);
  return sendPaginated(req, res, logs, 50, 500);
});

// Workspace selection: a tenant ID in a query/body is NOT an authorization.
const listAuthorizedWorkspaces = async (req, res) => {
  const workspaces = await db.listUserWorkspaces(req.user?.id);
  if (!workspaces.length) return res.status(403).json({ error: 'NO_ACTIVE_WORKSPACE' });
  return sendPaginated(req, res, workspaces, 50, 500);
};

// Legacy /tenants must never enumerate every customer workspace.
app.get(['/api/v1/tenants', '/api/v1/workspaces'], listAuthorizedWorkspaces);

app.post('/api/v1/workspaces/select', validateBody(workspaceSelectSchema), async (req, res) => {
  const owner = await db.getUserById(req.user?.id);
  if (!owner || owner.active === false || String(owner.status || 'ACTIVE').toUpperCase() !== 'ACTIVE') {
    return res.status(401).json({ error: 'ACCOUNT_INACTIVE' });
  }
  const choices = await db.listUserWorkspaces(owner.id);
  const selected = choices.find(w => String(w.tenant_id) === String(req.body.tenant_id));
  if (!selected) return res.status(403).json({ error: 'WORKSPACE_MEMBERSHIP_REQUIRED' });
  // Issue a fresh JWT only AFTER checking ACTIVE tenant membership and role.
  // The old JWT remains bound to its prior tenant; it never grants privileges
  // in the new workspace by adding a query or header.
  const token = issueUserToken({ ...owner, tenant_id: selected.tenant_id, role: selected.role });
  res.cookie('auth_token', token, { httpOnly: true, secure: process.env.NODE_ENV !== 'test',
    sameSite: 'lax', maxAge: 8 * 3600 * 1000 });
  res.cookie('itk_session', token, { httpOnly: true, secure: process.env.NODE_ENV !== 'test',
    sameSite: 'lax', maxAge: 8 * 3600 * 1000 });
  logAudit(req.user, 'WORKSPACE_SELECTED', `Tenant:${selected.tenant_id}`,
    { tenant_id: selected.tenant_id }, req);
  return res.json({ ok: true, token, token_type: 'Bearer', expires_in: 28800,
    workspace: selected, tenant_id: selected.tenant_id, role: selected.role });
});

// A super-admin can grant membership ONLY in the workspace currently
// authenticated. No request field can select the destination tenant.
app.post('/api/v1/workspaces/memberships', requireRole(['SUPER_ADMIN']),
  validateBody(workspaceGrantSchema), async (req, res) => {
    if (!req.user?.tenant_id) return res.status(403).json({ error: 'TENANT_REQUIRED' });
    const target = await db.getUserById(req.body.user_id);
    if (!target || target.active === false ||
        String(target.status || 'ACTIVE').toUpperCase() !== 'ACTIVE') {
      return res.status(404).json({ error: 'ACCOUNT_NOT_FOUND' });
    }
    if (String(target.tenant_id) === String(req.user.tenant_id)) {
      return res.status(409).json({ error: 'PRIMARY_WORKSPACE_ROLE_MANAGED_BY_USER_PROFILE' });
    }
    // Invitations do NOT grant privileges until the invited account
    // explicitly accepts from its own authenticated session.
    const invite = await db.grantWorkspaceMembership(
      target.id, req.user.tenant_id, req.body.role, req.user.id
    );
    if (!invite || invite.status !== 'INVITED') {
      return res.status(409).json({ error: 'WORKSPACE_ALREADY_ACTIVE' });
    }
    logAudit(req.user, 'WORKSPACE_INVITATION_CREATED', `User:${target.id}`,
      { user_id: target.id, tenant_id: req.user.tenant_id, role: req.body.role }, req);
    return res.status(201).json({ ok: true, status: 'INVITED',
      user_id: target.id, tenant_id: req.user.tenant_id, role: req.body.role,
      expires_at: invite.expires_at });
  });

app.delete('/api/v1/workspaces/memberships/:userId', requireRole(['SUPER_ADMIN']),
  async (req, res) => {
    if (!req.user?.tenant_id) return res.status(403).json({ error: 'TENANT_REQUIRED' });
    const target = await db.getUserById(req.params.userId);
    if (!target) return res.status(404).json({ error: 'ACCOUNT_NOT_FOUND' });
    if (String(target.tenant_id) === String(req.user.tenant_id) ||
        String(target.id) === String(req.user.id)) {
      return res.status(409).json({ error: 'PRIMARY_OR_SELF_MEMBERSHIP_CANNOT_BE_REVOKED_HERE' });
    }
    const existing = await db.getWorkspaceMembership(target.id, req.user.tenant_id);
    if (!existing || !['ACTIVE', 'INVITED'].includes(String(existing.status))) {
      return res.status(404).json({ error: 'MEMBERSHIP_NOT_FOUND' });
    }
    const revoked = await db.revokeWorkspaceMembership(target.id, req.user.tenant_id);
    if (!revoked) return res.status(409).json({ error: 'MEMBERSHIP_ALREADY_CHANGED' });
    logAudit(req.user, 'WORKSPACE_MEMBERSHIP_REVOKED', `User:${target.id}`,
      { user_id: target.id, tenant_id: req.user.tenant_id }, req);
    return res.json({ ok: true, user_id: target.id, tenant_id: req.user.tenant_id });
  });

// Only the invited account can see and accept/decline its own invitation.
// No bearer invite token or emailed secret is required: account login and
// current MySQL invitation status provide the proof of identity and consent.
app.get('/api/v1/workspaces/invitations', async (req, res) => {
  const invitations = await db.listWorkspaceInvitations(req.user?.id);
  return res.json(invitations);
});

app.post('/api/v1/workspaces/invitations/:tenantId/:decision', async (req, res) => {
  const { tenantId, decision } = req.params;
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(tenantId) ||
      !['accept', 'decline'].includes(decision)) {
    return res.status(400).json({ error: 'INVALID_INVITATION_RESPONSE' });
  }
  const applied = await db.respondWorkspaceInvitation(req.user?.id, tenantId, decision);
  if (!applied) return res.status(409).json({
    error: 'INVITATION_EXPIRED_OR_NOT_PENDING',
    detail: 'Invitation was revoked, already answered, inactive or older than 7 days.'
  });
  logAudit(req.user, decision === 'accept' ? 'WORKSPACE_INVITATION_ACCEPTED' :
    'WORKSPACE_INVITATION_DECLINED', `Tenant:${tenantId}`,
    { tenant_id: tenantId }, req);
  return res.json({ ok: true, status: decision === 'accept' ? 'ACTIVE' : 'DECLINED',
    tenant_id: tenantId });
});

// Safe workspace presentation settings: only the selected tenant is affected.
app.get('/api/v1/workspaces/branding', async (req, res) => {
  if (!req.user?.tenant_id) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  return res.json(await db.getTenantBranding(req.user.tenant_id));
});

app.put('/api/v1/workspaces/branding', requireRole(['SUPER_ADMIN']),
  validateBody(tenantBrandingSchema), async (req, res) => {
    if (!req.user?.tenant_id) return res.status(403).json({ error: 'TENANT_REQUIRED' });
    const branding = await db.updateTenantBranding(req.user.tenant_id, req.body);
    logAudit(req.user, 'TENANT_BRANDING_UPDATED', `Tenant:${req.user.tenant_id}`,
      { changed_fields: Object.keys(req.body) }, req);
    return res.json(branding);
  });

// ---------------- PHASE 2: OPERATIONAL MANAGEMENT API ROUTES ----------------

// Alert Rules Engine V1
// Alerts & Alert Rules Engine (Canonical v1 + Legacy aliases)
app.get(['/api/v1/alerts/open', '/api/alerts/open'], async (req, res) => {
  const tenantId = req.user?.tenant_id;
  if (!tenantId || (req.query.tenant_id && String(req.query.tenant_id) !== String(tenantId))) {
    return res.status(403).json({ error: 'TENANT_ACCESS_DENIED' });
  }
  const alerts = await db.getAlerts({ status: 'open', tenant_id: tenantId });
  res.json({ open: alerts.length });
});

app.get(['/api/v1/alerts', '/api/alerts'], async (req, res) => {
  const filters = {};
  if (req.query.status) filters.status = req.query.status;
  const tenantId = req.user?.tenant_id;
  if (!tenantId || (req.query.tenant_id && String(req.query.tenant_id) !== String(tenantId))) {
    return res.status(403).json({ error: 'TENANT_ACCESS_DENIED' });
  }
  filters.tenant_id = tenantId;
  const list = await db.getAlerts(filters);
  sendPaginated(req, res, list, 50, 500);
});

app.get(['/api/v1/alerts/notifications/status', '/api/alerts/notifications/status'],
  requireRole(['SUPER_ADMIN']), async (req, res) => {
    if (!req.user?.tenant_id) return res.status(403).json({ error: 'TENANT_REQUIRED' });
    const summary = await db.getTenantOutboxStatus(req.user.tenant_id);
    return res.json({ status: summary });
  });

app.get(['/api/v1/alerts/rules', '/api/alert-rules'], async (req, res) => {
  if (!req.user?.tenant_id) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  const rules = (await db.getAlertRules()).filter(rule =>
    String(rule.tenant_id) === String(req.user.tenant_id));
  sendPaginated(req, res, rules, 50, 500);
});

app.post('/api/v1/alerts/rules', requireRole(['SUPER_ADMIN']), validateBody(createAlertRuleSchema), async (req, res) => {
  const { name, metric, threshold, duration_mins, severity } = req.body;
  if (!name || !metric || threshold === undefined) {
    return res.status(400).json({ error: "Missing required fields: name, metric, threshold" });
  }

  const newRule = {
    name,
    metric,
    threshold: parseFloat(threshold),
    duration_mins: parseInt(duration_mins, 10) || 5,
    severity: severity || "warning",
    enabled: true,
    tenant_id: req.user.tenant_id
  };

  if (!req.user?.tenant_id) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  const created = await db.createAlertRule(newRule);
  logAudit(req.user, "ALERT_RULE_CREATED", `AlertRule:${name}`, { rule_id: created.id, metric, threshold }, req);

  res.status(201).json(created);
});

app.put(['/api/v1/alerts/rules/:id', '/api/alert-rules/:name'], requireRole(['SUPER_ADMIN']), validateBody(updateAlertRuleSchema), async (req, res) => {
  const idOrName = req.params.id || req.params.name;
  let rule = await db.getAlertRuleById(idOrName);
  if (!rule) rule = await db.getAlertRuleByName(idOrName);
  if (rule && String(rule.tenant_id) !== String(req.user?.tenant_id)) {
    return res.status(404).json({ error: 'ALERT_RULE_NOT_FOUND' });
  }
  if (rule) {
    await db.updateAlertRule(rule.id, req.body);
    logAudit(req.user, "ALERT_RULE_UPDATED", `AlertRule:${rule.name}`, req.body, req);
  }
  res.json({ ok: true, rule: rule || null });
});

app.delete('/api/v1/alerts/rules/:id', requireRole(['SUPER_ADMIN']), async (req, res) => {
  const ruleId = req.params.id;
  const rule = await db.getAlertRuleById(ruleId);
  if (!rule || String(rule.tenant_id) !== String(req.user?.tenant_id)) {
    return res.status(404).json({ error: 'ALERT_RULE_NOT_FOUND' });
  }
  await db.deleteAlertRule(ruleId);
  logAudit(req.user, "ALERT_RULE_DELETED", `AlertRule:${ruleId}`, {}, req);
  res.status(200).json({ success: true, message: "Alert rule removed" });
});

app.post(['/api/v1/alerts/:id/acknowledge', '/api/alerts/:id/ack', '/api/alerts/:id/acknowledge'], requireRole(['SUPER_ADMIN', 'OPERATOR']), async (req, res) => {
  const alertId = parseInt(req.params.id, 10);
  const alt = await db.getAlertById(alertId);
  if (!alt || String(alt.tenant_id) !== String(req.user?.tenant_id)) {
    return res.status(404).json({ error: "Alert not found" });
  }

  await db.updateAlert(alertId, { status: "acknowledged" });
  alt.status = "acknowledged";
  logAudit(req.user, "ALERT_ACKNOWLEDGED", `Alert:${alertId}`, { alert_title: alt.rule_name || alt.message }, req);
  res.json({ ok: true, alert: alt });
});

app.post(['/api/v1/alerts/:id/resolve', '/api/alerts/:id/resolve'], requireRole(['SUPER_ADMIN', 'OPERATOR']), async (req, res) => {
  const alertId = parseInt(req.params.id, 10);
  const alt = await db.getAlertById(alertId);
  if (!alt || String(alt.tenant_id) !== String(req.user?.tenant_id)) {
    return res.status(404).json({ error: "Alert not found" });
  }

  await db.resolveAlert(alertId);
  alt.status = "resolved";
  alt.resolved_at = new Date().toISOString();
  logAudit(req.user, "ALERT_RESOLVED", `Alert:${alertId}`, { alert_title: alt.rule_name || alt.message }, req);
  res.json({ ok: true, alert: alt });
});

// Per-workspace webhook settings are owned by that workspace SUPER_ADMIN.
// Global legacy webhook settings are intentionally NOT inherited or dispatched.
app.get(['/api/v1/alerts/webhook', '/api/alerts/webhook'], requireRole(['SUPER_ADMIN']), async (req, res) => {
  if (!req.user?.tenant_id) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  const config = await db.getTenantWebhookConfig(req.user.tenant_id);
  return res.json(config);
});

app.put(['/api/v1/alerts/webhook', '/api/alerts/webhook'], requireRole(['SUPER_ADMIN']),
  validateBody(webhookConfigSchema), async (req, res) => {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ error: 'TENANT_REQUIRED' });
    const current = await db.getTenantWebhookConfig(tenantId);
    const next = { ...current, ...req.body };
    if (next.enabled && !next.url) {
      return res.status(400).json({ error: 'WEBHOOK_URL_REQUIRED' });
    }
    if (next.url && !isApprovedWebhookUrl(next.url)) {
      return res.status(400).json({ error: 'WEBHOOK_URL_NOT_APPROVED',
        detail: 'Use an HTTPS destination explicitly listed in WEBHOOK_ALLOWED_HOSTS.' });
    }
    const config = await db.updateTenantWebhookConfig(tenantId, req.body);
    logAudit(req.user, 'TENANT_WEBHOOK_CONFIG_UPDATED', 'Tenant:' + tenantId,
      { changed_fields: Object.keys(req.body) }, req);
    return res.json({ ok: true, enabled: config.enabled, url: config.url, type: config.type });
  });

app.post(['/api/v1/alerts/test-webhook', '/api/alerts/test-webhook'],
  requireRole(['SUPER_ADMIN']), async (req, res) => {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ error: 'TENANT_REQUIRED' });
    const config = await db.getTenantWebhookConfig(tenantId);
    if (!config.enabled || !config.url) {
      return res.status(400).json({ ok: false, error: 'NOT_CONFIGURED' });
    }
    if (!isApprovedWebhookUrl(config.url)) {
      return res.status(400).json({ ok: false, error: 'WEBHOOK_URL_NOT_APPROVED' });
    }
    try {
      const delivery = await deliverTenantWebhook(tenantId, config, {
        title: 'Webhook delivery test', message: 'Test from the current workspace',
        severity: 'info', details: { test: true }
      });
      if (!delivery.dispatched) {
        return res.status(502).json({ ok: false, error: 'DELIVERY_FAILED' });
      }
      return res.json({ ok: true, status_code: delivery.status_code, type: config.type });
    } catch {
      return res.status(502).json({ ok: false, error: 'DELIVERY_FAILED' });
    }
  });

// Workspace admins control recipient consent; the platform operator owns SMTP
// credentials and exact approved recipient domains via server environment.
app.get(['/api/v1/alerts/email', '/api/alerts/email'], requireRole(['SUPER_ADMIN']), async (req, res) => {
  if (!req.user?.tenant_id) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  const config = await db.getTenantEmailConfig(req.user.tenant_id);
  return res.json({ enabled: config.enabled, recipient: config.recipient,
    smtp_configured: Boolean(smtpTransportConfig()) });
});

app.put(['/api/v1/alerts/email', '/api/alerts/email'], requireRole(['SUPER_ADMIN']),
  validateBody(tenantEmailConfigSchema), async (req, res) => {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ error: 'TENANT_REQUIRED' });
    const current = await db.getTenantEmailConfig(tenantId);
    const next = { ...current, ...req.body };
    if (next.enabled) {
      const transport = smtpTransportConfig();
      if (!transport) return res.status(503).json({ error: 'SMTP_NOT_CONFIGURED' });
      if (!isApprovedEmailRecipient(next.recipient, transport)) {
        return res.status(400).json({ error: 'RECIPIENT_NOT_APPROVED' });
      }
    }
    const config = await db.updateTenantEmailConfig(tenantId, req.body);
    logAudit(req.user, 'TENANT_EMAIL_CONFIG_UPDATED', 'Tenant:' + tenantId,
      { changed_fields: Object.keys(req.body) }, req);
    return res.json({ enabled: config.enabled, recipient: config.recipient,
      smtp_configured: Boolean(smtpTransportConfig()) });
  });

app.post(['/api/v1/alerts/test-email', '/api/alerts/test-email'], requireRole(['SUPER_ADMIN']), async (req, res) => {
  const tenantId = req.user?.tenant_id;
  if (!tenantId) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  const config = await db.getTenantEmailConfig(tenantId);
  if (!config.enabled || !config.recipient) {
    return res.status(400).json({ ok: false, error: 'NOT_CONFIGURED' });
  }
  const transport = smtpTransportConfig();
  if (!transport) return res.status(503).json({ ok: false, error: 'SMTP_NOT_CONFIGURED' });
  if (!isApprovedEmailRecipient(config.recipient, transport)) {
    return res.status(400).json({ ok: false, error: 'RECIPIENT_NOT_APPROVED' });
  }
  try {
    const result = await deliverTenantEmail(tenantId, config, {
      title: 'Alert email relay test', message: 'Test requested from the current workspace',
      severity: 'info'
    });
    if (!result.accepted) return res.status(502).json({ ok: false, error: result.reason });
    logAudit(req.user, 'TENANT_EMAIL_RELAY_ACCEPTED', 'Tenant:' + tenantId,
      { recipient_domain: config.recipient.split('@')[1] }, req);
    return res.json({ ok: true, status: 'ACCEPTED_BY_SMTP_RELAY',
      recipient: config.recipient });
  } catch {
    return res.status(502).json({ ok: false, error: 'SMTP_DELIVERY_FAILED',
      detail: 'The SMTP relay did not accept the message. No delivery was confirmed.' });
  }
});

// Device Groups & Policy Management V1
app.get('/api/v1/groups', async (req, res) => {
  if (!req.user?.tenant_id) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  const grps = await db.getGroups(req.user.tenant_id);
  return sendPaginated(req, res, grps, 50, 500);
});

app.post('/api/v1/groups', requireRole(['SUPER_ADMIN']), validateBody(createGroupSchema), async (req, res) => {
  const { name, description, policy_id } = req.body;
  if (!name) return res.status(400).json({ error: "Group name required" });

  const tenantId = req.user?.tenant_id;
  if (!tenantId) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  if (policy_id) {
    const policy = await db.getPolicyById(policy_id);
    if (!policy || String(policy.tenant_id) !== String(tenantId)) {
      return res.status(404).json({ error: 'POLICY_NOT_FOUND' });
    }
  }
  const newGrp = {
    tenant_id: tenantId,
    name,
    description: description || "",
    member_count: 0,
    policy_id: policy_id || null
  };

  const created = await db.createGroup(newGrp);
  logAudit(req.user, "DEVICE_GROUP_CREATED", `DeviceGroup:${name}`, { group_id: created.id }, req);
  res.status(201).json(created);
});

app.get('/api/v1/policies', async (req, res) => {
  if (!req.user?.tenant_id) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  const pols = await db.getPolicies(req.user.tenant_id);
  return sendPaginated(req, res, pols, 50, 500);
});

app.post('/api/v1/policies', requireRole(['SUPER_ADMIN']), validateBody(createPolicySchema), async (req, res) => {
  const { name, checkin_interval_sec, auto_update, maintenance_mode, data_retention_days } = req.body;
  if (!name) return res.status(400).json({ error: "Policy name required" });

  if (!req.user?.tenant_id) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  const newPol = {
    tenant_id: req.user.tenant_id,
    name,
    checkin_interval_sec: parseInt(checkin_interval_sec, 10) || 30,
    auto_update: auto_update !== false,
    maintenance_mode: !!maintenance_mode,
    data_retention_days: parseInt(data_retention_days, 10) || 90
  };

  const created = await db.createPolicy(newPol);
  logAudit(req.user, "POLICY_CREATED", `Policy:${name}`, { policy_id: created.id }, req);
  res.status(201).json(created);
});

// Patch & Security Posture V1
app.get('/api/v1/patches/summary', async (req, res) => {
  if (!req.user?.tenant_id) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  return res.json(await db.getTenantPatchInventory(req.user.tenant_id));
});

app.post('/api/v1/patches/:id/approve', requireRole(['SUPER_ADMIN', 'OPERATOR']), async (req, res) => {
  const kbId = req.params.id;
  if (!req.user?.tenant_id) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  const patch = await db.updateTenantPatchStatus(req.user.tenant_id, kbId, 'APPROVED');
  if (!patch) return res.status(404).json({ error: "Patch not found" });

  logAudit(req.user, "PATCH_APPROVED_FOR_DEPLOYMENT", `Patch:${kbId}`, { title: patch.title }, req);
  res.json(patch);
});

app.get('/api/v1/security/posture', async (req, res) => {
  const tenantId = req.user?.tenant_id;
  if (!tenantId) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  const agents = await db.getDevices({ tenant_id: tenantId });
  const posture = agents.map(a => ({
    device_id: a.id,
    hostname: a.hostname,
    os: a.os_version || a.os || null,
    ...normalizeAgentPosture(a)
  }));
  res.json(posture);
});

// App Usage & Running Processes Detail V1 (Live Telemetry from Machine)
app.get('/api/v1/devices/:id/processes', async (req, res) => {
  const devId = req.params.id;
  const dev = await db.getDeviceById(devId) || await db.getDeviceByHostname(devId);
  if (!dev) return res.status(404).json({ error: "Device not found" });

  if (!belongsToCurrentTenant(req.user, dev)) {
    return res.status(404).json({ error: 'Device not found' });
  }
  const liveProcs = await db.getDeviceProcesses(dev.id);
  const now = Date.now();
  const freshProcs = dev.telemetry_status === 'AGENT_REPORTED' && Array.isArray(liveProcs)
    ? liveProcs.filter(proc => {
        const observed = proc.updated_at ? new Date(proc.updated_at).getTime() : NaN;
        return Number.isFinite(observed) && observed <= now &&
          now - observed <= 15 * 60_000;
      })
    : [];
  if (freshProcs.length > 0) {
    return res.json({
      device_id: dev.id, hostname: dev.hostname,
      source: 'live_agent_telemetry',
      total_processes: freshProcs.length,
      processes: freshProcs
    });
  }

  // No synthetic process rows: absence of an agent snapshot is not a baseline.
  return res.json({
    device_id: dev.id, hostname: dev.hostname,
    source: 'NOT_REPORTED', total_processes: 0, processes: []
  });
});

app.get('/api/v1/devices/:id/app-usage', async (req, res) => {
  const devId = req.params.id;
  const dev = await db.getDeviceById(devId) || await db.getDeviceByHostname(devId);
  if (!dev) return res.status(404).json({ error: "Device not found" });

  if (!belongsToCurrentTenant(req.user, dev)) {
    return res.status(404).json({ error: 'Device not found' });
  }
  // Hostname-only cache keys are not tenant-unique across old enrollments.
  const liveUsage = await db.cacheGet(`app_usage:${dev.id}`);
  if (dev.telemetry_status === 'AGENT_REPORTED' &&
      liveUsage && Array.isArray(liveUsage) && liveUsage.length > 0) {
    return res.json({ device_id: dev.id, hostname: dev.hostname, source: "live_agent_telemetry", app_usage: liveUsage });
  }

  return res.json({
    device_id: dev.id, hostname: dev.hostname,
    source: 'NOT_REPORTED', app_usage: []
  });
});

// Data Retention & Webhooks Settings V1
app.get('/api/v1/settings/retention', requirePlatformSettingsAdmin, async (req, res) => {
  const settings = await db.getRetentionSettings();
  res.json(settings);
});

app.post('/api/v1/settings/retention', requirePlatformSettingsAdmin, validateBody(updateRetentionSchema), async (req, res) => {
  const {
    raw_telemetry_days,
    aggregated_metrics_days,
    audit_logs_days,
    resolved_alerts_days,
    completed_commands_days,
    slack_webhook_url,
    teams_webhook_url,
    notification_email
  } = req.body;
  const updates = {};
  if (raw_telemetry_days !== undefined) updates.raw_telemetry_days = parseInt(raw_telemetry_days, 10);
  if (aggregated_metrics_days !== undefined) updates.aggregated_metrics_days = parseInt(aggregated_metrics_days, 10);
  if (audit_logs_days !== undefined) updates.audit_logs_days = parseInt(audit_logs_days, 10);
  if (resolved_alerts_days !== undefined) updates.resolved_alerts_days = parseInt(resolved_alerts_days, 10);
  if (completed_commands_days !== undefined) updates.completed_commands_days = parseInt(completed_commands_days, 10);
  if (slack_webhook_url !== undefined) updates.slack_webhook_url = slack_webhook_url;
  if (teams_webhook_url !== undefined) updates.teams_webhook_url = teams_webhook_url;
  if (notification_email !== undefined) updates.notification_email = notification_email;

  const updated = await db.updateRetentionSettings(updates);
  logAudit(req.user, "RETENTION_SETTINGS_UPDATED", "SystemSettings", updated, req);
  res.json(updated);
});

// Manual / on-demand trigger endpoint for operators
app.post('/api/v1/settings/retention/run', requirePlatformSettingsAdmin, async (req, res) => {
  const result = await db.runDataRetentionPurge();
  logAudit(req.user, "RETENTION_PURGE_MANUALLY_TRIGGERED", "SystemSettings", result, req);
  res.json({ status: "success", result });
});

// N30: separate from ordinary telemetry-history retention. Active tenant
// receipt tombstones must survive indefinitely for safe delayed HTTP retries.
// A POST is dry-run-only unless an authorized platform admin explicitly
// confirms a bounded deletion of long-decommissioned, device-free tenants.
app.post('/api/v1/settings/retention/batch-receipts',
  requirePlatformSettingsAdmin,
  validateBody(batchReceiptMaintenanceSchema),
  async (req, res) => {
    const { dry_run, min_age_days, max_rows, confirm } = req.validatedBody;
    try {
      const result = await db.maintainTelemetryBatchReceipts({
        dryRun: dry_run, minAgeDays: min_age_days,
        limit: max_rows, confirm
      });
      logAudit(req.user,
        dry_run ? 'BATCH_RECEIPT_CLEANUP_PREVIEW' : 'BATCH_RECEIPT_DECOMMISSIONED_CLEANUP',
        'TelemetryBatchReceipts',
        { status: result.status, eligible: result.eligible, deleted: result.deleted,
          min_age_days: min_age_days, max_rows: max_rows },
        req);
      return res.json({ status: 'OK', result });
    } catch (err) {
      if (err.message === 'TELEMETRY_BATCH_MYSQL_REQUIRED') {
        return res.status(503).json({ error: 'DATABASE_UNAVAILABLE' });
      }
      if (err.message?.startsWith('TELEMETRY_BATCH_MAINTENANCE_')) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }
  });


// ---------------- API ROUTES ----------------

// Setup status (Canonical v1 + Legacy alias)
app.get(['/api/v1/setup/status', '/api/setup/status'], async (req, res) => {
  const branding = await db.getBranding();
  res.json({
    setup_complete: branding.setup_complete,
    default_build_mode: branding.build_mode,
    company_name: branding.company_name,
    server_host: branding.server_host,
    branding: branding.branding,
    build_mode: branding.build_mode,
    github_repo: branding.github_repo
  });
});

// Run setup (Canonical v1 + Legacy alias)
app.post(['/api/v1/setup', '/api/setup'], async (req, res, next) => {
  const branding = await db.getBranding();
  req.isInitialSetup = !branding.setup_complete;
  if (branding.setup_complete) {
    // Never let an ordinary authenticated user reset the administrator via
    // the wizard after initial setup. The API gateway has already checked
    // authentication; this is the additional authorization requirement.
    if (!isPlatformSettingsAdmin(req.user)) {
      return res.status(403).json({ error: 'PLATFORM_ADMIN_REQUIRED',
        detail: 'Only the designated platform operator can change completed server setup.' });
    }
  } else if (REQUIRE_SECURE_SETUP &&
             !isValidSetupKey(req.headers['x-setup-token'], INITIAL_SETUP_TOKEN)) {
    return res.status(403).json({ error: 'FORBIDDEN', detail: 'Valid initial setup key required.' });
  }
  return next();
}, validateBody(setupSchema), async (req, res) => {
  const { company_name, server_host, admin_username, admin_password, branding, build_mode, github_repo } = req.body;
  if (REQUIRE_SECURE_SETUP && req.isInitialSetup &&
      (typeof admin_password !== 'string' || admin_password.length < 12 ||
       ['Admin123!', 'Operator123!', 'Monitor123!'].includes(admin_password))) {
    return res.status(400).json({ error: 'WEAK_INITIAL_PASSWORD', detail: 'Choose a new administrator password of at least 12 characters, not a shipped demo password.' });
  }
  const updates = { setup_complete: true };
  if (company_name) updates.company_name = company_name;
  if (server_host) updates.server_host = server_host;
  if (branding) updates.branding = branding;
  if (build_mode) updates.build_mode = build_mode;
  if (github_repo) updates.github_repo = github_repo;
  // Never store browser-supplied GitHub credentials. Operator config lives only
  // in private GITHUB_ACTIONS_TOKEN; migration 007 scrubs historical PAT fields.

  // Never mark onboarding complete without a real persistent super-admin.
  // The old code issued a JWT for a fabricated admin when the DB was empty.
  let adminUser = await db.getUserByUsername('admin') || (await db.getUsers()).find(
    user => normalizeRole(user.role) === 'SUPER_ADMIN'
  );
  if (!adminUser || normalizeRole(adminUser.role) !== 'SUPER_ADMIN') {
    return res.status(503).json({ error: 'SETUP_UNAVAILABLE', detail: 'A persistent super-admin must exist before setup can complete.' });
  }
  if (adminUser) {
    const userUpdates = {};
    if (admin_username) userUpdates.username = admin_username;
    if (admin_password) userUpdates.password_hash = await bcrypt.hash(admin_password, 10);
    if (Object.keys(userUpdates).length > 0) {
      await db.updateUser(adminUser.id, userUpdates);
      adminUser = await db.getUserById(adminUser.id);
    }
  }

  // Only finalize the setup flag after the admin credentials are persisted.
  await db.updateBranding(updates);
  const token = issueUserToken(adminUser);
  res.cookie('auth_token', token, { httpOnly: true, secure: process.env.NODE_ENV !== 'test', sameSite: 'lax', maxAge: 8 * 3600 * 1000 });
  res.cookie('itk_session', token, { httpOnly: true, secure: process.env.NODE_ENV !== 'test', sameSite: 'lax', maxAge: 8 * 3600 * 1000 });

  res.json({
    company: updates.company_name || "Aaditech Enterprise",
    server_host: updates.server_host || "localhost",
    admin: {
      id: adminUser?.id || 1,
      username: adminUser?.username || "admin",
      role: normalizeRole(adminUser?.role || "SUPER_ADMIN")
    },
    token
  });
});

// Bootstrap (Canonical v1 + Legacy alias)
app.get(['/api/v1/bootstrap', '/api/bootstrap'], async (req, res) => {
  const branding = await db.getBranding();
  if (!req.user?.tenant_id) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  const tenantBrand = await db.getTenantBranding(req.user.tenant_id);
  const companies = await db.getCompanies(req.user.tenant_id);
  const storedUser = await db.getUserById(req.user.id) || req.user;
  // The active tenant/role comes from the verified workspace JWT principal,
  // not the user's different primary workspace stored in users.tenant_id.
  const authUser = { ...storedUser, tenant_id: req.user.tenant_id,
    role: req.user.role };
  const { password_hash, ...safeUser } = authUser;
  res.json({
    user: safeUser,
    company_name: tenantBrand.company_name || companies[0]?.name || branding.company_name,
    server_host: process.env.NODE_ENV !== 'test'
      ? process.env.SERVER_HOST : (branding.server_host || 'localhost'),
    branding: { ...branding.branding,
      logo_text: tenantBrand.logo_text || branding.branding?.logo_text || 'IT-Toolkit',
      color: tenantBrand.color || branding.branding?.color || '#38bdf8' },
    agent_token_configured: Boolean(AGENT_API_TOKEN),
    company: companies[0] || { id: 1, name: tenantBrand.company_name || branding.company_name },
    companies: companies
  });
});

app.get(['/api/status', '/api/v1/database/status'], async (req, res) => {
  const mysqlActive = isMysqlConnected();
  if (!req.user?.tenant_id) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  const devices = await db.getDevices({ tenant_id: req.user.tenant_id });
  const openAlerts = await db.getAlerts({ status: 'open', tenant_id: req.user.tenant_id });
  const pendingCommands = await db.getCommands({ status: 'pending', tenant_id: req.user.tenant_id });

  res.json({
    status: "ok",
    storage_engine: mysqlActive ? "MySQL (Production - Scalable & Persistent)" : "MySQL Offline",
    mysql_connected: mysqlActive,
    host: process.env.DB_HOST || "localhost",
    database: process.env.DB_NAME || "it_toolkit",
    last_ingest_error: null,
    total_managed_devices: devices.length,
    active_alerts: openAlerts.length,
    commands_in_queue: pendingCommands.length
  });
});

// Events (Canonical v1 + Legacy alias)
app.get(['/api/v1/events', '/api/events'], async (req, res) => {
  const { limit, offset } = parsePagination(req, 100, 500);
  if (!req.user?.tenant_id) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  const list = await db.getEvents(req.query.hostname || null, limit + offset,
    req.query.kind || null, req.user.tenant_id);
  sendPaginated(req, res, list, 100, 500);
});

// Commands (Canonical v1 + Legacy alias)
app.get(['/api/v1/commands', '/api/commands'], async (req, res) => {
  const tenantId = req.user?.tenant_id;
  if (!tenantId || (req.query.tenant_id && String(req.query.tenant_id) !== String(tenantId))) {
    return res.status(403).json({ error: 'TENANT_ACCESS_DENIED' });
  }
  const list = await db.getCommands({ tenant_id: tenantId });
  sendPaginated(req, res, list, 50, 500);
});

app.post(['/api/commands', '/api/v1/commands/dispatch'], requireRole(['SUPER_ADMIN', 'OPERATOR']), validateBody(commandDispatchSchema), async (req, res) => {
  const { agent_id, device_id, kind, command_type, payload, hostname } = req.body;
  const targetId = device_id || agent_id || hostname;
  const commandKind = command_type || kind || "DIAGNOSTIC";

  const agent = await db.getDeviceById(targetId) || 
                await db.getDeviceByUid(String(targetId)) || 
                await db.getDeviceByHostname(String(targetId));
  if (!agent) return res.status(404).json({ error: "Target agent/device not found" });

  if (!belongsToCurrentTenant(req.user, agent)) {
    return res.status(404).json({ error: 'Target agent/device not found' });
  }

  const cmdId = crypto.randomUUID();
  const cmd = {
    id: cmdId,
    tenant_id: agent.tenant_id || req.user?.tenant_id || '00000000-0000-0000-0000-000000000001',
    device_id: agent.id,
    agent_id: agent.id,
    hostname: agent.hostname,
    kind: commandKind,
    command_type: commandKind,
    payload: payload || {},
    status: "pending",
    result: null,
    dispatched_by: req.user?.username || "admin"
  };

  let queued = false;
  try {
    queued = await db.queueCommandInDb(cmd, process.env.NODE_ENV === 'test' ? undefined :
      { tenantId: req.user.tenant_id, tokenHash: agent.device_token_hash });
  } catch (error) {
    if (error.message === 'COMMAND_CREDENTIAL_CHANGED') {
      return res.status(409).json({ error: 'DEVICE_CREDENTIAL_NOT_ACTIVE' });
    }
  }
  if (!queued) return res.status(503).json({ error: 'COMMAND_QUEUE_UNAVAILABLE' });

  logAudit(req.user, "COMMAND_DISPATCHED", `Device:${agent.hostname}`, { 
    command_id: cmdId, 
    kind: commandKind 
  }, req);

  res.status(201).json(cmd);
});

// Polling endpoint used by real Windows Agents (every 15-30s)
app.get(['/api/commands/poll', '/api/v1/commands/poll'], async (req, res) => {
  const target = (req.query.hostname || req.query.device_id || '').trim();
  if (!target) {
    return res.status(400).json({ error: "Missing required query parameter: hostname or device_id" });
  }

  const ver = await verifyDeviceCredential(req, target);
  if (!ver.authenticated) {
    return res.status(ver.status || 401).json({ error: ver.error, detail: ver.detail });
  }

  const device = ver.device;
  const pollToken = req.headers['x-device-token'];
  const tokenHash = typeof pollToken === 'string' ? hashDeviceToken(pollToken) : '';
  if (!pollToken?.startsWith('itk_dev_') || !device.device_token_hash ||
      device.agent_token_revoked || tokenHash !== device.device_token_hash) {
    return res.status(403).json({ error: 'DEVICE_CREDENTIAL_REQUIRED' });
  }

  // Rate limit protection for high frequency polling
  const rateLimitKey = device.id || device.hostname || target;
  const rateLimitCheck = checkDeviceRateLimit(rateLimitKey);
  if (!rateLimitCheck.allowed) {
    return res.status(429).json({ error: "Too Many Requests", detail: "Per-device command polling rate limit exceeded." });
  }

  const pending = await db.getPendingCommandsForDevice(device.id);

  const signedPending = [];
  for (const c of pending) {
    const sig = signDeviceCommand({ device, command: c, deviceToken: pollToken });
    // Atomic claim also rechecks the current credential under the same
    // device row lock as revocation. Preserve explicit legacy test fixtures.
    try {
      const credential = process.env.NODE_ENV === 'test' ? undefined :
        { tenantId: device.tenant_id, tokenHash };
      if (!await db.markCommandPickedUp(c.id, device.id, credential)) continue;
    } catch (error) {
      if (error.message === 'COMMAND_CREDENTIAL_CHANGED') {
        return res.status(401).json({ error: 'COMMAND_CREDENTIAL_CHANGED' });
      }
      return res.status(503).json({ error: 'COMMAND_QUEUE_UNAVAILABLE' });
    }
    signedPending.push({
      ...c,
      status: "running",
      signed_content: sig.signed_content,
      signature: sig.signature
    });
  }

  res.json(signedPending);
});

// Result reporting endpoint called by real Windows Agent after execution
app.post(['/api/commands/:id/result', '/api/v1/commands/:id/result'], agentLimiter, validateBody(commandResultSchema), async (req, res) => {
  const cmdId = req.params.id;
  const cmd = await db.getCommandById(cmdId);
  if (!cmd) return res.status(404).json({ error: "Command not found in queue" });

  // This endpoint is exclusively for an enrolled agent to report results,
  // not for JWT users, bootstrap tokens, fleet HMACs or URL credentials.
  // Verify the exact command.device_id instead of matching a hostname,
  // which can be reused across tenants in older database records.
  const resultToken = req.headers['x-device-token'];
  if (typeof resultToken !== 'string' || !resultToken.startsWith('itk_dev_')) {
    return res.status(403).json({ error: 'DEVICE_CREDENTIAL_REQUIRED' });
  }
  const ver = await verifyDeviceCredential(req, cmd.device_id);
  if (!ver.authenticated) {
    return res.status(ver.status || 401).json({ error: ver.error, detail: ver.detail });
  }
  const resultDevice = ver.device;
  if (String(resultDevice.id).toLowerCase() !== String(cmd.device_id).toLowerCase() ||
      resultDevice.agent_token_revoked || !resultDevice.device_token_hash ||
      hashDeviceToken(resultToken) !== resultDevice.device_token_hash) {
    return res.status(403).json({ error: 'COMMAND_DEVICE_OWNERSHIP_MISMATCH' });
  }

  const status = req.body.status || (req.body.exit_code === 0 ? "completed" : "failed");
  const output = req.body.output || req.body.stdout || "";
  const stderr = req.body.stderr || "";
  const exitCode = req.body.exit_code ?? 0;

  let committed = false;
  try {
    committed = await db.completeCommandInDb(
      cmd.id, status, output, stderr, exitCode, resultDevice.id,
      process.env.NODE_ENV === 'test' ? undefined :
        { tenantId: resultDevice.tenant_id, tokenHash: hashDeviceToken(resultToken) }
    );
  } catch (error) {
    if (error.message === 'COMMAND_CREDENTIAL_CHANGED') {
      return res.status(401).json({ error: 'COMMAND_CREDENTIAL_CHANGED' });
    }
    return res.status(503).json({ error: 'COMMAND_RESULT_DATABASE_UNAVAILABLE' });
  }
  if (committed) {
    // Only the first committed write generates the completion audit.
    logAudit({ tenant_id: resultDevice.tenant_id,
      username: 'agent:' + resultDevice.hostname }, "COMMAND_COMPLETED", `Command:${cmd.id}`, {
      device: cmd.hostname, status, exit_code: exitCode
    }, req);
  }

  // If the first response was lost after commit, an exact authenticated
  // retry gets the original persisted receipt, without updating timestamps
  // or emitting a second completion audit. Changed results remain conflicts.
  let receipt;
  try {
    receipt = await db.getExactCommandResultReceipt(
      cmd.id, resultDevice.id, status, output, stderr, exitCode
    );
  } catch (_) {
    return res.status(503).json({ error: 'COMMAND_RESULT_DATABASE_UNAVAILABLE' });
  }
  if (!receipt) {
    return res.status(committed ? 503 : 409).json({
      error: committed ? 'COMMAND_RESULT_RECEIPT_UNAVAILABLE' : 'COMMAND_NOT_IN_PROGRESS_OR_ALREADY_RECORDED'
    });
  }
  res.json({ ok: true, ...receipt, duplicate: !committed });
});


// Software (Canonical v1 + Legacy alias)
app.get(['/api/v1/software/search', '/api/software/search'], async (req, res) => {
  const q = (req.query.q || "").toLowerCase();
  const tenantId = req.user?.tenant_id;
  if (!tenantId) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  const agents = await db.getDevices({ tenant_id: tenantId });
  const results = [];

  for (const a of agents) {
    const rawProcs = await db.getDeviceProcesses(a.id);
    let apps = (rawProcs || []).map(p => ({
      DisplayName: p.name || p.process_name,
      DisplayVersion: "1.0.0",
      Publisher: "Local System",
      Path: p.path || p.executable_path || "System"
    }));
    if (q) {
      apps = apps.filter(app => app.DisplayName.toLowerCase().includes(q) || app.Publisher.toLowerCase().includes(q));
    }
    results.push({
      hostname: a.hostname,
      apps
    });
  }

  res.json({ results, agents: agents.length });
});

app.get(['/api/v1/software/export', '/api/software/export'], async (req, res) => {
  const tenantId = req.user?.tenant_id;
  if (!tenantId) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  const agents = await db.getDevices({ tenant_id: tenantId });
  let csv = 'Hostname,Application,Version,Publisher\n';
  for (const a of agents) {
    const procs = await db.getDeviceProcesses(a.id);
    for (const p of procs) {
      csv += `"${a.hostname}","${(p.name || '').replace(/"/g, '""')}","1.0.0","Local System"\n`;
    }
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="software_inventory.csv"');
  res.send(csv);
});

// License (Canonical v1 + Legacy alias)
app.get(['/api/v1/license/compliance', '/api/license/compliance'], async (req, res) => {
  const tenantId = req.user?.tenant_id;
  if (!tenantId) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  const agents = await db.getDevices({ tenant_id: tenantId });
  res.json({
    compliance: agents.map(a => ({
      hostname: a.hostname,
      windows_ok: false,
      windows_status: "UNKNOWN",
      windows_key_last5: "N/A",
      office_ok: false,
      office_status: "NOT_CONFIGURED",
      office_key_last5: "N/A"
    }))
  });
});

app.get(['/api/v1/license/export', '/api/license/export'], async (req, res) => {
  const tenantId = req.user?.tenant_id;
  if (!tenantId) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  const agents = await db.getDevices({ tenant_id: tenantId });
  let csv = 'Hostname,WindowsStatus,OfficeStatus,Compliant\n';
  for (const a of agents) {
    csv += `"${a.hostname}","UNKNOWN","NOT_CONFIGURED","UNKNOWN"\n`;
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="license_compliance.csv"');
  res.send(csv);
});

// Reports (Canonical v1 + Legacy alias)
app.get(['/api/v1/reports/fleet', '/api/report/fleet'], async (req, res) => {
  const version = getAgentVersion();
  const tenantId = req.user?.tenant_id;
  if (!tenantId) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  const agents = await db.getDevices({ tenant_id: tenantId });
  let csv = 'Hostname,OS,IP,AgentVersion,Status,LastSeen\n';
  for (const a of agents) {
    csv += `"${a.hostname}","${a.os_version || a.os || ''}","${a.ip_address || a.ip || ''}","${a.agent_version || version}","${a.status || 'offline'}","${a.last_seen || ''}"\n`;
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="fleet_report.csv"');
  res.send(csv);
});

app.get(['/api/v1/reports/device/:id', '/api/report/agent/:id'], async (req, res) => {
  const agent = await db.getDeviceById(req.params.id) || await db.getDeviceByHostname(req.params.id);
  if (!belongsToCurrentTenant(req.user, agent)) {
    return res.status(404).json({ error: "Device not found" });
  }
  if (req.query.format === 'csv') {
    const events = await db.getEvents(agent.hostname, 100, null, req.user.tenant_id, agent.id);
    let csv = 'Hostname,Kind,CapturedAt\n';
    for (const ev of events) {
      csv += `"${agent.hostname}","${ev.kind || 'telemetry'}","${ev.created_at || ev.recorded_at || ''}"\n`;
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${agent.hostname}_events.csv"`);
    return res.send(csv);
  }
  const events = await db.getEvents(agent.hostname, 100, null, req.user.tenant_id, agent.id);
  res.json(events);
});

// Features (Canonical v1 + Legacy alias)
app.get(['/api/v1/features', '/api/features'], async (req, res) => {
  const features = await db.getFeatures();
  res.json(features);
});

app.put(['/api/v1/features/:name', '/api/features/:name'], requirePlatformSettingsAdmin, validateBody(updateFeatureSchema), async (req, res) => {
  await db.updateFeature(req.params.name, req.body);
  res.json({ ok: true });
});

// Users (Canonical v1 + Legacy alias)
app.get(['/api/v1/users', '/api/users'], requireRole(['SUPER_ADMIN']), async (req, res) => {
  if (!req.user?.tenant_id) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  const users = await db.getUsers(req.user.tenant_id);
  const safeUsers = users.map(({ password_hash, ...u }) => ({
    ...u,
    role: normalizeRole(u.role)
  }));
  sendPaginated(req, res, safeUsers, 50, 500);
});

app.post(['/api/v1/users', '/api/users'], requireRole(['SUPER_ADMIN']), validateBody(createUserSchema), async (req, res) => {
  const { username, password, role, email } = req.body;
  if (!username || username.length < 3) return res.status(400).json({ detail: "Username too short" });
  
  const existing = await db.getUserByUsername(username);
  if (existing) {
    return res.status(409).json({ detail: "Username already exists" });
  }

  if (!req.user?.tenant_id) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  if (process.env.NODE_ENV !== 'test' && !password) {
    return res.status(400).json({ error: 'EXPLICIT_PASSWORD_REQUIRED' });
  }
  const companies = await db.getCompanies(req.user.tenant_id);
  const actingUser = await db.getUserById(req.user.id);
  const company = companies.find(c => String(c.id) === String(actingUser?.company_id)) || companies[0];
  if (!company) return res.status(409).json({ error: 'TENANT_COMPANY_REQUIRED' });
  const rawPassword = password || "ChangeMe123!";
  const password_hash = await bcrypt.hash(rawPassword, 10);

  const newUser = {
    username,
    email: email || `${username}@aaditech.com`,
    password_hash,
    role: normalizeRole(role || "MONITORING"),
    active: true,
    company_id: company.id,
    tenant_id: req.user.tenant_id
  };

  const created = await db.createUser(newUser);
  logAudit(req.user, "USER_CREATED", `User:${username}`, { role: created.role }, req);

  const { password_hash: _, ...safeUser } = created;
  res.status(201).json(safeUser);
});

app.put(['/api/v1/users/:id', '/api/users/:id'], requireRole(['SUPER_ADMIN']), validateBody(updateUserSchema), async (req, res) => {
  const user = await db.getUserById(req.params.id);
  if (!belongsToCurrentTenant(req.user, user)) return res.status(404).json({ detail: "User not found" });

  const updates = {};
  if (req.body.role) updates.role = normalizeRole(req.body.role);
  if (req.body.active !== undefined) updates.active = req.body.active;
  if (req.body.password) {
    updates.password_hash = await bcrypt.hash(req.body.password, 10);
  }

  await db.updateUser(user.id, updates);
  logAudit(req.user, "USER_UPDATED", `User:${user.username}`, { role: updates.role || user.role, active: updates.active !== undefined ? updates.active : user.active }, req);
  res.json({ ok: true, id: user.id, role: updates.role || user.role, active: updates.active !== undefined ? updates.active : user.active });
});

// Companies (Canonical v1 + Legacy alias)
app.get(['/api/v1/companies', '/api/companies'], async (req, res) => {
  if (!req.user?.tenant_id) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  const comps = await db.getCompanies(req.user.tenant_id);
  sendPaginated(req, res, comps, 50, 500);
});

app.post(['/api/v1/companies', '/api/companies'], requireRole(['SUPER_ADMIN']), validateBody(createCompanySchema), async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ detail: "Company name required" });

  if (!req.user?.tenant_id) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  const comp = await db.createCompany({ name, users: 1, agents: 0, tenant_id: req.user.tenant_id });
  logAudit(req.user, "COMPANY_CREATED", `Company:${name}`, {}, req);
  res.status(201).json(comp);
});

// Default Company Setting (Canonical v1 + Legacy alias)
app.get(['/api/v1/settings/default-company', '/api/settings/default-company'], async (req, res) => {
  if (!req.user?.tenant_id) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  const comp = await db.getTenantDefaultCompany(req.user.tenant_id);
  return res.json({ company_id: comp?.id || null, company_name: comp?.name || '' });
});

app.post(['/api/v1/settings/default-company', '/api/settings/default-company'], requireRole(['SUPER_ADMIN']), validateBody(defaultCompanySchema), async (req, res) => {
  if (!req.user?.tenant_id) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  const companies = await db.getCompanies(req.user.tenant_id);
  const comp = companies.find(c => c.name === req.body.name);
  if (!comp) return res.status(404).json({ error: 'COMPANY_NOT_IN_WORKSPACE' });
  await db.setTenantDefaultCompany(req.user.tenant_id, comp.id);
  logAudit(req.user, 'DEFAULT_COMPANY_CHANGED', `Company:${comp.name}`,
    { tenant_id: req.user.tenant_id, company_id: comp.id }, req);
  return res.json({ ok: true, company_id: comp.id, company_name: comp.name });
});

// Helper functions for Agent Installer Script Generation
function getInstallCmdContent(host, protocol, version = getAgentVersion()) {
  return `@echo off
:: ============================================================================
:: IT-Toolkit Enterprise Agent Deployment & Configuration Script
:: Version: ${version}
:: Target Server: ${host}
:: ============================================================================
setlocal EnableDelayedExpansion

title IT-Toolkit Agent Deployment

echo.
echo ============================================================================
echo   IT-Toolkit Enterprise Agent Installer
echo ============================================================================
echo.

:: 1. Administrative Privilege Check
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] This installer requires Administrator privileges.
    echo Please right-click install-agent.cmd and select "Run as Administrator".
    echo.
    pause
    exit /b 1
)

set "SCRIPT_DIR=%~dp0"
set "TARGET_DIR=C:\\ProgramData\\ITToolkit-Agent"
set "INSTALL_DIR=C:\\Program Files\\IT-Toolkit"
set "LOG_FILE=%TEMP%\\ittk_agent_install.log"
:: Both 64-hex fingerprints MUST come from an independently authenticated
:: owner release approval, never the same folder/archive as the MSI.
set "MSI_FILE=%SCRIPT_DIR%IT-Toolkit-Agent-${version}.msi"
if not exist "%MSI_FILE%" (
    echo [BLOCKED] Approved signed MSI missing. No configuration was changed.
    exit /b 3
)
:: Read owner approval pins from PowerShell environment, not interpolated into
:: CMD executable text. Windows PowerShell 5.1 supports this verifier.
powershell.exe -NoProfile -NonInteractive -Command "$e=$env:AADITECH_APPROVED_MSI_SHA256; $s=$env:AADITECH_APPROVED_SIGNER_CERT_SHA256; $p=$env:MSI_FILE; if ($e -notmatch '^[0-9A-Fa-f]{64}$' -or $s -notmatch '^[0-9A-Fa-f]{64}$') { exit 10 }; $i=Get-Item -LiteralPath $p -ErrorAction Stop; if (-not $i -or $i.PSIsContainer -or ($i.Attributes -band [IO.FileAttributes]::ReparsePoint)) { exit 11 }; $m=Get-FileHash -LiteralPath $p -Algorithm SHA256; if ($m.Hash -ine $e) { exit 12 }; $a=Get-AuthenticodeSignature -LiteralPath $p; if ($a.Status -ne 'Valid' -or -not $a.SignerCertificate) { exit 13 }; $h=[System.Security.Cryptography.SHA256]::Create(); try { $cert=([BitConverter]::ToString($h.ComputeHash($a.SignerCertificate.RawData))).Replace('-', '') } finally { $h.Dispose() }; if ($cert -ine $s) { exit 14 }; exit 0"
if errorlevel 1 (
    echo [BLOCKED] MSI hash, Authenticode signature or approved signer validation failed.
    echo No installation or configuration change has been performed.
    exit /b 3
)

echo [*] Target ProgramData Directory: %TARGET_DIR%
if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"

:: 2. Production HTTPS uses Windows OS trust. Do NOT auto-import any CA file.
::  An enterprise root can only be deployed by separately approved device policy.

:: 3. Copy Agent Configuration
if exist "%SCRIPT_DIR%agent.json" (
    echo [*] Deploying agent.json to %TARGET_DIR%\\agent.json...
    copy /y "%SCRIPT_DIR%agent.json" "%TARGET_DIR%\\agent.json" >nul
    echo [OK] Configuration deployed.
)

:: 4. Execute only the previously verified, owner-approved signed MSI.
echo [*] Running approved IT-Toolkit Agent MSI...
msiexec /i "!MSI_FILE!" /qn /norestart /log "%LOG_FILE%"
if !errorLevel! neq 0 (
    echo [ERROR] MSI installation failed with exit code !errorLevel!. See %LOG_FILE%
    exit /b !errorLevel!
)
echo [OK] Approved signed MSI installation completed.

:: 5. Set Registry Overrides
echo [*] Stamping Registry configuration...
reg add "HKLM\\SOFTWARE\\ITToolkit\\Agent" /v "EndpointUrl" /t REG_SZ /d "${protocol}://${host}/api/v1/ingest/telemetry" /f >nul 2>&1
reg add "HKLM\\SOFTWARE\\ITToolkit\\Agent" /v "Installed" /t REG_SZ /d "${version}" /f >nul 2>&1

:: 6. Lock down file security permissions
icacls "%TARGET_DIR%" /inheritance:r /grant:r SYSTEM:(OI)(CI)F Administrators:(OI)(CI)F "NETWORK SERVICE":(OI)(CI)M /C >nul 2>&1

:: 7. Trigger Immediate First Agent Collection Run
echo [*] Triggering health & telemetry collection task...
schtasks /run /tn ITToolkitAgent >nul 2>&1
if !errorLevel! equ 0 (
    echo [OK] Scheduled task triggered successfully.
) else (
    schtasks /create /tn ITToolkitAgent /sc minute /mo 30 /ru "NT AUTHORITY\\NETWORK SERVICE" /rp "" /f /tr "\\" %INSTALL_DIR%\\IT-Toolkit-Agent.exe\\" -LoopMinutes 30" >nul 2>&1
    schtasks /run /tn ITToolkitAgent >nul 2>&1
)

echo.
echo ============================================================================
echo [SUCCESS] IT-Toolkit Enterprise Agent Deployment Complete!
echo The agent is reporting to: ${protocol}://${host}/api/v1/ingest/telemetry
echo ============================================================================
echo.
if "%1" neq "/quiet" (
    timeout /t 4
)
exit /b 0
`;
}

function getInstallPs1Content(host, protocol, version = getAgentVersion()) {
  return `<#
.SYNOPSIS
    IT-Toolkit Enterprise Agent Automated PowerShell Deployer
.DESCRIPTION
    Installs the IT-Toolkit MSI, sets up C:\\ProgramData\\ITToolkit-Agent\\agent.json,
    verifies a signed, independently approved MSI before setting HKLM Registry values.
#>
[CmdletBinding()]
param(
    [string]$ServerHost = "${host}",
    [string]$EndpointUrl = "${protocol}://${host}/api/v1/ingest/telemetry",
    [string]$Token = "",
    [switch]$Quiet
)

$ErrorActionPreference = "Stop"

# Verify Elevation
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Error "Administrator privileges are required to install the IT-Toolkit Agent. Please run PowerShell as Administrator."
    exit 1
}

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  IT-Toolkit Enterprise Agent Deployment (PowerShell)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
if (-not $ScriptDir) { $ScriptDir = Get-Location }
$TargetDir = "C:\\ProgramData\\ITToolkit-Agent"
$LogFile = Join-Path $env:TEMP "ittk_agent_install_ps.log"
# Fail before any config, token, registry or MSI execution. Both public
# SHA256 fingerprints must come from a separate, authenticated release record.
$approvedSha256 = [string]$env:AADITECH_APPROVED_MSI_SHA256
$approvedSignerSha256 = [string]$env:AADITECH_APPROVED_SIGNER_CERT_SHA256
if ($approvedSha256 -notmatch '^[0-9A-Fa-f]{64}$' -or
    $approvedSignerSha256 -notmatch '^[0-9A-Fa-f]{64}$') {
    throw 'MSI_RELEASE_APPROVAL_REQUIRED: approved MSI and signer fingerprints required'
}
$msiPath = Join-Path $ScriptDir "IT-Toolkit-Agent-${version}.msi"
$msiItem = Get-Item -LiteralPath $msiPath -ErrorAction Stop
if ($msiItem.PSIsContainer -or ($msiItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'MSI_RELEASE_INVALID_FILE: linked or non-file MSI refused'
}
$hash = Get-FileHash -LiteralPath $msiPath -Algorithm SHA256
if ($hash.Hash -ine $approvedSha256) { throw 'MSI_RELEASE_HASH_NOT_APPROVED' }
$signature = Get-AuthenticodeSignature -LiteralPath $msiPath
if ($signature.Status -ne 'Valid' -or -not $signature.SignerCertificate) {
    throw 'MSI_RELEASE_AUTHENTICODE_NOT_VALID'
}
$sha = [System.Security.Cryptography.SHA256]::Create()
try {
    $signerHash = ([BitConverter]::ToString($sha.ComputeHash($signature.SignerCertificate.RawData))).Replace('-', '')
} finally {
    $sha.Dispose()
}
if ($signerHash -ine $approvedSignerSha256) { throw 'MSI_RELEASE_SIGNER_NOT_APPROVED' }

if (-not (Test-Path $TargetDir)) {
    New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
    Write-Host "[+] Created directory: $TargetDir" -ForegroundColor Green
}

# 1. Deploy agent.json
$agentJsonPath = Join-Path $TargetDir "agent.json"
$configData = @{
    endpoint = $EndpointUrl
    token = $Token
    enroll_url = "${protocol}://${host}/api/v1/agent/enroll"
    agent_version = "${version}"
    interval_minutes = 30
}
$configData | ConvertTo-Json | Set-Content -Path $agentJsonPath -Force
Write-Host "[+] Generated runtime agent.json at $agentJsonPath" -ForegroundColor Green

# 2. Public HTTPS uses the Windows trust store. Do NOT import custom roots.
# Trusted enterprise certificates, if needed, must be deployed via approved policy.

# 3. Execute only the previously verified owner-approved signed MSI.
Write-Host "[+] Executing approved MSI installer: $msiPath" -ForegroundColor Yellow
$p = Start-Process "msiexec.exe" -ArgumentList "/i \`"$msiPath\`" /qn /norestart /log \`"$LogFile\`"" -Wait -PassThru
if ($p.ExitCode -ne 0) {
    Write-Error "MSI installation failed with exit code $($p.ExitCode). Log file: $LogFile"
    exit $p.ExitCode
}
Write-Host "[+] Approved signed MSI installation completed." -ForegroundColor Green

# 4. Registry Configuration
$regPath = "HKLM:\\SOFTWARE\\ITToolkit\\Agent"
if (-not (Test-Path $regPath)) {
    New-Item -Path $regPath -Force | Out-Null
}
Set-ItemProperty -Path $regPath -Name "EndpointUrl" -Value $EndpointUrl -Force
Set-ItemProperty -Path $regPath -Name "Installed" -Value "${version}" -Force
Write-Host "[+] Registry configuration updated at $regPath" -ForegroundColor Green

# 5. Trigger Task Check-In
try {
    schtasks.exe /run /tn ITToolkitAgent | Out-Null
    Write-Host "[+] Scheduled task 'ITToolkitAgent' triggered for immediate check-in." -ForegroundColor Green
} catch {
    Write-Host "[!] Creating Scheduled Task 'ITToolkitAgent'..." -ForegroundColor Yellow
    $cmd = "schtasks.exe /create /tn ITToolkitAgent /sc minute /mo 30 /ru \`"NT AUTHORITY\\NETWORK SERVICE\`" /rp \`"\`" /f /tr \`"\`"C:\\Program Files\\IT-Toolkit\\IT-Toolkit-Agent.exe\`" -LoopMinutes 30\`""
    Invoke-Expression $cmd | Out-Null
    schtasks.exe /run /tn ITToolkitAgent | Out-Null
}

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " IT-Toolkit Enterprise Agent Successfully Installed!" -ForegroundColor Green
Write-Host " Ingest Endpoint: $EndpointUrl" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
`;
}

// Helper to grant bootstrap tokens ONLY to authenticated administrators
async function resolveAuthorizedBootstrapToken(req) {
  const userToken = extractToken(req);
  if (!userToken || revokedTokens.has(userToken) ||
      await db.isTokenRevokedInDb(userToken)) return null;
  try {
    const decoded = jwt.verify(userToken, EFFECTIVE_JWT_SECRET, { algorithms: ['HS256'] });
    if (decoded.jti && (revokedTokens.has(decoded.jti) ||
        await db.isTokenRevokedInDb(decoded.jti))) return null;
    const principal = await resolveCurrentUserPrincipal(decoded);
    if (principal && ['SUPER_ADMIN', 'OPERATOR'].includes(principal.role)) {
      return generateBootstrapToken(principal.tenant_id, "authorized-bundle", 24);
    }
  } catch (err) {
    // A malformed bearer credential may access the public bundle as an
    // unauthenticated download, but it never receives enrollment privileges.
  }
  return null;
}

// Agent bundle & downloads (Canonical v1 + Legacy aliases)
app.get(['/api/v1/agent-bundle', '/api/agent-bundle', '/api/v1/agent/bundle'], async (req, res) => {
  const branding = await db.getBranding();
  // Production setup URLs are bound to configured DNS + HTTPS, never request headers.
  const origin = resolveAgentOrigin(req, branding);
  if (!origin) return res.status(503).json({ error: 'AGENT_ORIGIN_NOT_CONFIGURED' });
  const { host, protocol } = origin;
  const version = getAgentVersion();
  const msiInfo = resolveAgentMsi(version);
  const caCert = getCaCertificate();
  const bootstrapToken = await resolveAuthorizedBootstrapToken(req);

  res.json({
    company: branding.company_name,
    server_host: host,
    scheme: protocol,
    agent_json: {
      endpoint: `${protocol}://${host}/api/v1/ingest/telemetry`,
      poll_url: `${protocol}://${host}/api/commands/poll?hostname=`,
      enroll_url: `${protocol}://${host}/api/agent/enroll`,
      bootstrap_token: bootstrapToken,
      token: bootstrapToken,
      agent_version: version,
      interval_minutes: 30
    },
    rollout_target: branding.rollout_target || "",
    ca_cert: caCert,
    install_cmd: getInstallCmdContent(host, protocol, version),
    install_ps1: getInstallPs1Content(host, protocol, version),
    msi_available: msiInfo.found,
    msi_size: msiInfo.size,
    msi_filename: `IT-Toolkit-Agent-${version}.msi`,
    msi_url: "/api/agent-msi",
    bundle_zip_url: "/api/agent/bundle.zip"
  });
});

app.get(['/api/v1/agent/agent.json', '/api/agent/agent.json'], async (req, res) => {
  const branding = await db.getBranding();
  // Production setup URLs are bound to configured DNS + HTTPS, never request headers.
  const origin = resolveAgentOrigin(req, branding);
  if (!origin) return res.status(503).json({ error: 'AGENT_ORIGIN_NOT_CONFIGURED' });
  const { host, protocol } = origin;
  const version = getAgentVersion();
  const bootstrapToken = await resolveAuthorizedBootstrapToken(req);

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="agent.json"');
  res.json({
    endpoint: `${protocol}://${host}/api/v1/ingest/telemetry`,
    poll_url: `${protocol}://${host}/api/commands/poll?hostname=`,
    enroll_url: `${protocol}://${host}/api/v1/agent/enroll`,
    bootstrap_token: bootstrapToken,
    token: bootstrapToken,
    agent_version: version,
    interval_minutes: 30
  });
});

app.get(['/api/v1/agent/install.cmd', '/api/agent/install.cmd'], async (req, res) => {
  const branding = await db.getBranding();
  // Production setup URLs are bound to configured DNS + HTTPS, never request headers.
  const origin = resolveAgentOrigin(req, branding);
  if (!origin) return res.status(503).json({ error: 'AGENT_ORIGIN_NOT_CONFIGURED' });
  const { host, protocol } = origin;
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', 'attachment; filename="install-agent.cmd"');
  res.send(getInstallCmdContent(host, protocol, getAgentVersion()));
});

app.get(['/api/v1/agent/install.ps1', '/api/agent/install.ps1'], async (req, res) => {
  const branding = await db.getBranding();
  // Production setup URLs are bound to configured DNS + HTTPS, never request headers.
  const origin = resolveAgentOrigin(req, branding);
  if (!origin) return res.status(503).json({ error: 'AGENT_ORIGIN_NOT_CONFIGURED' });
  const { host, protocol } = origin;
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', 'attachment; filename="install-agent.ps1"');
  res.send(getInstallPs1Content(host, protocol, getAgentVersion()));
});

const handleAgentBundleZip = async (req, res) => {
  const branding = await db.getBranding();
  // Production setup URLs are bound to configured DNS + HTTPS, never request headers.
  const origin = resolveAgentOrigin(req, branding);
  if (!origin) return res.status(503).json({ error: 'AGENT_ORIGIN_NOT_CONFIGURED' });
  const { host, protocol } = origin;
  const version = getAgentVersion();
  const bootstrapToken = await resolveAuthorizedBootstrapToken(req);

  const zip = new JSZip();
  const agentJson = JSON.stringify({
    endpoint: `${protocol}://${host}/api/v1/ingest/telemetry`,
    poll_url: `${protocol}://${host}/api/commands/poll?hostname=`,
    enroll_url: `${protocol}://${host}/api/v1/agent/enroll`,
    bootstrap_token: bootstrapToken,
    token: bootstrapToken,
    agent_version: version,
    interval_seconds: 30
  }, null, 2);

  const agentScriptPath = path.join(__dirname, 'Enterprise', 'agent', 'Aaditech-Agent.ps1');
  const agentCollectPath = path.join(__dirname, 'Enterprise', 'agent', 'Agent-Collect.ps1');
  const collectorsDirPath = path.join(__dirname, 'Enterprise', 'agent', 'collectors');
  const installCmdPath = path.join(__dirname, 'Enterprise', 'agent', 'install-agent.cmd');
  const testCmdPath = path.join(__dirname, 'Enterprise', 'agent', 'run-agent-once.cmd');
  const uninstallCmdPath = path.join(__dirname, 'Enterprise', 'agent', 'uninstall-agent.cmd');

  const agentScript = fs.existsSync(agentScriptPath) ? fs.readFileSync(agentScriptPath, 'utf8') : '';
  const agentCollectScript = fs.existsSync(agentCollectPath) ? fs.readFileSync(agentCollectPath, 'utf8') : '';
  // The legacy static install-agent.cmd schedules unsigned PowerShell as
  // SYSTEM and bypasses signed MSI release admission. Never package it.
  const installCmd = getInstallCmdContent(host, protocol, version);
  const installPs1 = getInstallPs1Content(host, protocol, version);
  const testCmd = fs.existsSync(testCmdPath) ? fs.readFileSync(testCmdPath, 'utf8') : '';
  const uninstallCmd = fs.existsSync(uninstallCmdPath) ? fs.readFileSync(uninstallCmdPath, 'utf8') : '';
  const caCert = getCaCertificate();

  zip.file("agent.json", agentJson);
  if (caCert) zip.file("ca.crt", caCert);
  zip.file("Aaditech-Agent.ps1", agentScript);
  if (agentCollectScript) zip.file("Agent-Collect.ps1", agentCollectScript);
  if (fs.existsSync(collectorsDirPath)) {
    const collectorFiles = fs.readdirSync(collectorsDirPath);
    for (const cFile of collectorFiles) {
      const fullPath = path.join(collectorsDirPath, cFile);
      if (fs.statSync(fullPath).isFile()) {
        zip.file(`collectors/${cFile}`, fs.readFileSync(fullPath, 'utf8'));
      }
    }
  }
  zip.file("install-agent.cmd", installCmd);
  zip.file("install-agent.ps1", installPs1);
  zip.file("run-agent-once.cmd", testCmd);
  zip.file("uninstall-agent.cmd", uninstallCmd);
  zip.file("README-HOSTINGER.txt",
    `Aaditech Enterprise Agent Bundle (Hostinger MySQL & Node.js Ready)\n` +
    `===================================================================\n` +
    `Agent Version:      ${version}\n` +
    `Endpoint Ingestion: ${protocol}://${host}/api/v1/ingest/telemetry\n` +
    `Command Polling:    ${protocol}://${host}/api/commands/poll\n\n` +
    `Run 'install-agent.cmd' as Administrator to register scheduled background task.\n` +
    `Run 'run-agent-once.cmd' to immediately test real telemetry submission.\n`
  );

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="IT-Toolkit-Agent-Bundle-v${version}.zip"`);
  res.send(zipBuffer);
};

app.get('/api/agent/bundle.zip', handleAgentBundleZip);
app.get('/api/v1/agent/bundle.zip', handleAgentBundleZip);

app.get(['/api/v1/ca.crt', '/api/ca.crt'], (req, res) => {
  if (process.env.NODE_ENV !== 'test') {
    return res.status(410).json({ error: 'LEGACY_CA_DISTRIBUTION_DISABLED', detail: 'Production HTTPS uses publicly trusted server TLS. Custom root import is not supported.' });
  }
  const caCert = getCaCertificate();
  res.setHeader('Content-Type', 'application/x-pem-file');
  res.setHeader('Content-Disposition', 'attachment; filename="itk-ca.crt"');
  res.send(caCert);
});

// Release control is platform-global. Only the explicitly designated
// persistent platform operator may update rollout target or trigger CI.
app.put(['/api/v1/agent/update-target', '/api/agent/update-target'],
  requirePlatformSettingsAdmin, validateBody(updateTargetVersionSchema), async (req, res) => {
    const version = req.validatedBody.target_version;
    if (process.env.NODE_ENV === 'production') {
      const artifact = resolveAgentMsi(version);
      if (!artifact.found || !matchesApprovedReleaseHash(artifact.path)) {
        return res.status(503).json({ error: 'MSI_RELEASE_NOT_APPROVED' });
      }
    }
    await db.updateBranding({ rollout_target: version });
    logAudit(req.user, 'GLOBAL_AGENT_ROLLOUT_TARGET_CHANGED', 'AgentRelease',
      { target_version: version }, req);
    return res.json({ ok: true, rollout_target: version });
  });

// Never reuse API_TOKEN/agent bearer credentials as a GitHub API token.
// Do not accept arbitrary browser-provided repository URLs or GitHub PATs.
app.get(['/api/v1/build/status', '/api/build/status'],
  requirePlatformSettingsAdmin, async (req, res) => {
    const config = approvedGithubBuildConfig();
    const branding = await db.getBranding();
    const version = getAgentVersion();
    const msi = resolveAgentMsi(version);
    const github = await readApprovedBuildStatus(config);
    return res.json({
      mode: branding.build_mode || 'manual',
      github_repo: config?.repo || '',
      msi_available: msi.found,
      msi_size: msi.size,
      msi_filename: msi.filename,
      agent_version: version,
      github
    });
  });

app.post(['/api/v1/build/trigger', '/api/build/trigger'],
  requirePlatformSettingsAdmin, validateBody(buildTriggerSchema), async (req, res) => {
    const config = approvedGithubBuildConfig();
    if (!config) return res.status(503).json({ error: 'GITHUB_ACTIONS_NOT_CONFIGURED',
      detail: 'Configure private GITHUB_ACTIONS_REPO and GITHUB_ACTIONS_TOKEN on the server.' });
    const result = await dispatchApprovedBuild(config);
    if (!result.dispatched) return res.status(502).json({ error: result.reason });
    logAudit(req.user, 'GLOBAL_GITHUB_BUILD_TRIGGERED', 'Repo:' + result.repo,
      { branch: result.branch }, req);
    return res.status(202).json({
      dispatched: true, repo: result.repo, branch: result.branch,
      status: 'WORKFLOW_DISPATCH_ACCEPTED',
      detail: 'GitHub accepted a main-branch workflow request; build/signing have not completed.'
    });
  });

// ---------------- GAP FULFILLMENT: PREDICTIVE ANALYTICS ----------------
app.get(['/api/v1/analytics/predictive', '/api/analytics/predictive'], async (req, res) => {
  const tenantId = req.user?.tenant_id;
  if (!tenantId) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  const agents = await db.getDevices({ tenant_id: tenantId });
  const analysis = await Promise.all(agents.map(async agent => {
    const history = await db.getTelemetryHistory(agent.id, 256);
    return analyzeMeasuredTelemetry(history, agent);
  }));

  res.json({
    summary: {
      total_hosts_registered: agents.length,
      total_hosts_analyzed: analysis.filter(a =>
        a.status === 'ANALYZED' || a.status === 'NO_DEPLETION_TREND').length,
      hosts_at_disk_risk: analysis.filter(a => a.projected_days_until_full && a.projected_days_until_full < 14).length,
      anomalous_hosts: analysis.filter(a => a.anomaly_score > 30).length
    },
    predictions: analysis
  });
});

// ---------------- GAP FULFILLMENT: AUTO-REMEDIATION ----------------
app.get(['/api/v1/remediation/policies', '/api/remediation/policies'], async (req, res) => {
  if (!req.user?.tenant_id) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  const [policies, logs] = await Promise.all([
    db.getTenantRemediationPolicies(req.user.tenant_id),
    db.getRemediationLogs(100, req.user.tenant_id)
  ]);
  return res.json({ policies, logs });
});

app.put(['/api/v1/remediation/policies/:id', '/api/remediation/policies/:id'], requireRole(['SUPER_ADMIN']), validateBody(updateRemediationPolicySchema), async (req, res) => {
  const tenantId = req.user?.tenant_id;
  if (!tenantId) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  const pol = await db.setTenantRemediationPolicyEnabled(tenantId, req.params.id, req.body.enabled);
  if (!pol) return res.status(404).json({ detail: 'Policy not found' });
  logAudit(req.user, 'TENANT_REMEDIATION_POLICY_UPDATED', 'Policy:' + pol.id,
    { enabled: pol.enabled }, req);
  return res.json({ ok: true, policy: pol });
});

app.post(['/api/v1/remediation/trigger', '/api/remediation/trigger'], requireRole(['SUPER_ADMIN', 'OPERATOR']), validateBody(remediationTriggerSchema), async (req, res) => {
  const { hostname, action_type } = req.body;
  const tenantId = req.user?.tenant_id;
  if (!tenantId) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  const device = await db.getDeviceByHostname(hostname);
  if (!belongsToCurrentTenant(req.user, device)) {
    return res.status(404).json({ error: 'Target agent/device not found' });
  }
  // Never convert an unrecognized, client-chosen action_type into a script name.
  const policy = await db.getTenantRemediationPolicyByActionType(tenantId, action_type);
  if (!policy) return res.status(400).json({ error: 'UNAPPROVED_REMEDIATION_ACTION' });
  if (!policy.enabled) return res.status(403).json({ error: 'REMEDIATION_POLICY_DISABLED' });

  const commandId = crypto.randomUUID();
  let queued = false;
  try {
    queued = await db.queueCommandInDb({
      id: commandId,
      device_id: device.id,
      agent_id: device.id,
      hostname: device.hostname,
      kind: 'run-script',
      command_type: 'run-script',
      payload: { script_name: 'Remediate-' + policy.action_type + '.ps1' },
      status: 'pending',
      dispatched_by: req.user?.username || 'admin'
    }, process.env.NODE_ENV === 'test' ? undefined :
      { tenantId, tokenHash: device.device_token_hash });
  } catch (error) {
    if (error.message === 'COMMAND_CREDENTIAL_CHANGED') {
      return res.status(409).json({ error: 'DEVICE_CREDENTIAL_NOT_ACTIVE' });
    }
  }
  if (!queued) return res.status(503).json({ error: 'COMMAND_QUEUE_UNAVAILABLE' });
  const action = 'Queued approved remediation: ' + policy.action_type;
  const log = await db.logRemediation({
    tenant_id: tenantId, hostname: device.hostname, policy_name: policy.name,
    action, status: 'pending'
  });
  logAudit(req.user, 'REMEDIATION_TRIGGERED', 'Device:' + device.hostname,
    { action_type: policy.action_type, policy_id: policy.id, command_id: commandId,
      status: 'pending' }, req);
  return res.json({ ok: true, log, command_id: commandId, status: 'pending' });
});

// ---------------- GAP FULFILLMENT: TICKETING INTEGRATION ----------------
app.get(['/api/v1/tickets/config', '/api/tickets/config'], async (req, res) => {
  if (!req.user?.tenant_id) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  return res.json(await db.getTenantTicketConfig(req.user.tenant_id));
});

app.put(['/api/v1/tickets/config', '/api/tickets/config'], requireRole(['SUPER_ADMIN']),
  validateBody(ticketConfigSchema), async (req, res) => {
    if (!req.user?.tenant_id) return res.status(403).json({ error: 'TENANT_REQUIRED' });
    const updated = await db.updateTenantTicketConfig(req.user.tenant_id, req.body);
    logAudit(req.user, 'TENANT_TICKET_CONFIG_UPDATED', `Tenant:${req.user.tenant_id}`,
      { changed_fields: Object.keys(req.body) }, req);
    return res.json({ ok: true, config: updated });
  });

app.get(['/api/v1/tickets', '/api/v1/tickets/list', '/api/tickets/list'], async (req, res) => {
  if (!req.user?.tenant_id) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  const tickets = await db.getTickets(req.user.tenant_id);
  sendPaginated(req, res, tickets, 50, 500);
});

app.post(['/api/v1/tickets', '/api/v1/tickets/create', '/api/tickets/create'], requireRole(['SUPER_ADMIN', 'OPERATOR']), validateBody(createTicketSchema), async (req, res) => {
  const { title, agent, severity, description } = req.body;
  if (!req.user?.tenant_id) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  const cfg = await db.getTenantTicketConfig(req.user.tenant_id);
  const newId = `${cfg.project || 'ITSUP'}-${crypto.randomUUID()}`;
  // This endpoint creates an internal helpdesk record only. It does not
  // contact Jira, ServiceNow or Zendesk, so never claim external sync.
  if (agent) {
    const target = await db.getDeviceByHostname(agent);
    if (!belongsToCurrentTenant(req.user, target)) {
      return res.status(404).json({ error: 'Target agent/device not found' });
    }
  }
  const ticket = {
    id: newId,
    tenant_id: req.user.tenant_id,
    system: 'internal',
    title: title || `Issue reported on ${agent || 'Host'}`,
    status: "Open",
    severity: severity || "Medium",
    agent: agent || ''
  };
  await db.createTicket(ticket);
  logAudit(req.user, "TICKET_CREATED", `Ticket:${newId}`, { title: ticket.title, severity: ticket.severity }, req);
  return res.json({ ok: true, ticket, external_sync: 'NOT_CONNECTED' });
});

// ---------------- GAP FULFILLMENT: CLOUD & HYBRID AUDIT ----------------
// No Microsoft Graph/OAuth transport is implemented. Environment variable
// presence alone is NOT proof of Azure AD, Intune or M365 connectivity.
app.get(['/api/v1/compliance/cloud-audit', '/api/compliance/cloud-audit'], async (req, res) => {
  if (!req.user?.tenant_id) return res.status(403).json({ error: 'TENANT_REQUIRED' });
  const agents = await db.getDevices({ tenant_id: req.user.tenant_id });
  const credentialsPresent = Boolean(process.env.AZURE_TENANT_ID && process.env.GRAPH_CLIENT_ID);
  const postures = agents.map(a => normalizeAgentPosture(a));
  return res.json({
    configured: false,
    status: 'NOT_CONNECTED',
    credentials_present: credentialsPresent,
    summary: {
      azure_ad_sync: 'Not connected',
      intune_enrolled_pct: 'N/A',
      m365_services_status: 'Not connected',
      bitlocker_compliant_pct: agentReportedCoverage(postures, 'bitlocker_encrypted'),
      defender_active_pct: agentReportedCoverage(postures, 'defender_realtime_on'),
      agent_reported_devices: postures.filter(p => p.evidence_status === 'AGENT_REPORTED').length,
      total_devices: agents.length
    },
    cloud_services: [],
    agent_compliance: agents.map((a, i) => ({
      hostname: a.hostname,
      azure_ad_joined: null,
      intune_managed: null,
      bitlocker_encrypted: postures[i].bitlocker_encrypted,
      antivirus_active: postures[i].antivirus_active,
      defender_realtime_on: postures[i].defender_realtime_on,
      firewall_active: postures[i].firewall_active,
      evidence_status: postures[i].evidence_status,
      posture_reported_at: postures[i].posture_reported_at,
      compliance_status: postures[i].compliance_status
    })),
    note: 'Only fresh (<24h) enrolled-agent observations are counted where the underlying field was reported. N/A means no current measured denominator. Microsoft Graph sync and cloud/MDM status are NOT_CONNECTED; no independent attestation.'
  });
});

// Serve portal static files
const portalPath = path.join(__dirname, 'Enterprise', 'portal');
app.use(express.static(portalPath));

app.get('*', (req, res) => {
  res.sendFile(path.join(portalPath, 'index.html'));
});

// Real production must not accept traffic before the persistent database is
// available. Test/dev fixtures retain their documented resilient fallback.
let serverInstance = null;
const runningUnderVitest = process.env.VITEST === 'true' || process.env.VITEST === '1';
if (!runningUnderVitest) {
  const isProduction = process.env.NODE_ENV !== 'test';
  if (isProduction) {
    const missing = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']
      .filter(name => !process.env[name] || !process.env[name].trim());
    if (missing.length) {
      console.error(`FATAL: Missing production database configuration: ${missing.join(', ')}`);
      process.exit(1);
    }
    try {
      const ready = await initDbPool();
      if (!ready || !isMysqlConnected()) {
        console.error('FATAL: Production MySQL did not become healthy. Refusing to open HTTP port.');
        process.exit(1);
      }
    } catch (err) {
      console.error('FATAL: Production MySQL startup failed:', err.message);
      process.exit(1);
    }
  }
  serverInstance = app.listen(PORT, '0.0.0.0', () => {
    console.log(`IT-Toolkit Enterprise Portal running on http://0.0.0.0:${PORT}`);
  });
  if (!isProduction) {
    await initDbPool().catch(e => {
      console.warn('Development database initialization note:', e.message);
    });
  }
  // Initialize scheduled hourly data retention & partition cleanup engine
  db.initRetentionScheduler(3600000);
  // Each PM2 worker may poll; DB-atomic leases enforce one owner per job.
  if (isProduction) startNotificationOutboxWorker();
}

export { app, serverInstance };
