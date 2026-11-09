import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import {verifySetupCode} from './setup-security.js';
import {encryptSecret,mergeSmtp,safeSmtp,stripLegacySecrets,effectiveGitHubToken} from './config-secrets.js';

export async function getStrictSetupState(db) {
  if(process.env.NODE_ENV==='production'&&!db.isMysqlConnected())throw new Error('SETUP_DATABASE_UNAVAILABLE');
  const rows=await db.executeQuery('SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 1',['branding']);
  if(!rows[0])return {setup_complete:false};
  const v=rows[0].setting_value;
  const obj=typeof v==='string'?JSON.parse(v):v;
  return {setup_complete:obj?.setup_complete===true};
}
export async function readConfiguredGitHubToken(db) {
  const saved=await db.getSetting('githubIntegration',{});
  return effectiveGitHubToken(process.env.GITHUB_TOKEN,saved?.token_encrypted);
}
const DEFAULT_TENANT='00000000-0000-0000-0000-000000000001';
const SET_SQL='INSERT INTO system_settings (setting_key,setting_value,updated_at) VALUES (?,?,NOW(3)) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value),updated_at=NOW(3)';
async function putSetting(conn,key,value) {
  await conn.query(SET_SQL,[key,JSON.stringify(value)]);
}
function setupError(code) {const e=new Error(code);e.code=code;return e;}
function brandForSetup(current,input) {
  const b=stripLegacySecrets({...current,setup_complete:true,company_name:input.company_name,server_host:input.server_host});
  if(input.branding)b.branding=input.branding;
  if(input.build_mode)b.build_mode=input.build_mode;
  if(input.github_repo!==undefined)b.github_repo=input.github_repo;
  return b;
}
async function createOwner(db,input) {
  if(!db.isMysqlConnected()) {
    if(process.env.NODE_ENV==='production')throw setupError('SETUP_DATABASE_UNAVAILABLE');
    if((await getStrictSetupState(db)).setup_complete)throw setupError('SETUP_ALREADY_COMPLETED');
    const users=await db.getUsers();
    const current=users.find(u=>String(u.role).toUpperCase()==='SUPER_ADMIN');
    const hash=await bcrypt.hash(input.admin_password,12);
    let admin;
    if(current) {
      await db.updateUser(current.id,{username:input.admin_username,password_hash:hash,active:true,
        ...(input.admin_email?{email:input.admin_email}:{})});
      admin=await db.getUserById(current.id);
    } else {
      admin=await db.createUser({username:input.admin_username,
        email:input.admin_email||input.admin_username+'@localhost.invalid',
        password_hash:hash,role:'SUPER_ADMIN',active:true});
    }
    if(input.smtp)await db.setSetting('smtpSettings',mergeSmtp({},input.smtp));
    if(input.github_token)await db.setSetting('githubIntegration',{token_encrypted:encryptSecret(input.github_token)});
    await db.updateBranding(brandForSetup(await db.getBranding(),input));
    return admin;
  }
  const conn=await db.getPool().getConnection();
  let lock=false,inTransaction=false;
  try {
    const [lockRows]=await conn.query("SELECT GET_LOCK('aaditech:first-run-setup',5) AS acquired");
    lock=Number(lockRows[0]?.acquired)===1;
    if(!lock)throw setupError('SETUP_ALREADY_IN_PROGRESS');
    await conn.beginTransaction();inTransaction=true;
    const [storedRows]=await conn.query('SELECT setting_value FROM system_settings WHERE setting_key = ? FOR UPDATE',['branding']);
    const raw=storedRows[0]?.setting_value;
    const previous=raw?(typeof raw==='string'?JSON.parse(raw):raw):{};
    if(previous.setup_complete===true)throw setupError('SETUP_ALREADY_COMPLETED');
    const passHash=await bcrypt.hash(input.admin_password,12);
    const [admins]=await conn.query("SELECT id,tenant_id,company_id,email FROM users WHERE role IN ('SUPER_ADMIN','ADMIN') ORDER BY id ASC LIMIT 1 FOR UPDATE");
    let admin;
    if(admins[0]) {
      admin={...admins[0],username:input.admin_username,role:'SUPER_ADMIN'};
      admin.email=input.admin_email||admin.email;
      await conn.query("UPDATE users SET username=?,email=?,password_hash=?,role='SUPER_ADMIN',active=1,status='ACTIVE',updated_at=NOW(3) WHERE id=?",
        [admin.username,admin.email,passHash,admin.id]);
    } else {
      const email=input.admin_email||input.admin_username+'@localhost.invalid';
      const [insert]=await conn.query(
        "INSERT INTO users (tenant_id,company_id,username,email,password_hash,role,active,status,created_at) VALUES (?,1,?,?,?,'SUPER_ADMIN',1,'ACTIVE',NOW(3))",
        [DEFAULT_TENANT,input.admin_username,email,passHash]);
      admin={id:insert.insertId,tenant_id:DEFAULT_TENANT,company_id:1,username:input.admin_username,email,role:'SUPER_ADMIN'};
    }
    const known={ops_lead:'Operator123!',sec_monitor:'Monitor123!'};
    const [seeded]=await conn.query("SELECT id,username,password_hash FROM users WHERE username IN ('ops_lead','sec_monitor') FOR UPDATE");
    for(const user of seeded) {
      if(user.id!==admin.id&&known[user.username]&&await bcrypt.compare(known[user.username],user.password_hash)) {
        await conn.query("UPDATE users SET active=0,password_hash=?,updated_at=NOW(3) WHERE id=?",
          [await bcrypt.hash(crypto.randomBytes(32).toString('hex'),12),user.id]);
      }
    }
    await putSetting(conn,'branding',brandForSetup(previous,input));
    if(input.smtp)await putSetting(conn,'smtpSettings',mergeSmtp({},input.smtp));
    if(input.github_token)await putSetting(conn,'githubIntegration',{token_encrypted:encryptSecret(input.github_token)});
    await conn.commit();inTransaction=false;
    return admin;
  } catch(e) {
    if(inTransaction)await conn.rollback().catch(()=>{});
    throw e;
  } finally {
    if(lock)await conn.query("SELECT RELEASE_LOCK('aaditech:first-run-setup')").catch(()=>{});
    conn.release();
  }
}
async function persistSettings(db,items) {
  if(process.env.NODE_ENV==='production'&&!db.isMysqlConnected())throw new Error('SETTINGS_DATABASE_UNAVAILABLE');
  if(!db.isMysqlConnected()){
    for(const [k,v] of Object.entries(items))await db.setSetting(k,v);
    return;
  }
  const conn=await db.getPool().getConnection();
  try {
    await conn.beginTransaction();
    for(const [k,v] of Object.entries(items))await putSetting(conn,k,v);
    await conn.commit();
  }catch(e){await conn.rollback().catch(()=>{});throw e;}
  finally{conn.release();}
}
export function installFirstRunRoutes(app,{db,requireRole,validateBody,setupSchema,systemConfigSchema,systemConfigTestSchema,issueUserToken,logAudit}) {
  app.get(['/api/v1/setup/status','/api/setup/status'],async(req,res)=>{
    try {
      const state=await getStrictSetupState(db);
      const brand=await db.getBranding();
      return res.json({setup_complete:state.setup_complete,database_connected:db.isMysqlConnected(),
        company_name:brand.company_name,server_host:brand.server_host,
        default_build_mode:brand.build_mode,branding:brand.branding,build_mode:brand.build_mode,
        github_repo:brand.github_repo});
    } catch(e){return res.status(503).json({error:'SETUP_DATABASE_UNAVAILABLE'});}
  });
  app.post(['/api/v1/setup','/api/setup'],validateBody(setupSchema),async(req,res)=>{
    if(process.env.NODE_ENV==='production'&&!db.isMysqlConnected())
      return res.status(503).json({error:'SETUP_DATABASE_UNAVAILABLE'});
    if(!verifySetupCode(req.get('x-setup-code')))
      return res.status(403).json({error:'SETUP_CODE_INVALID',detail:'Enter the setup code from the server data directory.'});
    try {
      const admin=await createOwner(db,req.validatedBody);
      const token=issueUserToken(admin);
      const cookie={httpOnly:true,sameSite:'lax',secure:req.secure,maxAge:28800000};
      res.cookie('auth_token',token,cookie);
      res.cookie('itk_session',token,cookie);
      Promise.resolve(logAudit(admin,'FIRST_RUN_SETUP_COMPLETED','SystemConfiguration',{setup_complete:true},req))
        .catch(e=>console.warn('[setup] audit:',e.message));
      return res.json({ok:true,setup_complete:true,user:{id:admin.id,username:admin.username,role:'SUPER_ADMIN'}});
    }catch(e){
      if(e.code==='SETUP_ALREADY_COMPLETED'||e.code==='SETUP_ALREADY_IN_PROGRESS')
        return res.status(409).json({error:e.code});
      console.error('[setup] failed:',e.message);
      return res.status(503).json({error:'SETUP_FAILED',detail:'Could not save setup; inspect server logs.'});
    }
  });
  app.get('/api/v1/system/config',requireRole(['SUPER_ADMIN']),async(req,res)=>{
    try {
      if(process.env.NODE_ENV==='production'&&!db.isMysqlConnected())return res.status(503).json({error:'Database unavailable'});
      const b=stripLegacySecrets(await db.getBranding());
      const smtp=await db.getSetting('smtpSettings',{}),git=await db.getSetting('githubIntegration',{});
      return res.json({company_name:b.company_name,server_host:b.server_host,branding:b.branding,
        build_mode:b.build_mode,github_repo:b.github_repo,smtp:safeSmtp(smtp),
        github_token_configured:Boolean(git?.token_encrypted||process.env.GITHUB_TOKEN),
        github_token_managed_by_environment:Boolean(process.env.GITHUB_TOKEN),
        database_connected:db.isMysqlConnected()});
    }catch(e){return res.status(503).json({error:'Configuration unavailable'});}
  });
  app.patch('/api/v1/system/config',requireRole(['SUPER_ADMIN']),validateBody(systemConfigSchema),async(req,res)=>{
    const x=req.validatedBody;
    if((x.clear_github_token&&x.github_token)||(x.clear_smtp_password&&x.smtp?.password))
      return res.status(400).json({error:'Cannot clear and replace a secret together'});
    if(x.clear_github_token&&process.env.GITHUB_TOKEN)
      return res.status(409).json({error:'GitHub token is host-managed'});
    try {
      if(process.env.NODE_ENV==='production'&&!db.isMysqlConnected())throw new Error('Database unavailable');
      const old=await db.getBranding(),updates={};
      for(const key of ['company_name','server_host','branding','build_mode','github_repo'])
        if(x[key]!==undefined)updates[key]=x[key];
      const items={branding:stripLegacySecrets({...old,...updates})};
      if(x.smtp||x.clear_smtp_password) {
        const prev=await db.getSetting('smtpSettings',{});
        const smtp=x.smtp?mergeSmtp(prev,x.smtp):{...prev};
        if(x.clear_smtp_password)delete smtp.password_encrypted;
        items.smtpSettings=smtp;
      }
      if(x.clear_github_token)items.githubIntegration={};
      else if(x.github_token)items.githubIntegration={token_encrypted:encryptSecret(x.github_token)};
      await persistSettings(db,items);
      Promise.resolve(logAudit(req.user,'SYSTEM_CONFIGURATION_UPDATED','SystemConfiguration',
        {fields:Object.keys(x).filter(k=>k!=='github_token'&&k!=='smtp')},req))
        .catch(e=>console.warn('[config] audit:',e.message));
      return res.json({ok:true,changed_fields:Object.keys(x)});
    }catch(e){
      console.error('[system-config] update:',e.message);
      return res.status(503).json({error:'Configuration not saved'});
    }
  });
  app.post('/api/v1/system/config/test',requireRole(['SUPER_ADMIN']),validateBody(systemConfigTestSchema),
    async(req,res)=>{
      if(req.validatedBody.kind!=='database')
        return res.status(501).json({ok:false,status:'NOT_IMPLEMENTED',kind:req.validatedBody.kind});
      try {
        if(!db.isMysqlConnected())throw new Error('DB offline');
        await db.executeQuery('SELECT 1 AS ok');
        return res.json({ok:true,status:'CONNECTED'});
      }catch(e){return res.status(503).json({ok:false,status:'UNAVAILABLE'});}
    });
}
