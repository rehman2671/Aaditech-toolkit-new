import { describe, it, expect, vi } from 'vitest';
import * as val from '../../validation.js';

describe('Validation Subsystem (validation.js) Unit Test Suite', () => {
  describe('1. Middleware: validateBody', () => {
    it('passes when payload is valid according to schema', () => {
      const middleware = val.validateBody(val.loginSchema);
      const req = { body: { username: 'admin', password: 'password123' } };
      const res = {};
      const next = vi.fn();

      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.validatedBody).toBeDefined();
    });

    it('returns 400 with field errors on invalid payload', () => {
      const middleware = val.validateBody(val.loginSchema);
      const req = { body: {} };
      let statusCode = 0;
      let jsonPayload = null;

      const res = {
        status: (code) => {
          statusCode = code;
          return res;
        },
        json: (data) => {
          jsonPayload = data;
          return res;
        }
      };
      const next = vi.fn();

      middleware(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(statusCode).toBe(400);
      expect(jsonPayload.errors).toBeDefined();
      expect(jsonPayload.error).toBe('Validation failed');
    });
  });

  describe('2. Pagination Helpers', () => {
    it('parsePagination parses valid limit and offset', () => {
      const req = { query: { limit: '25', offset: '50' } };
      const { valid, limit, offset } = val.parsePagination(req);
      expect(valid).toBe(true);
      expect(limit).toBe(25);
      expect(offset).toBe(50);
    });

    it('parsePagination returns valid: false when limit or offset are invalid or exceed bounds', () => {
      const negReq = { query: { limit: '-5' } };
      expect(val.parsePagination(negReq).valid).toBe(false);

      const zeroReq = { query: { limit: '0' } };
      expect(val.parsePagination(zeroReq).valid).toBe(false);

      const nanReq = { query: { limit: 'invalid' } };
      expect(val.parsePagination(nanReq).valid).toBe(false);

      const maxReq = { query: { limit: '99999' } };
      const maxRes = val.parsePagination(maxReq, 30, 200);
      expect(maxRes.valid).toBe(false);
      expect(maxRes.error).toBe('Limit exceeded');

      const negOffset = { query: { offset: '-1' } };
      expect(val.parsePagination(negOffset).valid).toBe(false);
    });

    it('sendPaginated returns HTTP 400 when limit exceeds maxLimit or is invalid', () => {
      let statusCode = 0;
      let jsonPayload = null;
      const res = {
        status: (code) => { statusCode = code; return res; },
        json: (data) => { jsonPayload = data; return res; },
        setHeader: () => {}
      };

      val.sendPaginated({ query: { limit: '999' } }, res, [1, 2, 3], 50, 100);
      expect(statusCode).toBe(400);
      expect(jsonPayload.error).toBe('Limit exceeded');

      val.sendPaginated({ query: { limit: '-10' } }, res, [1, 2, 3], 50, 100);
      expect(statusCode).toBe(400);
      expect(jsonPayload.error).toBe('Invalid query parameter');
    });

    it('sendPaginated sends standard paginated response and headers', () => {
      const req = { query: { limit: '2', offset: '1' } };
      const headers = {};
      let jsonPayload = null;
      const res = {
        status: () => res,
        setHeader: (name, val) => { headers[name] = val; },
        json: (data) => { jsonPayload = data; return res; }
      };

      const data = ['a', 'b', 'c', 'd', 'e'];
      val.sendPaginated(req, res, data);

      expect(headers['X-Total-Count']).toBe(5);
      expect(headers['X-Limit']).toBe(2);
      expect(headers['X-Offset']).toBe(1);
      expect(headers['X-Has-More']).toBe('true');
      expect(jsonPayload).toEqual(['b', 'c']);
    });

    it('sendPaginated sends envelope format when requested', () => {
      const req = { query: { envelope: 'true', limit: '2', offset: '0' } };
      const headers = {};
      let jsonPayload = null;
      const res = {
        status: () => res,
        setHeader: (name, val) => { headers[name] = val; },
        json: (data) => { jsonPayload = data; return res; }
      };

      val.sendPaginated(req, res, [10, 20, 30]);
      expect(jsonPayload.items).toEqual([10, 20]);
      expect(jsonPayload.pagination.total).toBe(3);
    });
  });

  describe('3. Zod Schemas Validation', () => {
    it('loginSchema validates username or email', () => {
      expect(val.loginSchema.safeParse({ username: 'u', password: 'p' }).success).toBe(true);
      expect(val.loginSchema.safeParse({ email: 'u@test.com', password: 'p' }).success).toBe(true);
      expect(val.loginSchema.safeParse({ password: 'p' }).success).toBe(false);
    });

    it('agentEnrollSchema requires hostname and allows optional device_uid', () => {
      expect(val.agentEnrollSchema.safeParse({ device_uid: 'uid-1', hostname: 'host-1' }).success).toBe(true);
      expect(val.agentEnrollSchema.safeParse({ hostname: 'host-1' }).success).toBe(true);
      expect(val.agentEnrollSchema.safeParse({ device_uid: 'uid-1' }).success).toBe(false);
    });

    it('telemetryIngestSchema requires hostname', () => {
      expect(val.telemetryIngestSchema.safeParse({ hostname: 'h1', cpu_usage: 10 }).success).toBe(true);
      expect(val.telemetryIngestSchema.safeParse({ cpu_usage: 10 }).success).toBe(false);
    });

    it('commandDispatchSchema accepts command payloads with target and kind', () => {
      expect(val.commandDispatchSchema.safeParse({ hostname: 'SRV-1', command_type: 'restart' }).success).toBe(true);
      expect(val.commandDispatchSchema.safeParse({ device_id: 'dev-1', kind: 'powershell' }).success).toBe(true);
      expect(val.commandDispatchSchema.safeParse({}).success).toBe(false);
    });

    it('createUserSchema enforces required fields', () => {
      expect(val.createUserSchema.safeParse({
        username: 'john_doe',
        email: 'john@example.com',
        password: 'securePassword123'
      }).success).toBe(true);

      expect(val.createUserSchema.safeParse({
        username: 'ab' // < 3 chars
      }).success).toBe(false);
    });

    it('createCompanySchema enforces company name', () => {
      expect(val.createCompanySchema.safeParse({ name: 'Acme Corp' }).success).toBe(true);
      expect(val.createCompanySchema.safeParse({}).success).toBe(false);
    });

    it('createAlertRuleSchema validates metric condition and threshold', () => {
      expect(val.createAlertRuleSchema.safeParse({
        name: 'High CPU',
        metric: 'cpu',
        threshold: 80
      }).success).toBe(true);

      expect(val.createAlertRuleSchema.safeParse({
        name: 'Invalid Rule'
      }).success).toBe(false);
    });

    it('createTicketSchema requires title', () => {
      expect(val.createTicketSchema.safeParse({ title: 'Issue 1' }).success).toBe(true);
      expect(val.createTicketSchema.safeParse({}).success).toBe(false);
    });

    it('createPolicySchema requires policy name and policy_type', () => {
      expect(val.createPolicySchema.safeParse({ name: 'Sec Pol', policy_type: 'security' }).success).toBe(true);
      expect(val.createPolicySchema.safeParse({ name: 'Sec Pol' }).success).toBe(false);
    });

    it('createGroupSchema requires group name', () => {
      expect(val.createGroupSchema.safeParse({ name: 'Grp 1' }).success).toBe(true);
      expect(val.createGroupSchema.safeParse({}).success).toBe(false);
    });

    it('updateRemediationPolicySchema requires enabled boolean', () => {
      expect(val.updateRemediationPolicySchema.safeParse({
        enabled: true
      }).success).toBe(true);

      expect(val.updateRemediationPolicySchema.safeParse({}).success).toBe(false);
    });
  });
});
