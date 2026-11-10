import crypto from 'node:crypto';
function key() {
  const s=process.env.SETTINGS_ENCRYPTION_KEY;
  if(typeof s!=='string'||s.length<32)throw new Error('SETTINGS_ENCRYPTION_KEY required');
  return crypto.createHash('sha256').update(s,'utf8').digest();
}
export function encryptSecret(secret) {
  if(typeof secret!=='string'||!secret)throw new TypeError('Secret required');
  const iv=crypto.randomBytes(12), cipher=crypto.createCipheriv('aes-256-gcm',key(),iv);
  const bytes=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);
  return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),bytes.toString('base64url')].join(':');
}
export function decryptSecret(raw) {
  const p=typeof raw==='string'?raw.split(':'):[];
  if(p.length!==4||p[0]!=='v1')throw new Error('Invalid encrypted credential');
  const dec=crypto.createDecipheriv('aes-256-gcm',key(),Buffer.from(p[1],'base64url'));
  dec.setAuthTag(Buffer.from(p[2],'base64url'));
  return Buffer.concat([dec.update(Buffer.from(p[3],'base64url')),dec.final()]).toString('utf8');
}
export function safeSmtp(v={}) {
  return {provider:v.provider||'none',email:v.email||'',recipient:v.recipient||'',
    host:v.host||'',port:v.port||null,encryption:v.encryption||'starttls',
    password_configured:Boolean(v.password_encrypted)};
}
export function mergeSmtp(old={},input={}) {
  const {password,password_encrypted,...safe}=input;
  const result={...old,...safe};
  if(password)result.password_encrypted=encryptSecret(password);
  return result;
}
export function stripLegacySecrets(v={}) {
  const {github_token:_token,github_pat:_pat,...safe}=v;
  return safe;
}
export function effectiveGitHubToken(envToken, encrypted) {
  if(typeof envToken==='string'&&envToken.trim())return envToken;
  return encrypted?decryptSecret(encrypted):'';
}
