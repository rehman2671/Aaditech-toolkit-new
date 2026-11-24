import { describe, it, expect, afterEach } from 'vitest';
import { resolveAgentOrigin } from '../../agent-origin.js';

const priorNode = process.env.NODE_ENV;
const priorHost = process.env.SERVER_HOST;
afterEach(() => {
  if (priorNode === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = priorNode;
  if (priorHost === undefined) delete process.env.SERVER_HOST;
  else process.env.SERVER_HOST = priorHost;
});

describe('Agent setup origin trust policy', () => {
  it('takes production origin only from operator-owned SERVER_HOST and forces HTTPS', () => {
    process.env.NODE_ENV = 'production';
    process.env.SERVER_HOST = 'agent.aaditech.net';
    const request = {
      headers: { host: 'evil.example.org', 'x-forwarded-proto': 'http' },
      protocol: 'http'
    };
    expect(resolveAgentOrigin(request)).toEqual({ host: 'agent.aaditech.net', protocol: 'https' });
    request.headers.host = 'evil"; Start-Process powershell';
    request.headers['x-forwarded-proto'] = 'javascript:';
    expect(resolveAgentOrigin(request)).toEqual({ host: 'agent.aaditech.net', protocol: 'https' });
  });

  it('refuses missing, untrusted or malformed production deployment host', () => {
    process.env.NODE_ENV = 'production';
    for (const host of ['', 'localhost', '127.0.0.1', 'localhost:3000',
      'https://agent.aaditech.net', 'agent.example.test', 'agent.local',
      'foo../bar', 'example.com\\nmalicious', 'bad".example.org']) {
      process.env.SERVER_HOST = host;
      expect(resolveAgentOrigin({headers:{host:'attacker.example.org'}})).toBeNull();
    }
  });

  it('never trusts caller Host or HTTP scheme in any non-test deployment mode', () => {
    const request = { headers: { host: 'attacker.example.com', 'x-forwarded-proto': 'http' }, protocol: 'http' };
    for (const mode of [undefined, '', 'development', 'staging', 'Production']) {
      if (mode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = mode;
      process.env.SERVER_HOST = 'office.example.org';
      expect(resolveAgentOrigin(request)).toEqual({host:'office.example.org', protocol:'https'});
      delete process.env.SERVER_HOST;
      expect(resolveAgentOrigin(request)).toBeNull();
      process.env.SERVER_HOST = '192.168.1.9';
      expect(resolveAgentOrigin(request)).toBeNull();
    }
  });

  it('allows developer loopback but rejects attacker header injection and forwarding spoofing', () => {
    process.env.NODE_ENV = 'test';
    const request = { headers: { host: '127.0.0.1:3000', 'x-forwarded-proto': 'https' }, protocol: 'http' };
    expect(resolveAgentOrigin(request)).toEqual({ host: '127.0.0.1:3000', protocol: 'http' });
    request.headers.host = 'victim.com\\r\\nmalicious';
    expect(resolveAgentOrigin(request)).toBeNull();
  });
});
