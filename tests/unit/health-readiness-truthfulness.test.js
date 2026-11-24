import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../server.js';

// Healthz is public and must never claim a signed MSI builder or unprobed
// background workers are healthy. Real MySQL readiness remains authoritative.
describe('Health readiness evidence boundaries', () => {
  for (const route of ['/healthz', '/api/health', '/api/v1/health']) {
    it(route + ' does not advertise invented subsystem readiness', async () => {
      const response = await request(app).get(route);
      expect([200, 503]).toContain(response.status);
      expect(response.body.components).toMatchObject({
        ingest_queue: 'NOT_VERIFIED',
        msi_builder: 'EXTERNAL_SIGNING_REQUIRED',
        audit_engine: 'NOT_VERIFIED'
      });
      expect(['HEALTHY', 'DEGRADED']).toContain(response.body.components.database);
      expect(response.body.components.msi_builder).not.toBe('READY');
      expect(response.body.components.ingest_queue).not.toBe('OPERATIONAL');
      expect(response.body.components.audit_engine).not.toBe('ACTIVE');
    });
  }
});
