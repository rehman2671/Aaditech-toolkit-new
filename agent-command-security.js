import crypto from 'node:crypto';

const PREFIX = 'aaditech:agent-command:v1:';
const WINDOW_MS = 5 * 60 * 1000;

export function deriveDeviceCommandKey(masterSigningKey, deviceId) {
  if (typeof masterSigningKey !== 'string' || masterSigningKey.length < 32) {
    throw new Error('Missing secure server-side command master key');
  }
  if (typeof deviceId !== 'string' || !deviceId.trim()) {
    throw new Error('Device ID is required for command signing');
  }
  // Derive a unique per-device key. No endpoint receives the fleet signing master key.
  return crypto.createHmac('sha256', masterSigningKey)
    .update(PREFIX + deviceId, 'utf8').digest('hex');
}

export function signCommandForDevice(masterSigningKey, device, command, now = Date.now()) {
  if (!device?.id || !device?.hostname || !command?.id) throw new Error('Incomplete device or command');
  const payload = typeof command.payload === 'string' ? JSON.parse(command.payload) : (command.payload || {});
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('Command payload must be a JSON object');
  }
  const content = JSON.stringify({
    protocol_version: 1,
    id: String(command.id),
    device_id: String(device.id),
    hostname: String(device.hostname),
    kind: String(command.kind || command.command_type || ''),
    payload,
    issued_at: now,
    expires_at: now + WINDOW_MS
  });
  const key = deriveDeviceCommandKey(masterSigningKey, String(device.id));
  return {
    signed_content: content,
    signature: crypto.createHmac('sha256', key).update(content, 'utf8').digest('hex'),
    signing_version: 1
  };
}

// Node verification reference (the PowerShell agent separately verifies with
// HMACSHA256 and a constant-time comparison; tests detect protocol drift).
export function verifySignedCommand(command, deviceKey, device, now = Date.now()) {
  if (typeof command?.signed_content !== 'string' ||
      typeof command?.signature !== 'string' ||
      typeof deviceKey !== 'string' || deviceKey.length !== 64 ||
      !/^[a-f0-9]{64}$/i.test(command.signature)) return null;

  const expected = crypto.createHmac('sha256', deviceKey).update(command.signed_content, 'utf8').digest('hex');
  const actualBuffer = Buffer.from(command.signature, 'hex');
  const expectBuffer = Buffer.from(expected, 'hex');
  if (!crypto.timingSafeEqual(actualBuffer, expectBuffer)) return null;
  try {
    const signed = JSON.parse(command.signed_content);
    if (signed.protocol_version !== 1 || String(signed.device_id) !== String(device.id) ||
        String(signed.hostname).toLowerCase() !== String(device.hostname).toLowerCase() ||
        String(signed.id) !== String(command.id) ||
        !signed.kind || typeof signed.payload !== 'object' || !signed.payload ||
        Array.isArray(signed.payload) ||
        !Number.isFinite(signed.issued_at) || !Number.isFinite(signed.expires_at) ||
        signed.issued_at > now + 60_000 || signed.expires_at <= now ||
        signed.expires_at > signed.issued_at + WINDOW_MS ||
        signed.issued_at < now - WINDOW_MS - 60_000) return null;
    return signed;
  } catch { return null; }
}
