import { describe, it, expect, afterEach } from 'vitest';
import * as db from '../../db.js';

const user = 91;
const tenant = '00000000-0000-0000-0000-000000000091';
afterEach(() => db.setConnectionStateForTesting(false, null));

describe('Stage 14 invited-account consent and seven-day expiration', () => {
  it('offers only current-account pending invitations from active tenants', async () => {
    const queries = [];
    db.setConnectionStateForTesting(true, { query: async (sql, params) => {
      queries.push({ sql, params });
      return [[{ tenant_id: tenant, role: 'MONITORING',
        status: 'INVITED', tenant_name: 'Tenant 91' }], []];
    }});
    const invitations = await db.listWorkspaceInvitations(user);
    expect(invitations).toHaveLength(1);
    expect(queries[0].params).toEqual([user]);
    expect(queries[0].sql).toContain("m.status = 'INVITED'");
    expect(queries[0].sql).toContain('INTERVAL 7 DAY');
    expect(queries[0].sql).toContain("UPPER(t.status) = 'ACTIVE'");
    expect(queries[0].sql).toContain('INNER JOIN users u ON u.id = m.user_id');
  });

  it('atomically activates only the invited user with an unexpired invite', async () => {
    const queries = [];
    db.setConnectionStateForTesting(true, { query: async (sql, params) => {
      queries.push({ sql, params });
      return [{ affectedRows: 1 }, []];
    }});
    expect(await db.respondWorkspaceInvitation(user, tenant, 'accept')).toBe(true);
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain("m.status = 'INVITED'");
    expect(queries[0].sql).toContain('DATE_SUB(NOW(3), INTERVAL 7 DAY)');
    expect(queries[0].sql).toContain('INNER JOIN tenants t ON t.id = m.tenant_id');
    expect(queries[0].params).toEqual(['ACTIVE', user, tenant]);
  });

  it('refuses a stale/revoked/double-consumed invitation with no affected rows', async () => {
    db.setConnectionStateForTesting(true, {
      query: async () => [{ affectedRows: 0 }, []]
    });
    expect(await db.respondWorkspaceInvitation(user, tenant, 'accept')).toBe(false);
    expect(await db.respondWorkspaceInvitation(user, tenant, 'decline')).toBe(false);
  });

  it('requires exact accept/decline decisions and nonempty user and tenant keys', async () => {
    await expect(db.respondWorkspaceInvitation(user, tenant, 'activate')).rejects.toThrow();
    await expect(db.respondWorkspaceInvitation(null, tenant, 'accept')).rejects.toThrow();
    await expect(db.respondWorkspaceInvitation(user, null, 'accept')).rejects.toThrow();
  });

  it('prevents concurrent invitation replay from overwriting already ACTIVE membership', async () => {
    const q = [];
    db.setConnectionStateForTesting(true, {
      query: async (sql, params) => {
        q.push({ sql, params });
        if (sql.includes('SELECT user_id, tenant_id, role, status'))
          return [[{ user_id: user, tenant_id: tenant, status: 'ACTIVE', role: 'OPERATOR' }], []];
        return [{ affectedRows: 0 }, []];
      }
    });
    const existing = await db.grantWorkspaceMembership(user, tenant, 'SUPER_ADMIN', 7);
    expect(existing.status).toBe('ACTIVE');
    expect(existing.role).toBe('OPERATOR');
    expect(q[0].sql).toContain("role=IF(status='ACTIVE', role, VALUES(role))");
  });
});
