import { describe, it, expect, vi } from 'vitest';

describe('syncDeviceProcesses Transactional Atomicity & Cache Consistency', () => {
  it('does not mutate memProcesses when MySQL transaction fails mid-way (after DELETE, before INSERT)', async () => {
    // Set up mock pool and connection
    const mockBeginTransaction = vi.fn().mockResolvedValue(undefined);
    const mockCommit = vi.fn().mockResolvedValue(undefined);
    const mockRollback = vi.fn().mockResolvedValue(undefined);
    const mockRelease = vi.fn().mockResolvedValue(undefined);

    let queryCallCount = 0;
    const mockQuery = vi.fn().mockImplementation((sql) => {
      queryCallCount++;
      const sqlStr = String(sql).toUpperCase();
      if (sqlStr.includes('DELETE FROM DEVICE_PROCESSES')) {
        // DELETE succeeds
        return Promise.resolve([{ affectedRows: 2 }]);
      }
      if (sqlStr.includes('INSERT INTO DEVICE_PROCESSES')) {
        // Crash/rejection injected between DELETE and INSERT
        return Promise.reject(new Error('Simulated mid-transaction crash on INSERT'));
      }
      return Promise.resolve([[]]);
    });

    const mockConn = {
      beginTransaction: mockBeginTransaction,
      query: mockQuery,
      commit: mockCommit,
      rollback: mockRollback,
      release: mockRelease
    };

    const mockPool = {
      getConnection: vi.fn().mockResolvedValue(mockConn),
      query: mockQuery
    };

    vi.doMock('mysql2/promise', () => ({
      default: {
        createPool: vi.fn(() => mockPool)
      }
    }));

    const db = await import('../../db.js');

    // Seed initial state in fallback mode
    const testDeviceId = 'test-dev-tx-desync-42';
    const initialProcesses = [
      { pid: 100, name: 'original_proc.exe', cpu_pct: 1.0, ram_mb: 50.0 }
    ];

    // Seed initial state
    await db.syncDeviceProcesses(testDeviceId, initialProcesses);
    const beforeState = db.getMemProcesses().filter(p => p.device_id === testDeviceId);
    expect(beforeState.length).toBe(1);
    expect(beforeState[0].name).toBe('original_proc.exe');

    // Reconnect simulated pool
    db.setConnectionStateForTesting?.(true, mockPool);

    // Attempt to sync new processes that will fail mid-transaction
    const newProcesses = [
      { pid: 200, name: 'poison_proc.exe', cpu_pct: 99.0, ram_mb: 200.0 }
    ];

    const result = await db.syncDeviceProcesses(testDeviceId, newProcesses);

    // Assert transaction failed and rolled back
    expect(result).toBe(false);
    expect(mockBeginTransaction).toHaveBeenCalled();
    expect(mockRollback).toHaveBeenCalled();
    expect(mockCommit).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalled();

    // CRITICAL AUDIT ASSERTION: memProcesses MUST NOT be mutated or desynced
    const afterState = db.getMemProcesses().filter(p => p.device_id === testDeviceId);
    expect(afterState.length).toBe(1);
    expect(afterState[0].name).toBe('original_proc.exe');
    expect(afterState[0].pid).toBe(100);
  });
});
