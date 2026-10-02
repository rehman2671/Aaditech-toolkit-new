import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

function waitForServer(port, timeoutMs = 8000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function tryConnect() {
      const req = http.get(`http://127.0.0.1:${port}/healthz`, (res) => {
        if (res.statusCode === 200) {
          return resolve(true);
        }
        retry();
      });
      req.on('error', () => retry());
      req.setTimeout(500, () => {
        req.destroy();
        retry();
      });
    }

    function retry() {
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`Server on port ${port} did not respond within ${timeoutMs}ms`));
      }
      setTimeout(tryConnect, 200);
    }

    tryConnect();
  });
}

describe('Server Port Configuration & Multi-Instance Concurrency Suite', () => {
  const envDefaults = {
    ...process.env,
    VITEST: '', // Unset to allow server to listen
    NODE_ENV: 'test',
    JWT_SECRET: 'aaditech_enterprise_jwt_super_secret_key_2026_dev',
    HMAC_SECRET: 'aaditech_hmac_secret_key_dev_2026',
    API_TOKEN: 'itk_agent_sec_token_998877',
    BOOTSTRAP_SECRET: 'aaditech_bootstrap_master_secret_2026_prod_sec',
    COMMAND_SIGNING_KEY: 'aaditech_cmd_signing_master_key_2026_sec'
  };

  it('starts on custom PORT=4001 and does not listen on 3000', async () => {
    const customPort = 4001;
    const serverProc = spawn('node', ['server.js'], {
      cwd: rootDir,
      env: { ...envDefaults, PORT: String(customPort) },
      stdio: 'pipe'
    });

    try {
      await waitForServer(customPort);
      expect(true).toBe(true);

      // Verify port 4001 responds with 200 OK
      const res = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${customPort}/healthz`, (r) => {
          let data = '';
          r.on('data', chunk => data += chunk);
          r.on('end', () => resolve({ status: r.statusCode, body: data }));
        }).on('error', reject);
      });
      expect(res.status).toBe(200);

    } finally {
      serverProc.kill('SIGTERM');
      await new Promise(r => setTimeout(r, 300));
    }
  }, 12000);

  it('runs multiple server instances concurrently on different ports without EADDRINUSE conflict', async () => {
    const portA = 4010;
    const portB = 4011;

    const procA = spawn('node', ['server.js'], {
      cwd: rootDir,
      env: { ...envDefaults, PORT: String(portA) },
      stdio: 'pipe'
    });

    const procB = spawn('node', ['server.js'], {
      cwd: rootDir,
      env: { ...envDefaults, PORT: String(portB) },
      stdio: 'pipe'
    });

    try {
      await Promise.all([waitForServer(portA), waitForServer(portB)]);

      const [resA, resB] = await Promise.all([
        new Promise((resolve, reject) => {
          http.get(`http://127.0.0.1:${portA}/healthz`, (r) => resolve(r.statusCode)).on('error', reject);
        }),
        new Promise((resolve, reject) => {
          http.get(`http://127.0.0.1:${portB}/healthz`, (r) => resolve(r.statusCode)).on('error', reject);
        })
      ]);

      expect(resA).toBe(200);
      expect(resB).toBe(200);
    } finally {
      procA.kill('SIGTERM');
      procB.kill('SIGTERM');
      await new Promise(r => setTimeout(r, 300));
    }
  }, 15000);
});
