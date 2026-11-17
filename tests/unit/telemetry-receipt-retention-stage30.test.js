import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import * as db from '../../db.js';
import { batchReceiptMaintenanceSchema } from '../../validation.js';

afterEach(() => db.setConnectionStateForTesting(false, null));
describe('N30 protected telemetry receipt retention', () => {
  it('defaults to read-only preview with strict hard bounds', () => {
    expect(batchReceiptMaintenanceSchema.parse({})).toEqual({
      dry_run: true, min_age_days: 180, max_rows: 100
    });
    expect(batchReceiptMaintenanceSchema.safeParse({
      dry_run: false, confirm: 'PURGE_DECOMMISSIONED_BATCH_RECEIPTS',
      min_age_days: 365, max_rows: 2
    }).success).toBe(true);
    for (const input of [
      { dry_run: false }, { dry_run: false, confirm: 'WRONG' },
      { min_age_days: 179 }, { min_age_days: 3651 }, { max_rows: 0 },
      { max_rows: 501 }, { dry_run: 'false' }, { confirm: null },
      { unrecognized: 1 }
    ]) {
      expect(batchReceiptMaintenanceSchema.safeParse(input).success).toBe(false);
    }
  });
  it('does not report a successful durable purge on MySQL fallback', async () => {
    db.setConnectionStateForTesting(false, null);
    await expect(db.maintainTelemetryBatchReceipts()).rejects.toThrow('TELEMETRY_BATCH_MYSQL_REQUIRED');
  });
  it('runs an actual bounded SQL preview and confirmed orphan deletion, never touching owners', async () => {
    const statements = [];
    db.setConnectionStateForTesting(true, {
      query: async (sql, params=[]) => {
        statements.push({sql, params});
        if (sql.startsWith('SELECT COUNT(*) AS n FROM telemetry_batches')) {
          return [[{n:3}], []];
        }
        if (sql.startsWith('DELETE FROM telemetry_batches')) {
          return [{affectedRows:2}, []];
        }
        throw new Error('Unexpected maintenance SQL: ' + sql);
      }
    });
    const preview = await db.maintainTelemetryBatchReceipts();
    expect(preview).toMatchObject({
      status:'DRY_RUN', min_age_days:180, max_rows:100, eligible:3,
      deleted:0, active_receipts_preserved:true, auto_pruning_enabled:false
    });
    expect(statements).toHaveLength(1);
    expect(statements[0].sql).toContain('NOT EXISTS (SELECT 1 FROM tenants t');
    expect(statements[0].sql).toContain('NOT EXISTS (SELECT 1 FROM devices d');
    expect(statements[0].params).toEqual([180]);
    await expect(db.maintainTelemetryBatchReceipts({
      dryRun: false, confirm: 'not-confirmed'
    })).rejects.toThrow('TELEMETRY_BATCH_MAINTENANCE_CONFIRMATION_REQUIRED');
    await expect(db.maintainTelemetryBatchReceipts({
      dryRun: false, limit: 501, confirm: 'PURGE_DECOMMISSIONED_BATCH_RECEIPTS'
    })).rejects.toThrow('TELEMETRY_BATCH_MAINTENANCE_BOUNDS');
    const purge = await db.maintainTelemetryBatchReceipts({
      dryRun:false, minAgeDays:365, limit:2,
      confirm:'PURGE_DECOMMISSIONED_BATCH_RECEIPTS'
    });
    expect(purge).toMatchObject({
      status:'PURGED_DECOMMISSIONED_ONLY', eligible:3, deleted:2,
      min_age_days:365, max_rows:2
    });
    expect(statements).toHaveLength(3);
    expect(statements[2].sql).toContain('ORDER BY recorded_at ASC LIMIT ?');
    expect(statements[2].params).toEqual([365,2]);
    expect(statements[2].sql).toContain('NOT EXISTS (SELECT 1 FROM devices d');
  });
  it('Windows MSI upgrade test actually reads persistent SQLite contents', () => {
    const script = fs.readFileSync(new URL('../../Enterprise/tests/Test-Windows-MsiUpgrade.ps1', import.meta.url), 'utf8');
    expect(script).toContain('IT-Toolkit\\sqlite3.exe');
    expect(script).toContain('queue.sqlite3');
    expect(script).toContain('pragma_integrity_check');
    expect(script).toContain('Assert-QueueBeforeAndAfterUpgrade');
    expect(script).toContain("'before major upgrade'");
    expect(script).toContain("'after major upgrade'");
    expect(script).toContain('[int]$state.pending -ne 2');
    expect(script).toContain('$state.body -cne $body');
  });
  it('does not permit ordinary telemetry retention to remove active receipts', () => {
    const source = fs.readFileSync(new URL('../../db.js', import.meta.url), 'utf8');
    expect(source).toContain('auto_pruning_enabled: false');
    expect(source).toContain('NOT EXISTS (SELECT 1 FROM tenants t');
    expect(source).toContain('NOT EXISTS (SELECT 1 FROM devices d');
    expect(source).toContain('TELEMETRY_BATCH_MAINTENANCE_CONFIRMATION_REQUIRED');
  });
});
