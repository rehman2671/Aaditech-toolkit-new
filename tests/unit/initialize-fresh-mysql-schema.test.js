import {it,expect} from 'vitest';
import {selectSignedMigrationEntries as select,verifyFactorySeedRows as seed,validateFreshSchemaRequest as policy,validateFreshMySqlSession as session} from '../../scripts/initialize-fresh-mysql-schema.mjs';
const entries=Array.from({length:24},(_,i)=>({path:'database/migrations/'+String(i+1).padStart(3,'0')+'_fixture.sql',size:10,sha256:'a'.repeat(64)}));
it('requires exactly 24 ordered signed migration entries',()=>expect(select([...entries].reverse()).map(e=>e.path)).toEqual(entries.map(e=>e.path)));
it.each([entries.slice(1),[...entries,entries[0]],entries.map((e,i)=>i===3?{...e,path:'database/migrations/004_../x.sql'}:e),entries.map((e,i)=>i===3?{...e,size:0}:e),entries.map((e,i)=>i===3?{...e,sha256:'0'.repeat(64)}:e)].map(x=>[x]))('refuses missing or malformed signed migration sequence',v=>expect(()=>select(v)).toThrow());
it('checks exact factory identity sets without permitting extra rows',()=>{expect(seed('users',[{id:3},{id:1},{id:2}])).toBe(3);expect(seed('devices',[{id:'1'},{id:'2'},{id:'3'}])).toBe(3)});
it.each([[{id:1},{id:2},{id:4}],[{id:1},{id:2}],[{id:1},{id:2},{id:3},{id:4}],[{id:1},{id:2},{id:2}],[{id:1,x:true},{id:2},{id:3}],Array(3)].map(x=>[x]))('rejects unknown seed rows',rows=>expect(()=>seed('users',rows)).toThrow());
const request={confirmation:'INITIALIZE_EMPTY_MYSQL_SCHEMA_ONLY_EXCLUSIVE_WRITER_CUSTODY',databaseName:'it_toolkit',release:{confirmation:'ADMIT_SIGNED_FRESH_MYSQL_MIGRATIONS_ONLY',stagedDirectory:'/private/stage',trustedManifestSha256:'a'.repeat(64),trustedPublicKeyPem:'fixture',trustedSignerSpkiSha256:'b'.repeat(64)},identity:{confirmation:'INSPECT_PINNED_IDENTITY_STORE_ONLY',directoryPath:'/private/id',expectedInstallationId:'fixture',expectedIdentitySha256:'c'.repeat(64)}};
it('pins the dedicated database, release and identity input',()=>expect(policy(request)).toMatchObject({databaseName:'it_toolkit'}));
it.each([{databaseName:'mysql'},{databaseName:'foreign'},{confirmation:'yes'},{release:{...request.release,extra:true}},{identity:{...request.identity,extra:true}},{extra:true}])('rejects unsafe initialization input %j',patch=>expect(()=>policy({...request,...patch})).toThrow());

const observed={db:'it_toolkit',uuid:'fixture-server',connection_id:7,version:'8.0.44'};
it.each(['8.0.44','8.4.1','8.0.44-commercial','8.0.44-0ubuntu0.24.04.1'])('accepts MySQL 8 session %s',version=>expect(session([{...observed,version}],'it_toolkit')).toMatchObject({version,connection_id:7}));
it('normalizes a numeric string connection ID',()=>expect(session([{...observed,connection_id:'7'}],'it_toolkit')).toEqual(session([observed],'it_toolkit')));
it.each(['8','8x0','8\\x0','8.','8.x','5.7.44','10.11.0-MariaDB','8.0.44-MariaDB',null,8])('rejects invalid engine version %j',version=>expect(()=>session([{...observed,version}],'it_toolkit')).toThrow());
it.each([{db:'mysql'},{uuid:''},{uuid:null},{connection_id:0},{connection_id:-1},{connection_id:1.5},{connection_id:null},{connection_id:true},{connection_id:'NaN'},{connection_id:Infinity}])('rejects invalid session identity %j',patch=>expect(()=>session([{...observed,...patch}],'it_toolkit')).toThrow());
it.each([[],[observed,observed],[null],null].map(x=>[x]))('rejects invalid session observation cardinality',rows=>expect(()=>session(rows,'it_toolkit')).toThrow());
