#!/usr/bin/env node
// Disposable CI-only MySQL 8 acceptance/decline/expiry/concurrent replay.
// Refuses production/customer databases, does not create real credentials.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import * as db from './db.js';

if (process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.AADITECH_WORKSPACE_REHEARSAL !== 'isolated-ci' ||
    process.env.NODE_ENV !== 'test' ||
    process.env.DB_NAME !== 'it_toolkit') {
  throw new Error('Workspace acceptance rehearsal restricted to isolated CI MySQL');
}
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 3
});
const primaryTenant = '00000000-0000-0000-0000-000000000001';
const destinationTenant = crypto.randomUUID();
const rand = crypto.randomBytes(6).toString('hex');
const username = 'ci_inv_' + rand;
let userId = null;
try {
  await pool.query(
    'INSERT INTO tenants (id, name, slug, status) VALUES (?, ?, ?, ?)',
    [destinationTenant, 'CI Invitation Workspace', 'ci-invite-' + rand, 'active']
  );
  const [created] = await pool.query(
    'INSERT INTO users (tenant_id, company_id, username, email, password_hash, role, active, status) ' +
      'VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
    [primaryTenant, 1, username, username + '@example.invalid',
      'ci-unusable-password-hash', 'MONITORING', 'ACTIVE']
  );
  userId = created.insertId;
  db.setConnectionStateForTesting(true, pool);

  const invited = await db.grantWorkspaceMembership(
    userId, destinationTenant, 'OPERATOR', 1);
  assert.equal(invited.status, 'INVITED');
  assert.equal(await db.getActiveWorkspaceMembership(userId, destinationTenant), null);
  const listBefore = await db.listUserWorkspaces(userId);
  assert.equal(listBefore.some(x => x.tenant_id === destinationTenant), false);
  const pending = await db.listWorkspaceInvitations(userId);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].tenant_id, destinationTenant);
  assert.equal(await db.respondWorkspaceInvitation(userId, destinationTenant, 'accept'), true);
  assert.equal(await db.respondWorkspaceInvitation(userId, destinationTenant, 'accept'), false);
  assert.equal((await db.getActiveWorkspaceMembership(userId, destinationTenant)).role, 'OPERATOR');
  assert.equal((await db.listUserWorkspaces(userId)).some(x =>
    x.tenant_id === destinationTenant), true);

  // Re-inviting an ACTIVE member may not silently change role to SUPER_ADMIN.
  const race = await db.grantWorkspaceMembership(userId, destinationTenant, 'SUPER_ADMIN', 1);
  assert.equal(race.status, 'ACTIVE');
  assert.equal(race.role, 'OPERATOR');
  assert.equal(await db.revokeWorkspaceMembership(userId, destinationTenant), true);
  assert.equal(await db.getActiveWorkspaceMembership(userId, destinationTenant), null);

  await db.grantWorkspaceMembership(userId, destinationTenant, 'OPERATOR', 1);
  await pool.query(
    'UPDATE user_workspace_memberships SET updated_at = DATE_SUB(NOW(3), INTERVAL 8 DAY) ' +
      'WHERE user_id = ? AND tenant_id = ?',
    [userId, destinationTenant]
  );
  assert.equal((await db.listWorkspaceInvitations(userId)).length, 0);
  assert.equal(await db.respondWorkspaceInvitation(userId, destinationTenant, 'accept'), false);

  await db.grantWorkspaceMembership(userId, destinationTenant, 'MONITORING', 1);
  assert.equal(await db.respondWorkspaceInvitation(userId, destinationTenant, 'decline'), true);
  assert.equal(await db.respondWorkspaceInvitation(userId, destinationTenant, 'accept'), false);

  const tickets = await db.getTenantTicketConfig(destinationTenant);
  assert.equal(tickets.url, '');
  assert.equal(tickets.auto_create_on_critical, false);
  await db.updateTenantTicketConfig(destinationTenant, { project: 'CI-ONLY' });
  assert.equal((await db.getTenantTicketConfig(destinationTenant)).project, 'CI-ONLY');
  assert.notEqual((await db.getTenantTicketConfig(primaryTenant)).project, 'CI-ONLY');

  console.log('[PASS] Live isolated MySQL invitation consent, replay, role, expiry, revoke and tenant config.');
} finally {
  db.setConnectionStateForTesting(false, null);
  if (userId) {
    await pool.query('DELETE FROM user_workspace_memberships WHERE user_id = ?', [userId]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id = ?', [userId]).catch(() => {});
  }
  await pool.query('DELETE FROM system_settings WHERE setting_key = ?', [
    'tenant:' + destinationTenant + ':ticketConfig']).catch(() => {});
  await pool.query('DELETE FROM tenants WHERE id = ?', [destinationTenant]).catch(() => {});
  await pool.end();
}
