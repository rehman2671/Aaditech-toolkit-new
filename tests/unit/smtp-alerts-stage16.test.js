import { describe, it, expect, vi } from 'vitest';
import { isValidMailbox, smtpTransportConfig,
  isApprovedEmailRecipient, deliverTenantEmail } from '../../smtp-alerts.js';

const config = {
  SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587', SMTP_SECURITY: 'starttls',
  SMTP_USER: 'ci', SMTP_PASSWORD: 'fixture-password',
  SMTP_FROM: 'alerts@example.com',
  SMTP_ALLOWED_RECIPIENT_DOMAINS: 'example.com,approved.org',
  SMTP_TIMEOUT_MS: '12000'
};

describe('Stage N16 opt-in SMTP boundaries', () => {
  it('requires encrypted, authenticated operator relay and exact recipient domains', () => {
    expect(smtpTransportConfig({})).toBeNull();
    expect(smtpTransportConfig({ ...config, SMTP_PASSWORD: '' })).toBeNull();
    expect(smtpTransportConfig({ ...config, SMTP_SECURITY: 'none' })).toBeNull();
    expect(smtpTransportConfig({ ...config, SMTP_ALLOWED_RECIPIENT_DOMAINS: '' })).toBeNull();
    expect(smtpTransportConfig(config)?.host).toBe('smtp.example.com');
  });
  it('rejects header injection and other tenant/host recipients', () => {
    const transport = smtpTransportConfig(config);
    expect(isValidMailbox('alerts@example.com')).toBe(true);
    expect(isValidMailbox('alerts@example.com\r\nBcc:x@example.com')).toBe(false);
    expect(isApprovedEmailRecipient('alerts@approved.org', transport)).toBe(true);
    expect(isApprovedEmailRecipient('x@approved.org.bad.tld', transport)).toBe(false);
    expect(isApprovedEmailRecipient('x@unapproved.org', transport)).toBe(false);
  });
  it('never delivers without tenant consent and approved domain', async () => {
    const sender = vi.fn(async () => ({ accepted: true }));
    const enabled = { enabled: true, recipient: 'alerts@example.com' };
    expect((await deliverTenantEmail(null, enabled, {}, sender, config)).reason).toBe('DISABLED');
    expect((await deliverTenantEmail('tenant-A', { ...enabled, enabled: false }, {}, sender, config)).reason).toBe('DISABLED');
    expect((await deliverTenantEmail('tenant-A', enabled, {}, sender, {})).reason).toBe('SMTP_NOT_CONFIGURED');
    expect((await deliverTenantEmail('tenant-A', { ...enabled, recipient: 'x@unapproved.org' }, {}, sender, config)).reason).toBe('RECIPIENT_NOT_APPROVED');
    expect(sender).not.toHaveBeenCalled();
    const receipt = await deliverTenantEmail('tenant-A', enabled, { title: 'CPU', message: 'High' }, sender, config);
    expect(receipt).toEqual({ accepted: true, reason: 'ACCEPTED_BY_SMTP_RELAY' });
    expect(sender).toHaveBeenCalledTimes(1);
  });
});
