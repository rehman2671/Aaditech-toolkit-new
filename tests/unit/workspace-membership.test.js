import { describe, it, expect, afterEach } from 'vitest';
import { resolveVerifiedUserPrincipal } from '../../auth-principal.js';
import * as db from '../../db.js';
import { workspaceGrantSchema, workspaceSelectSchema } from '../../validation.js';

const normalize = role => String(role || '').toUpperCase();
const primary = '00000000-0000-0000-0000-000000000001';
const secondary = '00000000-0000-0000-0000-000000000002';
const user = { id: 81, username: 'workspace-user', email: 'member@example.org',
  tenant_id: primary, role: 'MONITORING', active: true, status: 'ACTIVE' };
const secondaryClaims = { id: 81, username: 'workspace-user', tenant_id: secondary,
  role: 'OPERATOR', jti: 'new-secondary-jti' };
const member = { user_id: 81, tenant_id: secondary, status: 'ACTIVE', role: 'OPERATOR' };

afterEach(() => db.setConnectionStateForTesting(false, null));

describe('Phase N13 workspace membership security', () => {
  it('requires active membership for a signed secondary-workspace JWT', () => {
    expect(resolveVerifiedUserPrincipal(secondaryClaims, user, normalize, true)).toBeNull();
    expect(resolveVerifiedUserPrincipal(secondaryClaims, user, normalize, true,
      member)).toMatchObject({ tenant_id: secondary, role: 'OPERATOR', id: 81 });
    for (const invalid of [
      { ...member, status: 'REVOKED' },
      { ...member, role: 'MONITORING' },
      { ...member, tenant_id: primary },
      { ...member, user_id: 82 }
    ]) {
      expect(resolveVerifiedUserPrincipal(secondaryClaims, user, normalize, true,
        invalid)).toBeNull();
    }
  });
  it('does not let an extra membership override a primary workspace role', () => {
    const claims = { ...secondaryClaims, tenant_id: primary, role: 'SUPER_ADMIN' };
    expect(resolveVerifiedUserPrincipal(claims, user, normalize, true,
      { ...member, tenant_id: primary, role: 'SUPER_ADMIN' })).toBeNull();
    expect(resolveVerifiedUserPrincipal({ ...claims, role: 'MONITORING' },
      user, normalize, true)).toMatchObject({ role: 'MONITORING', tenant_id: primary });
  });
  it('validates explicit workspace selection and tenant-inferred grants', () => {
    expect(workspaceSelectSchema.safeParse({ tenant_id: secondary }).success).toBe(true);
    expect(workspaceSelectSchema.safeParse({ tenant_id: secondary, role: 'SUPER_ADMIN' }).success).toBe(false);
    expect(workspaceSelectSchema.safeParse({ tenant_id: '../escape' }).success).toBe(false);
    expect(workspaceGrantSchema.safeParse({ user_id: 81, role: 'OPERATOR' }).success).toBe(true);
    expect(workspaceGrantSchema.safeParse({ user_id: 81, role: 'SUPER_ADMIN',
      tenant_id: primary }).success).toBe(false);
  });
  it('loads only active memberships and lists only primary plus approved secondary', async () => {
    const queries = [];
    db.setConnectionStateForTesting(true, {
      query: async (sql, params) => {
        queries.push({ sql, params });
        if (sql.includes('FROM users WHERE id')) return [[user], []];
        if (sql.includes('FROM tenants WHERE id')) {
          return [[{ id: primary, name: 'Primary', slug: 'primary', status: 'active' }], []];
        }
        if (sql.includes('FROM user_workspace_memberships')) return [[
          { ...member, tenant_name: 'Secondary', tenant_slug: 'secondary' }
        ], []];
        return [[], []];
      }
    });
    const workspaces = await db.listUserWorkspaces(user.id);
    expect(workspaces).toHaveLength(2);
    expect(workspaces[0]).toMatchObject({ tenant_id: primary,
      role: 'MONITORING', primary: true });
    expect(workspaces[1]).toMatchObject({ tenant_id: secondary,
      role: 'OPERATOR', primary: false });
    const active = await db.getActiveWorkspaceMembership(user.id, secondary);
    expect(active.tenant_id).toBe(secondary);
    expect(queries.some(q => q.sql.includes("UPPER(m.status) = 'ACTIVE'") &&
      q.sql.includes("UPPER(t.status) = 'ACTIVE'"))).toBe(true);
    expect(queries.filter(q => q.sql.includes('FROM user_workspace_memberships'))
      .every(q => q.params[0] === user.id)).toBe(true);
  });
  it('stores a pending consent invitation, never immediately activating membership', async () => {
    const queries = [];
    db.setConnectionStateForTesting(true, {
      query: async (sql, params) => {
        queries.push({ sql, params });
        if (sql.includes('SELECT user_id, tenant_id, role, status')) {
          return [[{ user_id: user.id, tenant_id: secondary,
            role: 'OPERATOR', status: 'INVITED' }], []];
        }
        return [{ affectedRows: 1 }, []];
      }
    });
    const invite = await db.grantWorkspaceMembership(user.id, secondary, 'OPERATOR', 9);
    expect(invite.status).toBe('INVITED');
    expect(queries[0].sql).toContain("VALUES (?, ?, ?, 'INVITED', ?)");
    expect(queries[0].sql).toContain("IF(status='ACTIVE', status, 'INVITED')");
    expect(queries[0].params).toEqual([user.id, secondary, 'OPERATOR', 9]);
    expect(await db.revokeWorkspaceMembership(user.id, secondary)).toBe(true);
    expect(queries[2].sql).toContain("status='REVOKED'");
    expect(queries[2].params).toEqual([user.id, secondary]);
  });
});
