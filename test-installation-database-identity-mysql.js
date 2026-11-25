// Isolated GitHub-hosted MySQL rehearsal using connection-local temporary
// tables only. No writes to persistent installation tables or production data.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,realpath,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import mysql from 'mysql2/promise';
import {initializeLocalInstallationIdentity} from './scripts/installation-identity-store-posix.mjs';
import {bindFreshDatabaseIdentity,assertDatabaseIdentity} from './installation-database-identity.js';
const env=process.env;
if(env.GITHUB_ACTIONS!=='true'||env.RUNNER_ENVIRONMENT!=='github-hosted'||env.AADITECH_BOUND_DB_REHEARSAL!=='isolated-ci'||
 env.NODE_ENV!=='test'||env.DB_HOST!=='127.0.0.1'||env.DB_NAME!=='it_toolkit')throw Error('ISOLATED_CI_REQUIRED');
const root=await mkdtemp(join(await realpath(tmpdir()),'bound-db-'));
let c;
try{
 const dir=join(root,'identity');await mkdir(dir,{mode:0o700});
 const identity=await initializeLocalInstallationIdentity({confirmation:'INITIALIZE_EMPTY_IDENTITY_STORE_ONLY',directoryPath:dir,observed:{database:'absent',credentials:'absent',service:'absent'}});
 const policy={confirmation:'INSPECT_PINNED_IDENTITY_STORE_ONLY',directoryPath:dir,expectedInstallationId:identity.installation_id,expectedIdentitySha256:identity.identity_sha256};
 c=await mysql.createConnection({host:env.DB_HOST,port:Number(env.DB_PORT),user:env.DB_USER,password:env.DB_PASSWORD,database:env.DB_NAME});
 const ddl=await readFile(new URL('./database/migrations/021_installation_database_identity.sql',import.meta.url),'utf8');
 await c.query(ddl.replace('CREATE TABLE IF NOT EXISTS','CREATE TEMPORARY TABLE'));
 for(const table of ['devices','troubleshooting_incidents','troubleshooting_diagnostic_plans','troubleshooting_employee_bindings'])await c.query('CREATE TEMPORARY TABLE '+table+' (id INT PRIMARY KEY) ENGINE=InnoDB');
 const confirmation='BIND_EMPTY_DATABASE_TO_PINNED_IDENTITY_ONLY';
 await assert.rejects(()=>assertDatabaseIdentity(c,policy));
 await c.query('INSERT INTO devices VALUES (1)');
 await assert.rejects(()=>bindFreshDatabaseIdentity(c,policy,confirmation));
 await c.query('DELETE FROM devices WHERE id=1');
 assert.equal((await bindFreshDatabaseIdentity(c,policy,confirmation)).created,true);
 assert.equal(await assertDatabaseIdentity(c,policy),identity.installation_id);
 assert.equal((await bindFreshDatabaseIdentity(c,policy,confirmation)).created,false);
 await assert.rejects(()=>assertDatabaseIdentity(c,{...policy,expectedIdentitySha256:'f'.repeat(64)}));
 await c.query('UPDATE installation_database_identity SET identity_sha256=? WHERE singleton_id=1',['e'.repeat(64)]);
 await assert.rejects(()=>assertDatabaseIdentity(c,policy));
 await assert.rejects(()=>bindFreshDatabaseIdentity(c,policy,confirmation));
 console.log('PASS: real MySQL temporary-table binding, occupied denial, idempotence and mismatch refusal; no persistent database changed.');
}finally{if(c)await c.end();await rm(root,{recursive:true,force:true})}
