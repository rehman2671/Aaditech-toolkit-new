import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../../server.js';

const primary = '00000000-0000-0000-0000-000000000001';
const foreign = '00000000-0000-0000-0000-000000000002';

describe('Phase N13 membership-enforced workspace API', () => {
  let admin = '';
  let operator = '';
  beforeAll(async () => {
    const a = await request(app).post('/api/login')
      .send({ username: 'admin', password: 'Admin123!' });
    const o = await request(app).post('/api/login')
      .send({ username: 'ops_lead', password: 'Operator123!' });
    expect(a.status).toBe(200);
    expect(o.status).toBe(200);
    admin = a.body.token;
    operator = o.body.token;
  });

  it('lists only authorized primary workspace and never enumerates foreign tenants', async () => {
    for (const endpoint of ['/api/v1/workspaces', '/api/v1/tenants']) {
      const res = await request(app).get(endpoint)
        .set('Authorization', `Bearer ${admin}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.some(x => x.tenant_id === primary)).toBe(true);
      expect(res.body.some(x => x.tenant_id === foreign)).toBe(false);
    }
  });

  it('rejects client-chosen unowned workspace and forged escalation fields', async () => {
    const denied = await request(app).post('/api/v1/workspaces/select')
      .set('Authorization', `Bearer ${admin}`)
      .send({ tenant_id: foreign });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe('WORKSPACE_MEMBERSHIP_REQUIRED');

    const forged = await request(app).post('/api/v1/workspaces/select')
      .set('Authorization', `Bearer ${admin}`)
      .send({ tenant_id: primary, role: 'SUPER_ADMIN' });
    expect(forged.status).toBe(400);
  });

  it('switches only to an authorized workspace and rotates the session JWT', async () => {
    const changed = await request(app).post('/api/v1/workspaces/select')
      .set('Authorization', `Bearer ${admin}`)
      .send({ tenant_id: primary });
    expect(changed.status).toBe(200);
    expect(changed.body.workspace).toMatchObject({
      tenant_id: primary, primary: true, role: 'SUPER_ADMIN'
    });
    const claims = jwt.verify(changed.body.token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    expect(claims.tenant_id).toBe(primary);
    expect(claims.jti).toBeTruthy();
    const me = await request(app).get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${changed.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.tenant_id).toBe(primary);
  });

  it('requires destination tenant superadmin for grants and refuses primary-role changes', async () => {
    const noAdmin = await request(app).post('/api/v1/workspaces/memberships')
      .set('Authorization', `Bearer ${operator}`)
      .send({ user_id: 3, role: 'OPERATOR' });
    expect(noAdmin.status).toBe(403);
    const forged = await request(app).post('/api/v1/workspaces/memberships')
      .set('Authorization', `Bearer ${admin}`)
      .send({ user_id: 3, role: 'OPERATOR', tenant_id: foreign });
    expect(forged.status).toBe(400);
    const primaryChange = await request(app).post('/api/v1/workspaces/memberships')
      .set('Authorization', `Bearer ${admin}`)
      .send({ user_id: 3, role: 'SUPER_ADMIN' });
    expect(primaryChange.status).toBe(409);
  });

  it('only the invited account can inspect pending consent invitations', async () => {
    const unauthorized = await request(app).get('/api/v1/workspaces/invitations');
    expect(unauthorized.status).toBe(401);
    const own = await request(app).get('/api/v1/workspaces/invitations')
      .set('Authorization', `Bearer ${operator}`);
    expect(own.status).toBe(200);
    expect(Array.isArray(own.body)).toBe(true);
  });

  it('rejects nonexistent or unapproved invitation activation', async () => {
    const unauthorized = await request(app)
      .post(`/api/v1/workspaces/invitations/${foreign}/accept`);
    expect(unauthorized.status).toBe(401);
    const noInvite = await request(app)
      .post(`/api/v1/workspaces/invitations/${foreign}/accept`)
      .set('Authorization', `Bearer ${operator}`);
    expect(noInvite.status).toBe(409);
    const invalid = await request(app)
      .post('/api/v1/workspaces/invitations/not-a-tenant/accept')
      .set('Authorization', `Bearer ${operator}`);
    expect(invalid.status).toBe(400);
  });

  it('allows only tenant SUPER_ADMIN to edit own branding and ticket config', async () => {
    const current = await request(app).get('/api/v1/workspaces/branding')
      .set('Authorization', `Bearer ${operator}`);
    expect(current.status).toBe(200);
    const denied = await request(app).put('/api/v1/workspaces/branding')
      .set('Authorization', `Bearer ${operator}`)
      .send({ logo_text: 'Unauthorized' });
    expect(denied.status).toBe(403);
    const injected = await request(app).put('/api/v1/workspaces/branding')
      .set('Authorization', `Bearer ${admin}`)
      .send({ color: '#123456', tenant_id: foreign });
    expect(injected.status).toBe(400);
    const updated = await request(app).put('/api/v1/workspaces/branding')
      .set('Authorization', `Bearer ${admin}`)
      .send({ logo_text: 'Primary Business' });
    expect(updated.status).toBe(200);
    expect(updated.body.logo_text).toBe('Primary Business');
    const ticketDenied = await request(app).put('/api/v1/tickets/config')
      .set('Authorization', `Bearer ${operator}`)
      .send({ project: 'INTRUDER' });
    expect(ticketDenied.status).toBe(403);
    const ticketConfig = await request(app).get('/api/v1/tickets/config')
      .set('Authorization', `Bearer ${operator}`);
    expect(ticketConfig.status).toBe(200);
    expect(ticketConfig.body).not.toHaveProperty('tenant_id');
  });

  it('requires workspace SUPER_ADMIN for email consent and rejects tenant override', async () => {
    const denied = await request(app).put('/api/v1/alerts/email')
      .set('Authorization', `Bearer ${operator}`)
      .send({ enabled: true, recipient: 'x@example.com' });
    expect(denied.status).toBe(403);
    const invalid = await request(app).put('/api/v1/alerts/email')
      .set('Authorization', `Bearer ${admin}`)
      .send({ enabled: false, tenant_id: foreign, recipient: 'x@example.com' });
    expect(invalid.status).toBe(400);
    const initial = await request(app).get('/api/v1/alerts/email')
      .set('Authorization', `Bearer ${admin}`);
    expect(initial.status).toBe(200);
    expect(initial.body).toMatchObject({ enabled: false, recipient: '', smtp_configured: false });
    const blocked = await request(app).post('/api/v1/alerts/test-email')
      .set('Authorization', `Bearer ${admin}`);
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toBe('NOT_CONFIGURED');
  });

  it('does not allow operators to change global settings', async () => {
    const attempts = [
      request(app).post('/api/v1/settings/retention/run'),
      request(app).put('/api/v1/features/bitlocker').send({ enabled: false }),
      request(app).get('/api/v1/alerts/webhook')
    ];
    for (const attempt of attempts) {
      const res = await attempt.set('Authorization', `Bearer ${operator}`);
      expect(res.status).toBe(403);
    }
    const webhook = await request(app).get('/api/v1/alerts/webhook')
      .set('Authorization', `Bearer ${admin}`);
    expect(webhook.status).toBe(200);
    expect(webhook.body).not.toHaveProperty('token');
  });
});
