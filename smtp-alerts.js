// Stage N16. Server-owned SMTP credentials; never persisted or returned to tenants.
// TLS 1.2+ or mandatory STARTTLS only. Relay 250 means accepted, NOT inbox delivered.
import net from 'node:net';
import tls from 'node:tls';

const mailbox = /^[A-Za-z0-9.!#$%&'*+/=?^_{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const dnsName = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])\.[a-z]{2,63}$/;
export function isValidMailbox(value) {
  return typeof value === 'string' && value.length <= 254 &&
    !/[\r\n\x00-\x1f\x7f]/.test(value) && mailbox.test(value);
}
export function smtpTransportConfig(env = process.env) {
  const host = String(env.SMTP_HOST || '').trim().toLowerCase();
  const security = String(env.SMTP_SECURITY || '').trim().toLowerCase();
  const port = Number(env.SMTP_PORT || (security === 'tls' ? 465 : 587));
  const from = String(env.SMTP_FROM || '');
  const user = String(env.SMTP_USER || '');
  const password = String(env.SMTP_PASSWORD || '');
  const domains = String(env.SMTP_ALLOWED_RECIPIENT_DOMAINS || '').split(',')
    .map(s => s.trim().toLowerCase()).filter(Boolean);
  const timeoutMs = Number(env.SMTP_TIMEOUT_MS || 12000);
  if (!dnsName.test(host) || net.isIP(host) ||
      !['tls', 'starttls'].includes(security) ||
      !Number.isInteger(port) || port < 1 || port > 65535 ||
      !user || !password || !isValidMailbox(from) ||
      !Number.isInteger(timeoutMs) || timeoutMs < 2000 || timeoutMs > 30000 ||
      !domains.length || domains.some(d => !dnsName.test(d) || net.isIP(d))) return null;
  return { host, security, port, from, user, password, domains, timeoutMs };
}
export function isApprovedEmailRecipient(value, transport) {
  return isValidMailbox(value) && transport?.domains?.includes(value.split('@')[1].toLowerCase()) === true;
}

function replies(socket) {
  let text = '', lines = [], failure = null;
  const queued = [], waiting = [];
  const fail = e => {
    if (failure) return;
    failure = e instanceof Error ? e : new Error('SMTP_CONNECTION_CLOSED');
    while (waiting.length) waiting.shift().reject(failure);
  };
  const data = chunk => {
    text += chunk.toString('utf8');
    if (text.length > 65536) return socket.destroy(new Error('SMTP_RESPONSE_LIMIT'));
    let i;
    while ((i = text.indexOf('\n')) !== -1) {
      const line = text.slice(0, i).replace(/\r$/, '');
      text = text.slice(i + 1);
      const match = /^(\d{3})([- ])/.exec(line);
      if (!match || lines.length > 80) return socket.destroy(new Error('SMTP_INVALID_RESPONSE'));
      lines.push(line);
      if (match[2] === ' ') {
        const response = { code: Number(match[1]), lines };
        lines = [];
        if (waiting.length) waiting.shift().resolve(response);
        else queued.push(response);
      }
    }
  };
  const closed = () => fail(new Error('SMTP_CONNECTION_CLOSED'));
  socket.on('data', data);
  socket.on('error', fail);
  socket.on('close', closed);
  return {
    next() {
      if (queued.length) return Promise.resolve(queued.shift());
      if (failure) return Promise.reject(failure);
      return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
    },
    detach() {
      socket.off('data', data); socket.off('error', fail); socket.off('close', closed);
    }
  };
}
function expectCode(reply, ...codes) {
  if (!codes.includes(reply.code)) throw new Error('SMTP_RELAY_REJECTED_' + reply.code);
  return reply;
}
async function ready(socket, event) {
  await new Promise((resolve, reject) => {
    function fail(err) { socket.off(event, accept); reject(err); }
    function accept() { socket.off('error', fail); resolve(); }
    socket.once('error', fail); socket.once(event, accept);
  });
}
async function command(socket, reader, text, ...codes) {
  socket.write(text + '\r\n');
  return expectCode(await reader.next(), ...codes);
}
function messageBody(config, recipient, event) {
  const title = String(event?.title || 'Alert').replace(/[\r\n\x00-\x1f]/g, ' ').slice(0, 160);
  const subject = '=?UTF-8?B?' + Buffer.from('Aaditech: ' + title).toString('base64') + '?=';
  const lines = ('Severity: ' + String(event?.severity || 'info').replace(/[\r\n]/g, ' ') +
    '\n' + title + '\n' + String(event?.message || '').slice(0, 3500).replace(/\r\n?/g, '\n'))
    .split('\n').flatMap(line => line.match(/.{1,500}/g) || [''])
    .map(line => line.startsWith('.') ? '.' + line : line);
  return [
    'From: <' + config.from + '>', 'To: <' + recipient + '>',
    'Subject: ' + subject, 'Date: ' + new Date().toUTCString(),
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit', '', ...lines
  ].join('\r\n') + '\r\n.\r\n';
}
export async function sendSmtpMessage(config, recipient, event) {
  if (!config || !isApprovedEmailRecipient(recipient, config)) {
    throw new Error('SMTP_DESTINATION_NOT_APPROVED');
  }
  let socket, reader;
  try {
    if (config.security === 'tls') {
      socket = tls.connect({host: config.host, port: config.port, servername: config.host,
        rejectUnauthorized: true, minVersion: 'TLSv1.2'});
      socket.setTimeout(config.timeoutMs, () => socket.destroy(new Error('SMTP_TIMEOUT')));
      await ready(socket, 'secureConnect');
    } else {
      socket = net.connect({ host: config.host, port: config.port });
      socket.setTimeout(config.timeoutMs, () => socket.destroy(new Error('SMTP_TIMEOUT')));
      await ready(socket, 'connect');
    }
    reader = replies(socket);
    expectCode(await reader.next(), 220);
    let ehlo = await command(socket, reader, 'EHLO aaditech.local', 250);
    if (config.security === 'starttls') {
      if (!ehlo.lines.some(line => /^250[- ]STARTTLS(?:\s|$)/i.test(line))) {
        throw new Error('SMTP_STARTTLS_REQUIRED');
      }
      await command(socket, reader, 'STARTTLS', 220);
      reader.detach();
      reader = null;
      socket = tls.connect({socket, servername: config.host,
        rejectUnauthorized: true, minVersion: 'TLSv1.2'});
      socket.setTimeout(config.timeoutMs, () => socket.destroy(new Error('SMTP_TIMEOUT')));
      await ready(socket, 'secureConnect');
      reader = replies(socket);
      ehlo = await command(socket, reader, 'EHLO aaditech.local', 250);
    }
    if (!ehlo.lines.some(line => /\bAUTH\b.*\bPLAIN\b/i.test(line))) {
      throw new Error('SMTP_AUTH_PLAIN_REQUIRED');
    }
    const credentials = Buffer.from('\0' + config.user + '\0' + config.password).toString('base64');
    await command(socket, reader, 'AUTH PLAIN ' + credentials, 235);
    await command(socket, reader, 'MAIL FROM:<' + config.from + '>', 250);
    await command(socket, reader, 'RCPT TO:<' + recipient + '>', 250, 251);
    await command(socket, reader, 'DATA', 354);
    socket.write(messageBody(config, recipient, event));
    expectCode(await reader.next(), 250);
    socket.write('QUIT\r\n');
    return { accepted: true };
  } finally {
    reader?.detach();
    socket?.destroy();
  }
}
export async function deliverTenantEmail(
  tenantId, config, event, sender = sendSmtpMessage, env = process.env
) {
  if (!tenantId || !config?.enabled) return { accepted: false, reason: 'DISABLED' };
  const smtp = smtpTransportConfig(env);
  if (!smtp) return { accepted: false, reason: 'SMTP_NOT_CONFIGURED' };
  if (!isApprovedEmailRecipient(config.recipient, smtp)) {
    return { accepted: false, reason: 'RECIPIENT_NOT_APPROVED' };
  }
  const result = await sender(smtp, config.recipient, event);
  return result?.accepted === true
    ? { accepted: true, reason: 'ACCEPTED_BY_SMTP_RELAY' }
    : { accepted: false, reason: 'SMTP_RELAY_REJECTED' };
}
