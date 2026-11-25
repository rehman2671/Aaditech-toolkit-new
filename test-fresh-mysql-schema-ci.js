// CI-only persistent fresh database, distinct from API fixture schema.
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import {mkdtemp,mkdir,rm,realpath,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {staged} from './tests/fixtures/signed-offline-oci-fixture.mjs';
import {initializeLocalInstallationIdentity} from './scripts/installation-identity-store-posix.mjs';
import {completeInitialSetup,readPersistentSetupStatus} from './initial-setup-transaction.js';
import bcrypt from 'bcryptjs';
import {initializeFreshMySqlSchema} from './scripts/initialize-fresh-mysql-schema.mjs';
const e=process.env;
if(e.GITHUB_ACTIONS!=='true'||e.RUNNER_ENVIRONMENT!=='github-hosted'||e.AADITECH_FRESH_SCHEMA_REHEARSAL!=='isolated-ci'||e.NODE_ENV!=='test'||e.DB_HOST!=='127.0.0.1'||e.DB_PORT!=='3306'||!/^\d{1,20}$/.test(e.GITHUB_RUN_ID??'')||!e.DB_ROOT_PASSWORD)throw Error('ISOLATED_CI_REQUIRED');
const db='itk_fresh_'+e.GITHUB_RUN_ID,root=await mkdtemp(join(await realpath(tmpdir()),'fresh-mysql-'));
let admin,conn,created=false;
const options={host:'127.0.0.1',port:3306,user:'root',password:e.DB_ROOT_PASSWORD,connectTimeout:10000,multipleStatements:true};
try{
 admin=await mysql.createConnection(options);
 const [prior]=await admin.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',[db]);assert.equal(prior.length,0);
 await admin.query('CREATE DATABASE `'+db+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');created=true;
 const directoryPath=join(root,'identity');await mkdir(directoryPath,{mode:0o700});
 const identity=await initializeLocalInstallationIdentity({confirmation:'INITIALIZE_EMPTY_IDENTITY_STORE_ONLY',directoryPath,observed:{database:'absent',credentials:'absent',service:'absent'}});
 const pins={confirmation:'INSPECT_PINNED_IDENTITY_STORE_ONLY',directoryPath,expectedInstallationId:identity.installation_id,expectedIdentitySha256:identity.identity_sha256};
 const files=new Map();for(const f of (await readdir(new URL('./database/migrations/',import.meta.url))).filter(x=>x.endsWith('.sql')).sort())files.set('database/migrations/'+f,await readFile(new URL('./database/migrations/'+f,import.meta.url)));
 await staged(async({input})=>{
  const {architecture,...release}=input;const policy={confirmation:'INITIALIZE_EMPTY_MYSQL_SCHEMA_ONLY_EXCLUSIVE_WRITER_CUSTODY',databaseName:db,release:{...release,confirmation:'ADMIT_SIGNED_FRESH_MYSQL_MIGRATIONS_ONLY'},identity:pins};
  const lock={held:true};const guard=async()=>assert.equal(lock.held,true);
  conn=await mysql.createConnection({...options,database:db});
  const result=await initializeFreshMySqlSchema(conn,policy,guard);
  assert.equal(result.migrations_applied,24);assert.equal(result.clean_schema_verified,true);assert.equal(result.bootstrap_ready,true);assert.equal(result.database_binding_verified,true);
  const [[row]]=await conn.query('SELECT installation_id,identity_sha256 FROM installation_database_identity');assert.equal(row.installation_id,identity.installation_id);assert.equal(row.identity_sha256,identity.identity_sha256);
  for(const table of ['users','devices','companies','tenants','user_workspace_memberships','remediation_policies']){const [[r]]=await conn.query('SELECT COUNT(*) AS n FROM '+table);assert.equal(Number(r.n),0)}
  const pool={query:(...a)=>conn.query(...a),getConnection:async()=>({query:(...a)=>conn.query(...a),beginTransaction:()=>conn.beginTransaction(),commit:()=>conn.commit(),rollback:()=>conn.rollback(),release:()=>{},destroy:()=>conn.destroy()})};
  const dbApi={isMysqlConnected:()=>true,getPool:()=>pool};
  assert.equal((await readPersistentSetupStatus(dbApi)).bootstrap_profile,'clean_install_v1');
  const body={server_host:'fixture.example.com',admin_username:'fixture-admin',admin_email:'fixture-admin@example.com',company_name:'Fresh CI Workspace',branding:{color:'#123456',logo_text:'Fresh CI'},build_mode:'manual'};
  const passwordHash=await bcrypt.hash('disposable-ci-password-42',10);
  await assert.rejects(()=>completeInitialSetup(dbApi,{body,configuredHost:body.server_host,passwordHash}));
  assert.equal((await readPersistentSetupStatus(dbApi)).setup_complete,false);
  const setup={body,configuredHost:body.server_host,passwordHash,freshIdentityPolicy:pins};
  const adminResult=await completeInitialSetup(dbApi,setup);
  assert.notEqual(adminResult.admin.tenant_id,'00000000-0000-0000-0000-000000000001');
  assert.equal(adminResult.admin.email,body.admin_email);assert.equal(adminResult.admin.role,'SUPER_ADMIN');
  assert.equal((await readPersistentSetupStatus(dbApi)).setup_complete,true);
  await assert.rejects(()=>completeInitialSetup(dbApi,setup));
  const [[newUser]]=await conn.query('SELECT username,email,password_hash FROM users');assert.equal(newUser.username,body.admin_username);assert.equal(newUser.password_hash,passwordHash);
  await conn.end();conn=undefined;
  conn=await mysql.createConnection({...options,database:db});
  await assert.rejects(()=>initializeFreshMySqlSchema(conn,policy,guard));conn=undefined;
  const [[n]]=await admin.query('SELECT COUNT(*) AS n FROM `'+db+'`.schema_migrations');assert.equal(Number(n.n),24);
  console.log('PASS: signed 24-migration fresh schema, exact factory seed removal, persistent identity and occupied refusal; no application activation.');
 },null,files);
}finally{if(conn)conn.destroy();if(admin){try{if(created)await admin.query('DROP DATABASE `'+db+'`')}finally{await admin.end()}}await rm(root,{recursive:true,force:true})}
