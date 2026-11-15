import crypto from 'node:crypto';

// Versioned, domain-separated command signatures. A device may verify its
// command only with its unique enrollment token, NEVER a fleet-wide secret.
// The signed JSON is the sole source of executable command attributes.
const DOMAIN = 'aaditech:agent-command:v1\n';
const MAX_AGE_MS = 5 * 60_000;

export function signDeviceCommand({ device, command, deviceToken, now = Date.now() }) {
  if (!deviceToken || !String(deviceToken).startsWith('itk_dev_')) {
    throw new Error('An individual enrolled device token is required for command signing');
  }
  if (!device?.id || !device?.tenant_id || !device?.hostname || !command?.id) {
    throw new Error('Device and command identity required for command signing');
  }
  const issued = new Date(now);
  const expires = new Date(now + MAX_AGE_MS);
  if (!Number.isFinite(issued.getTime())) throw new Error('Invalid command timestamp');
  const data = {
    version: 1,
    command_id: String(command.id),
    device_id: String(device.id),
    tenant_id: String(device.tenant_id),
    hostname: String(device.hostname),
    kind: String(command.kind || command.command_type || ''),
    payload: command.payload || {},
    issued_at: issued.toISOString(),
    expires_at: expires.toISOString()
  };
  if (!data.kind) throw new Error('Command kind required');
  const content = JSON.stringify(data);
  const signature = crypto.createHmac('sha256', String(deviceToken))
    .update(DOMAIN + content, 'utf8').digest('hex');
  return { signed_content: content, signature };
}

export function verifyDeviceCommand({ signed_content, signature, deviceToken, commandId, device, now = Date.now() }) {
  if (typeof signed_content !== 'string' || signed_content.length > 65536 ||
      !/^[a-f0-9]{64}$/i.test(signature || '') || !deviceToken || !device) return false;
  const expected = crypto.createHmac('sha256', String(deviceToken))
    .update(DOMAIN + signed_content, 'utf8').digest();
  const given = Buffer.from(signature, 'hex');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return false;
  let parsed;
  try { parsed = JSON.parse(signed_content); } catch { return false; }
  if (parsed.version !== 1 || !parsed.command_id || !parsed.device_id ||
      !parsed.tenant_id || !parsed.hostname || !parsed.kind ||
      !Number.isFinite(Date.parse(parsed.issued_at)) ||
      !Number.isFinite(Date.parse(parsed.expires_at))) return false;
  const issued = Date.parse(parsed.issued_at), expires = Date.parse(parsed.expires_at);
  return String(parsed.command_id) === String(commandId) &&
    String(parsed.device_id) === String(device.id) &&
    String(parsed.tenant_id) === String(device.tenant_id) &&
    String(parsed.hostname).toLowerCase() === String(device.hostname).toLowerCase() &&
    now >= issued - 60_000 && now <= expires &&
    expires > issued && expires - issued <= MAX_AGE_MS;
}
