import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../../server.js';
import { getAgentVersion } from '../../agent-artifacts.js';

describe('MSI Download Route Regression Suite (/latest unshadowed)', () => {
  it('GET /api/v1/msi/download/latest reaches the latest handler and is NOT shadowed by :id', async () => {
    const res = await request(app).get('/api/v1/msi/download/latest');
    
    // The shadowed :id route returned 404 with { error: "MSI Package not found or expired" }
    // The unshadowed /latest handler either streams application/x-msi or returns { error: "MSI artifact...", msi_available: false, version: ... }
    if (res.status === 200) {
      expect(res.headers['content-type']).toMatch(/application\/x-msi/);
      expect(res.headers['content-disposition']).toMatch(/attachment; filename="IT-Toolkit-Agent(-v)?.*\.msi"/);
    } else {
      expect(res.status).toBe(404);
      expect(res.body.error).not.toBe("MSI Package not found or expired");
      expect(res.body.msi_available).toBe(false);
      expect(res.body.version).toBe(getAgentVersion());
    }
  });

  it('GET /api/v1/agent-msi and /api/agent-msi match the same handler as /api/v1/msi/download/latest', async () => {
    const resLatest = await request(app).get('/api/v1/msi/download/latest');
    const resAlias = await request(app).get('/api/v1/agent-msi');
    expect(resAlias.status).toBe(resLatest.status);
    if (resLatest.status === 404) {
      expect(resAlias.body.version).toBe(resLatest.body.version);
    }
  });

  it('GET /api/v1/msi/download/:id handles actual package IDs and returns 404 for nonexistent id', async () => {
    const res = await request(app).get('/api/v1/msi/download/pkg-nonexistent-12345');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("MSI Package not found or expired");
  });
});
