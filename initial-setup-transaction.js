// Persistent first-run bootstrap, never an existing account reset.
import {randomUUID} from 'node:crypto';
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
 return {setup_complete:branding.setup_complete,default_build_mode:['manual','local_windows','github'].includes(branding.build_mode)?branding.build_mode:'manual'};
}
export async function completeInitialSetup(db,{body,configuredHost,passwordHash}){
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
  const [users]=await c.query("SELECT id,tenant_id,company_id,username,email,password_hash,role,active,status FROM users WHERE role='SUPER_ADMIN' ORDER BY id LIMIT 2 FOR UPDATE");
  const u=users?.length===1?users[0]:null;
  // Only the known factory administrator may be rotated. Missing flag with
  // an already changed account is recovery, not permission to reset it.
  if(!u||Number(u.id)!==1||u.tenant_id!==tenant||u.username!=='admin'||u.password_hash!==seedHash||u.role!=='SUPER_ADMIN'||![1,true,'1'].includes(u.active)||u.status!=='ACTIVE')fail('SETUP_RECOVERY_REQUIRED');
  const [members]=await c.query('SELECT user_id,tenant_id,role,status FROM user_workspace_memberships WHERE user_id=? AND tenant_id=? FOR UPDATE',[u.id,u.tenant_id]);
  if(members?.length!==1||Number(members[0].user_id)!==1||members[0].tenant_id!==tenant||members[0].role!=='SUPER_ADMIN'||members[0].status!=='ACTIVE')fail('SETUP_RECOVERY_REQUIRED');
  const [w]=await c.query('UPDATE users SET username=?,password_hash=?,updated_at=NOW(3) WHERE id=? AND tenant_id=? AND password_hash=?',[body.admin_username,passwordHash,u.id,tenant,seedHash]);
  if(w?.affectedRows!==1)fail('SETUP_UNAVAILABLE');
  const next={company_name:body.company_name,server_host:configuredHost,branding:{color:body.branding.color,logo_text:body.branding.logo_text},build_mode:body.build_mode,github_repo:'',rollout_target:'',default_company_id:u.company_id,setup_complete:true};
  const [b]=await c.query("UPDATE system_settings SET setting_value=?,updated_at=NOW(3) WHERE setting_key='branding'",[JSON.stringify(next)]);
  if(b?.affectedRows!==1)fail('SETUP_UNAVAILABLE');
  const [audit]=await c.query('INSERT INTO audit_logs (id,tenant_id,actor_id,actor,action,target_resource,details,ip_address,created_at) VALUES (?,?,?,?,?,?,?,?,NOW(3))',[randomUUID(),tenant,u.id,body.admin_username,'INITIAL_SETUP_COMPLETED','PlatformSetup',JSON.stringify({credential_rotated:true,setup_complete:true}),null]);
  if(audit?.affectedRows!==1)fail('SETUP_UNAVAILABLE');
  const [check]=await c.query('SELECT id,tenant_id,username,email,role,active,status,password_hash FROM users WHERE id=? FOR UPDATE',[u.id]);
  const a=check?.length===1?check[0]:null;
  if(!a||Number(a.id)!==1||a.tenant_id!==tenant||a.username!==body.admin_username||a.role!=='SUPER_ADMIN'||![1,true,'1'].includes(a.active)||a.status!=='ACTIVE'||a.password_hash!==passwordHash)fail('SETUP_UNAVAILABLE');
  committing=true;await c.commit();committed=true;
  return {company:next.company_name,server_host:configuredHost,admin:{id:1,username:a.username,email:a.email,role:a.role,tenant_id:tenant}};
 }finally{if(!committed){if(committing)discard=true;try{await c.rollback()}catch{discard=true}}if(discard)c.destroy();else c.release()}
}
