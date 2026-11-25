// Persistent first-run bootstrap, never an existing account reset.
import {randomUUID} from 'node:crypto';
import {assertDatabaseIdentity} from './installation-database-identity.js';
const fail=c=>{throw Error(c)};
const tenant='00000000-0000-0000-0000-000000000001';
const seedHash='$2b$10$TdjPGYqvBhQ/znxrISK4leR0Q7x4QAQW2ZGzOCAx.YK35eHrbROmW';
const plain=x=>x&&Object.getPrototypeOf(x)===Object.prototype;
const parse=x=>{let v;try{v=typeof x==='string'?JSON.parse(x):x}catch{fail('SETUP_UNAVAILABLE')}if(!plain(v)||typeof v.setup_complete!=='boolean')fail('SETUP_UNAVAILABLE');return v};
export async function readPersistentSetupStatus(db){
 if(!db.isMysqlConnected())fail('SETUP_UNAVAILABLE');
 const [rows]=await db.getPool().query("SELECT setting_value FROM system_settings WHERE setting_key='branding'");
 if(!Array.isArray(rows)||rows.length>1)fail('SETUP_UNAVAILABLE');
 const branding=rows.length?parse(rows[0].setting_value):{setup_complete:false};
 return {setup_complete:branding.setup_complete,...(!branding.setup_complete&&branding.bootstrap_profile==='clean_install_v1'?{bootstrap_profile:'clean_install_v1'}:{}),default_build_mode:['manual','local_windows','github'].includes(branding.build_mode)?branding.build_mode:'manual'};
}
// Clean profile is reachable only from the initializer's persisted marker,
// the operator-held setup token at the HTTP boundary, and independent local
// installation identity pins. Never infer it from an empty users table.
async function createCleanAdministrator(c,old,body,passwordHash,identity){
 const email=body.admin_email;
 if(typeof email!=='string'||email.length>128||!/^[-a-zA-Z0-9.!#$%&'*+/=?^_`{|}~]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,63}$/.test(email)||!identity||old.installation_id!==identity.expectedInstallationId||old.identity_sha256!==identity.expectedIdentitySha256||Object.keys(old).length!==4)fail('SETUP_RECOVERY_REQUIRED');
 if(await assertDatabaseIdentity(c,identity,true)!==old.installation_id)fail('SETUP_RECOVERY_REQUIRED');
 const [settings]=await c.query('SELECT setting_key FROM system_settings LIMIT 2 FOR UPDATE');
 if(settings?.length!==1||settings[0].setting_key!=='branding')fail('SETUP_RECOVERY_REQUIRED');
 for(const table of ['users','companies','tenants','devices','user_workspace_memberships','audit_logs','command_queue','used_bootstrap_tokens','revoked_tokens','troubleshooting_incidents','troubleshooting_diagnostic_plans','troubleshooting_employee_bindings','troubleshooting_incident_reviews','troubleshooting_diagnostic_consent','troubleshooting_hazard_assessments']){
  const [rows]=await c.query('SELECT 1 AS occupied FROM '+table+' LIMIT 1 FOR UPDATE');if(!Array.isArray(rows)||rows.length)fail('SETUP_RECOVERY_REQUIRED');
 }
 const tenantId=randomUUID(),company=body.company_name.trim();
 const [t]=await c.query("INSERT INTO tenants(id,name,slug,plan,status) VALUES(?,?,?,'enterprise','active')",[tenantId,company,'workspace-'+tenantId]);
 if(t?.affectedRows!==1)fail('SETUP_UNAVAILABLE');
 const [co]=await c.query('INSERT INTO companies(tenant_id,name,users_count,agents_count) VALUES(?,?,1,0)',[tenantId,company]);
 if(co?.affectedRows!==1||!Number.isSafeInteger(co.insertId)||co.insertId<1)fail('SETUP_UNAVAILABLE');
 const [u]=await c.query("INSERT INTO users(tenant_id,company_id,username,email,password_hash,role,active,status) VALUES(?,?,?,?,?,'SUPER_ADMIN',1,'ACTIVE')",[tenantId,co.insertId,body.admin_username,email,passwordHash]);
 if(u?.affectedRows!==1||!Number.isSafeInteger(u.insertId)||u.insertId<1)fail('SETUP_UNAVAILABLE');
 const [member]=await c.query("INSERT INTO user_workspace_memberships(user_id,tenant_id,role,status) VALUES(?,?,'SUPER_ADMIN','ACTIVE')",[u.insertId,tenantId]);
 if(member?.affectedRows!==1)fail('SETUP_UNAVAILABLE');
 return {id:u.insertId,tenant_id:tenantId,company_id:co.insertId,email,username:body.admin_username,role:'SUPER_ADMIN',active:1,status:'ACTIVE'};
}
export async function completeInitialSetup(db,{body,configuredHost,passwordHash,freshIdentityPolicy=null}){
 if(!db.isMysqlConnected()||!plain(body)||typeof configuredHost!=='string'||!configuredHost||body.server_host!==configuredHost||typeof body.admin_username!=='string'||!/^[a-zA-Z0-9_.-]{3,64}$/.test(body.admin_username)||typeof body.company_name!=='string'||!body.company_name.trim()||body.company_name.length>128||!plain(body.branding)||typeof body.branding.logo_text!=='string'||body.branding.logo_text.length>128||!/^#[0-9a-fA-F]{6}$/.test(body.branding.color)||!['manual','local_windows','github'].includes(body.build_mode)||typeof passwordHash!=='string'||!/^\$2[aby]\$10\$[./A-Za-z0-9]{53}$/.test(passwordHash)||passwordHash===seedHash)fail('SETUP_INVALID');
 const pool=db.getPool(),c=await pool.getConnection();let committed=false,committing=false,discard=false;
 try{
  await c.beginTransaction();
  // Upsert a singleton without altering an existing value, acquiring its row
  // lock before credentials. Concurrent bootstrap can never both complete.
  await c.query("INSERT INTO system_settings (setting_key,setting_value) VALUES ('branding',JSON_OBJECT('setup_complete',false)) ON DUPLICATE KEY UPDATE setting_key=setting_key");
  const [rows]=await c.query("SELECT setting_value FROM system_settings WHERE setting_key='branding' FOR UPDATE");
  if(rows?.length!==1)fail('SETUP_UNAVAILABLE');
  const old=parse(rows[0].setting_value);
  if(old.setup_complete)fail('SETUP_ALREADY_COMPLETED');
  const clean=old.bootstrap_profile==='clean_install_v1';
  let u;
  if(clean){
   u=await createCleanAdministrator(c,old,body,passwordHash,freshIdentityPolicy);
  }else{
  if(old.bootstrap_profile!==undefined)fail('SETUP_RECOVERY_REQUIRED');
  const [users]=await c.query("SELECT id,tenant_id,company_id,username,email,password_hash,role,active,status FROM users WHERE role='SUPER_ADMIN' ORDER BY id LIMIT 2 FOR UPDATE");
  u=users?.length===1?users[0]:null;
  // Only the known factory administrator may be rotated. Missing flag with
  // an already changed account is recovery, not permission to reset it.
  if(!u||Number(u.id)!==1||u.tenant_id!==tenant||u.username!=='admin'||u.password_hash!==seedHash||u.role!=='SUPER_ADMIN'||![1,true,'1'].includes(u.active)||u.status!=='ACTIVE')fail('SETUP_RECOVERY_REQUIRED');
  const [members]=await c.query('SELECT user_id,tenant_id,role,status FROM user_workspace_memberships WHERE user_id=? AND tenant_id=? FOR UPDATE',[u.id,u.tenant_id]);
  if(members?.length!==1||Number(members[0].user_id)!==1||members[0].tenant_id!==tenant||members[0].role!=='SUPER_ADMIN'||members[0].status!=='ACTIVE')fail('SETUP_RECOVERY_REQUIRED');
  const [w]=await c.query('UPDATE users SET username=?,password_hash=?,updated_at=NOW(3) WHERE id=? AND tenant_id=? AND password_hash=?',[body.admin_username,passwordHash,u.id,tenant,seedHash]);
  if(w?.affectedRows!==1)fail('SETUP_UNAVAILABLE');
  }
  const next={company_name:body.company_name,server_host:configuredHost,branding:{color:body.branding.color,logo_text:body.branding.logo_text},build_mode:body.build_mode,github_repo:'',rollout_target:'',default_company_id:u.company_id,setup_complete:true};
  const [b]=await c.query("UPDATE system_settings SET setting_value=?,updated_at=NOW(3) WHERE setting_key='branding'",[JSON.stringify(next)]);
  if(b?.affectedRows!==1)fail('SETUP_UNAVAILABLE');
  const [audit]=await c.query('INSERT INTO audit_logs (id,tenant_id,actor_id,actor,action,target_resource,details,ip_address,created_at) VALUES (?,?,?,?,?,?,?,?,NOW(3))',[randomUUID(),u.tenant_id,u.id,body.admin_username,'INITIAL_SETUP_COMPLETED','PlatformSetup',JSON.stringify({credential_rotated:!clean,administrator_created:clean,setup_complete:true}),null]);
  if(audit?.affectedRows!==1)fail('SETUP_UNAVAILABLE');
  const [check]=await c.query('SELECT id,tenant_id,username,email,role,active,status,password_hash FROM users WHERE id=? FOR UPDATE',[u.id]);
  const a=check?.length===1?check[0]:null;
  if(!a||Number(a.id)!==Number(u.id)||a.tenant_id!==u.tenant_id||a.username!==body.admin_username||a.role!=='SUPER_ADMIN'||![1,true,'1'].includes(a.active)||a.status!=='ACTIVE'||a.password_hash!==passwordHash)fail('SETUP_UNAVAILABLE');
  if(clean&&(a.email!==u.email||await assertDatabaseIdentity(c,freshIdentityPolicy,true)!==old.installation_id))fail('SETUP_RECOVERY_REQUIRED');
  committing=true;await c.commit();committed=true;
  return {company:next.company_name,server_host:configuredHost,admin:{id:Number(u.id),username:a.username,email:a.email,role:a.role,tenant_id:u.tenant_id}};
 }finally{if(!committed){if(committing)discard=true;try{await c.rollback()}catch{discard=true}}if(discard)c.destroy();else c.release()}
}
