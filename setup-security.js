import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function setupCodePath() {
  return path.join(process.env.DATA_DIR || path.join(os.homedir(),'.aaditech-toolkit','data'), 'first-run-setup-code');
}
export function ensureSetupCode() {
  const file = setupCodePath();
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  try { fs.writeFileSync(file,crypto.randomBytes(24).toString('base64url')+'\n',{flag:'wx',mode:0o600}); }
  catch(e) { if(e.code!=='EEXIST')throw e; }
  const info=fs.lstatSync(file);
  if(!info.isFile()||info.isSymbolicLink())throw new Error('Unsafe setup code file');
  if(process.platform!=='win32')fs.chmodSync(file,0o600);
  return file;
}
export function verifySetupCode(code) {
  if(typeof code!=='string'||!code.trim()||code.length>256)return false;
  const expected=fs.readFileSync(ensureSetupCode(),'utf8').trim();
  return crypto.timingSafeEqual(
    crypto.createHash('sha256').update(code.trim()).digest(),
    crypto.createHash('sha256').update(expected).digest()
  );
}
