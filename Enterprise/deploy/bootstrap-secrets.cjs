'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const REQUIRED_SECRETS=['API_TOKEN','JWT_SECRET','HMAC_SECRET','BOOTSTRAP_SECRET','COMMAND_SIGNING_KEY','SETTINGS_ENCRYPTION_KEY'];
function populateAppSecrets({dataDir=process.env.DATA_DIR||'/data',env=process.env}={}) {
 fs.mkdirSync(dataDir,{recursive:true,mode:0o700});
 if(process.platform!=='win32')fs.chmodSync(dataDir,0o700);
 for(const name of REQUIRED_SECRETS) {
  if(typeof env[name]==='string'&&env[name].trim()){
   if(/^(your_|change[-_]?me|example|placeholder)/i.test(env[name]))throw new Error(name+' is an example credential');
   continue;
  }
  const file=path.join(dataDir,'generated-'+name.toLowerCase());
  try{fs.writeFileSync(file,crypto.randomBytes(48).toString('hex')+'\n',{flag:'wx',mode:0o600});}
  catch(e){if(e.code!=='EEXIST')throw e;}
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Unsafe secret file '+name);
  if(process.platform!=='win32')fs.chmodSync(file,0o600);
  const secret=fs.readFileSync(file,'utf8').trim();
  if(secret.length<64)throw new Error('Weak persisted secret '+name);
  env[name]=secret;
 }
 return REQUIRED_SECRETS.length;
}
module.exports={REQUIRED_SECRETS,populateAppSecrets};
