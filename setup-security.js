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

const seedPasswordHashes = new Set([
  // Fixed demo bcrypt hashes from database/mysql/schema.sql and db.js.
  // Never permit unchanged shipped credentials on a public deployment.
  '$2b$10$TdjPGYqvBhQ/znxrISK4leR0Q7x4QAQW2ZGzOCAx.YK35eHrbROmW',
  '$2b$10$tL4nJuWXUzt/0GCKKGBdYONSEz3DaUwJY/CjeNyFSymTjnLsG3tTu',
  '$2b$10$NsbjYaSfny5cA4RBHXyw5OtEBfolN57DqRLAzNv2rpA22laPAd1Fe'
]);
export function isSeededDemoPasswordHash(hash) {
  return typeof hash === 'string' && seedPasswordHashes.has(hash);
}
