import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import * as db from '../../db.js';
import {
  extractMeasurements, deviceMetricView, analyzeMeasuredTelemetry
} from '../../device-metrics.js';

const wasMode = process.env.NODE_ENV;
const now = Date.parse('2026-11-17T12:00:00.000Z');
const measuredDevice = {
  id: 'device-A', tenant_id: 'tenant-A', hostname: 'CORP-PC-01',
  telemetry_reported_at: new Date(now - 30_000),
  cpu_usage: '0.0%', memory_usage: '0.0%', disk_free: '0 GB',
  battery: '100% (AC)'
};
afterEach(() => {
  db.setConnectionStateForTesting(false, null);
  if (wasMode === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = wasMode;
});
const samples = (diskValues) => diskValues.map((disk, i) => ({
  recorded_at: new Date(now - (65 - i * 16) * 60_000),
  disk_free_gb: disk, cpu_pct: 12, ram_pct: 20
}));

describe('Stage N25 device metric provenance and non-synthetic predictions', () => {
  it('rejects imaginary default CPU/RAM/disk/battery when no agent evidence exists', () => {
    const record = {
      ...measuredDevice, telemetry_reported_at: null,
      cpu_usage: '15%', memory_usage: '45%', disk_free: '250 GB',
      battery: '100% (AC)'
    };
    expect(deviceMetricView(record, now)).toMatchObject({
      telemetry_status: 'UNVERIFIED', telemetry_source: null,
      cpu_usage: null, memory_usage: null, disk_free: null,
      disk_free_gb: null, battery: null
    });
  });

  it('accepts actual zero measurements and distinguishes each unknown field', () => {
    const row = deviceMetricView(measuredDevice, now);
    expect(row).toMatchObject({
      telemetry_status: 'AGENT_REPORTED', cpu_usage: '0.0%',
      memory_usage: '0.0%', disk_free: '0 GB', battery: null
    });
    expect(deviceMetricView({ ...measuredDevice, memory_usage: null }, now).memory_usage).toBeNull();
    expect(deviceMetricView({ ...measuredDevice, disk_free: 'INVALID' }, now).disk_free).toBeNull();
    expect(deviceMetricView({ ...measuredDevice, cpu_usage: '200%' }, now).cpu_usage).toBeNull();
  });

  it('expires after fifteen minutes and rejects future provenance', () => {
    expect(deviceMetricView({ ...measuredDevice,
      telemetry_reported_at: new Date(now - 16 * 60_000) }, now).telemetry_status).toBe('STALE');
    expect(deviceMetricView({ ...measuredDevice,
      telemetry_reported_at: new Date(now + 1000) }, now).cpu_usage).toBeNull();
  });

  it('only accepts finite numbers in valid ranges, with no invented fallback 0 or 24ms', () => {
    expect(extractMeasurements({ cpu: { utilization_pct: 0 },
      ram: { utilization_pct: null }, disk: { free_gb: 0 } })).toEqual({
      cpu: 0, ram: null, disk: 0, latency: null
    });
    expect(extractMeasurements({ cpu: { utilization_pct: '85' },
      ram: { utilization_pct: 108 }, disk: { free_gb: -1 },
      network: { latency_ms: -1 } })).toEqual({
      cpu: null, ram: null, disk: null, latency: null
    });
    expect(extractMeasurements({}, 0).disk).toBe(0);
    expect(extractMeasurements({}, '256').disk).toBeNull();
  });

  it('does not claim a disk forecast when history is sparse, stale or flat', () => {
    const device = { ...measuredDevice,
      disk_free: '100 GB', cpu_usage: '20%', memory_usage: '50%' };
    expect(analyzeMeasuredTelemetry([], device, now)).toMatchObject({
      status: 'INSUFFICIENT_DATA', projected_days_until_full: null,
      anomaly_score: null, disk_free_gb: 100
    });
    expect(analyzeMeasuredTelemetry(samples([110, 108, 106]), device, now)
      .projected_days_until_full).toBeNull();
    const stable = analyzeMeasuredTelemetry(samples([100, 101, 102, 103, 105]), device, now);
    expect(stable.status).toBe('NO_DEPLETION_TREND');
    expect(stable.projected_days_until_full).toBeNull();
    expect(stable.daily_growth_gb).toBe(0);
    expect(analyzeMeasuredTelemetry(samples([110, 108, 106, 103, 100]),
      { ...device, telemetry_reported_at: null }, now).status).toBe('INSUFFICIENT_DATA');
  });

  it('analyzes only five truly measured samples across an hour with positive depletion', () => {
    const device = { ...measuredDevice,
      disk_free: '100 GB', cpu_usage: '99%', memory_usage: '90%' };
    const r = analyzeMeasuredTelemetry(samples([110, 107, 105, 102, 100]), device, now);
    expect(r).toMatchObject({ status: 'ANALYZED', sample_count: 5,
      disk_free_gb: 100, cpu_usage_pct: 99, memory_usage_pct: 90 });
    expect(r.projected_days_until_full).toBeGreaterThan(0);
    expect(r.daily_growth_gb).toBeLessThan(0);
    expect(r.anomaly_score).toBeGreaterThanOrEqual(70);
  });

  it('SQL-backed enrollment writes NULL measurements and capacities', async () => {
    process.env.NODE_ENV = 'production';
    const statements = [];
    db.setConnectionStateForTesting(true, {
      query: async (sql, params = []) => {
        statements.push({ sql, params });
        return [{ affectedRows: 1, insertId: 3 }, []];
      }
    });
    expect(await db.syncDeviceToDb({ id: 'device-unique-25', hostname: 'LAPTOP-25',
      tenant_id: 'tenant-A', company_id: 1, device_uid: 'uid-25' })).toBe(true);
    const sql = statements.find(x => x.sql.includes('INSERT INTO devices'));
    expect(sql.params.slice(10, 17)).toEqual([null, null, null, null, null, null, null]);
    expect(sql.sql).toContain('disk_free_gb = COALESCE(VALUES(disk_free_gb), disk_free_gb)');
  });

  it('production device formatting never exports legacy 15%/45%/250 GB without evidence', async () => {
    process.env.NODE_ENV = 'production';
    const queries = [];
    db.setConnectionStateForTesting(true, {
      query: async (sql, params = []) => {
        queries.push({ sql, params });
        return [[{ id: 'device-prod', tenant_id: 'tenant-A',
          hostname: 'CORP-OLD', cpu_usage: '15%', memory_usage: '45%',
          disk_free: '250 GB', battery: '100% (AC)', telemetry_reported_at: null }], []];
      }
    });
    const dev = await db.getDeviceById('device-prod');
    expect(dev.cpu_usage).toBeNull();
    expect(dev.memory_usage).toBeNull();
    expect(dev.disk_free).toBeNull();
    expect(dev.battery).toBeNull();
    expect(queries[0].sql).toContain('WHERE id = ?');
  });

  it('MySQL telemetry inserts null missing samples rather than fake zero values', async () => {
    process.env.NODE_ENV = 'production';
    const statements = [];
    db.setConnectionStateForTesting(true, {
      query: async (sql, params = []) => {
        statements.push({ sql, params }); return [{ affectedRows: 1 }, []];
      }
    });
    expect(await db.insertTelemetryBatch([
      { device_id: 'device-prod', metrics: {
        cpu: { utilization_pct: 0 }, ram: { utilization_pct: null },
        disk: { free_gb: 0 }
      } }
    ])).toBe(1);
    const insert = statements.find(q => q.sql.includes('INSERT INTO telemetry_history'));
    expect(insert).toBeDefined();
    expect(insert.params[0][0].slice(0, 5)).toEqual(['device-prod', 0, null, 0, null]);
  });

  it('keeps legacy history but marks it untrusted in migration 012', () => {
    const text = fs.readFileSync(new URL(
      '../../database/migrations/012_measured_device_telemetry.sql', import.meta.url), 'utf8');
    expect(text).toContain('telemetry_reported_at DATETIME(3) NULL');
    expect(text).toContain('MODIFY COLUMN cpu_usage VARCHAR(32) NULL DEFAULT NULL');
    expect(text).toContain('MODIFY COLUMN cpu_pct FLOAT NULL DEFAULT NULL');
    expect(text).not.toMatch(/UPDATE devices SET/i);
  });

  it('portal never enables cleanup on a null prediction, and returns no fake inventories', () => {
    const ui = fs.readFileSync(new URL('../../Enterprise/portal/index.html', import.meta.url), 'utf8');
    const server = fs.readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
    expect(ui).toContain("typeof p.projected_days_until_full === 'number'");
    expect(ui).toContain('No valid forecast');
    expect(server).toContain("source: 'NOT_REPORTED', total_processes: 0, processes: []");
    expect(server).toContain("source: 'NOT_REPORTED', app_usage: []");
    expect(server).not.toContain('Baseline process inventory until first agent check-in');
  });
});
