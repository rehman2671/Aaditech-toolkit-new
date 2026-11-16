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
