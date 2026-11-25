import {describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {patchRuntimeEnvironment,prepareRuntimeConfiguration} from '../../scripts/prepare-runtime-configuration.mjs';
const source='SERVER_HOST=old.example.com\nCADDY_HOST=old.example.com\nDB_PASSWORD=private-value\n';
const changes={serverHost:'new.example.com'};
describe('local runtime configuration candidate',()=>{
 it('updates both compose host settings without modifying other lines',()=>{
  expect(patchRuntimeEnvironment(source,'compose',changes).text).toBe('SERVER_HOST=new.example.com\nCADDY_HOST=new.example.com\nDB_PASSWORD=private-value\n');
 });
 it('validates node profile and leaves DB credentials untouched',()=>{
  const r=patchRuntimeEnvironment('SERVER_HOST=old.example.com\nPORT=3000\nDB_HOST=localhost\nDB_PORT=3306\nDB_NAME=old\nDB_PASSWORD=secret\n','node',{serverHost:'new.example.com',port:4000,dbHost:'mysql',dbPort:3306,dbName:'new_db'});
  expect(r.text).toContain('DB_PASSWORD=secret\n');expect(r.text).toContain('DB_NAME=new_db\n');
 });
 it('rejects duplicate, multiline, missing keys, bad host and secret fields',()=>{
  for(const [s,c] of [[source+'SERVER_HOST=other\n',changes],[source+'X="multiline\nSERVER_HOST=bad"\n',changes],['SERVER_HOST=x\n',changes],[source,{serverHost:'https://host.example.com'}],[source,{...changes,DB_PASSWORD:'new'}]])expect(()=>patchRuntimeEnvironment(s,'compose',c)).toThrow();
 });
 it.skipIf(process.platform!=='linux')('publishes a private candidate without replacing active config',async()=>{
  const root=await mkdtemp(join(await realpath(tmpdir()),'runtime-config-'));
  try{const activePath=join(root,'.env'),lockRoot=join(root,'lock');await mkdir(lockRoot,{mode:0o700});await writeFile(activePath,source,{mode:0o600});
   const r=await prepareRuntimeConfiguration({confirmation:'PREPARE_RUNTIME_CONFIGURATION_CANDIDATE_ONLY',profile:'compose',activePath,expectedActiveSha256:createHash('sha256').update(source).digest('hex'),lockRoot,changes});
   expect(r.active_configuration_changed).toBe(false);expect(JSON.stringify(r)).not.toContain('private-value');expect(await readFile(activePath,'utf8')).toBe(source);expect(await readFile(join(root,'.env.candidate'),'utf8')).toContain('SERVER_HOST=new.example.com');
  }finally{await rm(root,{recursive:true,force:true})}
 });
});

it('rejects invalid active pin and noncanonical paths before touching files',async()=>{
 const x={confirmation:'PREPARE_RUNTIME_CONFIGURATION_CANDIDATE_ONLY',profile:'compose',activePath:'/private/.env',expectedActiveSha256:'a'.repeat(64),lockRoot:'/private/lock',changes};
 for(const patch of [{expectedActiveSha256:'0'.repeat(64)},{expectedActiveSha256:'a'.repeat(64)+'\n'},{expectedActiveSha256:['a'.repeat(64)]},{activePath:'/private/../.env'},{lockRoot:'/private/lock\n'},{changes:null}])await expect(prepareRuntimeConfiguration({...x,...patch})).rejects.toThrow();
});
