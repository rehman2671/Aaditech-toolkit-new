import crypto from 'node:crypto';

// Compare fixed-size hashes in constant time so setup-key length and prefix
// are never exposed through ordinary string comparisons.
export function isValidSetupKey(candidate, expected) {
  if (typeof candidate !== 'string' || candidate.length === 0 ||
      candidate.length > 512 || typeof expected !== 'string' ||
      expected.length < 32) return false;
  const actualHash = crypto.createHash('sha256').update(candidate).digest();
  const expectedHash = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(actualHash, expectedHash);
}
