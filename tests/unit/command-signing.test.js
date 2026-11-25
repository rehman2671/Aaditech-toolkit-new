import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { signDeviceCommand, verifyDeviceCommand } from '../../command-signing.js';

const dev = { id: 'dev-1', tenant_id: 'tenant-A', hostname: 'CI-HOST' };
const otherDevice = { ...dev, id: 'dev-2' };
const token = 'itk_dev_000000000000000000000000000000000000000000000000';
const now = Date.parse('2026-11-15T12:00:00.000Z');
const command = { id: 'cmd-9', kind: 'run-script', payload: { script: 'Scripts/QuickCheck.ps1' } };

describe('per-device remote command signatures', () => {
  it('verifies a fresh signature bound to command, tenant, host and device', () => {
    const signed = signDeviceCommand({ device: dev, command, deviceToken: token, now });
    expect(verifyDeviceCommand({ ...signed, deviceToken: token, commandId: command.id, device: dev, now })).toBe(true);
    expect(JSON.parse(signed.signed_content)).toMatchObject({
      version: 1, command_id: 'cmd-9', device_id: 'dev-1', tenant_id: 'tenant-A'
    });
  });

  it('rejects tampering and wrong device/tenant/command', () => {
    const signed = signDeviceCommand({ device: dev, command, deviceToken: token, now });
    const verify = (extra = {}) => verifyDeviceCommand({
      ...signed, deviceToken: token, commandId: command.id, device: dev, now, ...extra
    });
    expect(verify({ signed_content: signed.signed_content.replace('run-script', 'reboot') })).toBe(false);
    expect(verify({ signature: '0'.repeat(64) })).toBe(false);
    expect(verify({ commandId: 'other-command' })).toBe(false);
    expect(verify({ device: otherDevice })).toBe(false);
    expect(verify({ device: { ...dev, tenant_id: 'tenant-B' } })).toBe(false);
    expect(verify({ device: { ...dev, hostname: 'OTHER-HOST' } })).toBe(false);
    expect(verify({ deviceToken: 'itk_dev_wrong-key' })).toBe(false);
  });

  it('rejects expired or future-scheduled signed commands', () => {
    const signed = signDeviceCommand({ device: dev, command, deviceToken: token, now });
    const verify = time => verifyDeviceCommand({
      ...signed, deviceToken: token, commandId: command.id, device: dev, now: time
    });
    expect(verify(now + 5 * 60_000 + 1)).toBe(false);
    expect(verify(now - 60_001)).toBe(false);
  });

  it('rejects missing credentials and malformed protocol', () => {
    expect(() => signDeviceCommand({ device: dev, command, deviceToken: 'fleet-key', now }))
      .toThrow('individual enrolled device token');
    expect(() => signDeviceCommand({ device: null, command, deviceToken: token, now }))
      .toThrow('Device and command identity');
    expect(verifyDeviceCommand({
      signed_content: '{bad-json', signature: '0'.repeat(64),
      deviceToken: token, commandId: command.id, device: dev, now
    })).toBe(false);
  });
});

describe('historical Phase I signed-envelope verifier boundary', () => {
  const signed = signDeviceCommand({ device: dev, command, deviceToken: token, now });
  const envelope = JSON.parse(signed.signed_content);
  const mac = (content, key = token) => crypto.createHmac('sha256', key)
    .update('aaditech:agent-command:v1\n' + content, 'utf8').digest('hex');
  const verify = (content, signature = mac(content), overrides = {}) =>
    verifyDeviceCommand({ signed_content: content, signature, deviceToken: token,
      commandId: command.id, device: dev, now, ...overrides });
  it('returns false for MAC-valid malformed JSON values and coercible fields', () => {
    for (const value of [null, [], true, 1, 'x', { ...envelope, hostname: ['CI-HOST'] },
      { ...envelope, device_id: ['dev-1'] }, { ...envelope, kind: ' ' },
      { ...envelope, issued_at: null }]) {
      expect(verify(JSON.stringify(value))).toBe(false);
    }
    expect(verify(signed.signed_content)).toBe(true);
  });
  it('rejects non-string signatures, non-device signing keys and invalid clock', () => {
    expect(verify(signed.signed_content, [signed.signature])).toBe(false);
    expect(verify(signed.signed_content, mac(signed.signed_content, 'fleet-key'),
      { deviceToken: 'fleet-key' })).toBe(false);
    expect(verify(signed.signed_content, signed.signature, { now: NaN })).toBe(false);
  });
});
