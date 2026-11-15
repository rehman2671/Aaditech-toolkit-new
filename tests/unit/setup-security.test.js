import { describe, expect, it } from 'vitest';
import { isValidSetupKey, isSeededDemoPasswordHash } from '../../setup-security.js';

const secret = 'a'.repeat(64);

describe('production initial setup authorization', () => {
  it('accepts the exact operator-held key', () => {
    expect(isValidSetupKey(secret, secret)).toBe(true);
  });
  it('rejects missing, modified and shortened keys', () => {
    for (const candidate of [undefined, null, '', 'a'.repeat(63), 'b' + 'a'.repeat(63), 'a'.repeat(65)]) {
      expect(isValidSetupKey(candidate, secret)).toBe(false);
    }
  });
  it('rejects overly long and non-string headers', () => {
    for (const candidate of ['a'.repeat(513), { token: secret }, [secret], 123]) {
      expect(isValidSetupKey(candidate, secret)).toBe(false);
    }
  });
  it('rejects missing or weak server-side setup secrets', () => {
    for (const expected of ['', undefined, '123456789', null]) {
      expect(isValidSetupKey('123456789', expected)).toBe(false);
    }
  });
  it('never coerces case or whitespace for setup keys', () => {
    expect(isValidSetupKey(secret.toUpperCase(), secret)).toBe(false);
    expect(isValidSetupKey(secret + '\n', secret)).toBe(false);
  });
});

describe('shipped demo credentials', () => {
  it('blocks the public sample admin/operator/monitor password hashes', () => {
    for (const hash of [
      '$2b$10$TdjPGYqvBhQ/znxrISK4leR0Q7x4QAQW2ZGzOCAx.YK35eHrbROmW',
      '$2b$10$tL4nJuWXUzt/0GCKKGBdYONSEz3DaUwJY/CjeNyFSymTjnLsG3tTu',
      '$2b$10$NsbjYaSfny5cA4RBHXyw5OtEBfolN57DqRLAzNv2rpA22laPAd1Fe'
    ]) {
      expect(isSeededDemoPasswordHash(hash)).toBe(true);
    }
  });
  it('allows separately reset bcrypt password hashes', () => {
    expect(isSeededDemoPasswordHash('$2b$10$totallyDifferentHash')).toBe(false);
    expect(isSeededDemoPasswordHash(undefined)).toBe(false);
  });
});
