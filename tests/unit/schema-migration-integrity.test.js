import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {planMigrationHistory as plan} from '../../schema-migration-integrity.js';
const files=[{name:'001_init.sql',sql:'SELECT 1;'},{name:'002_next.sql',sql:'SELECT 2;'}];
const row=f=>({version:f.name.slice(0,3),name:f.name,checksum:createHash('sha256').update(f.sql).digest('hex')});
describe('migration history preflight',()=>{
 it('orders pending files and validates the complete prior prefix',()=>{
  expect(plan([...files].reverse(),[row(files[0])]).pending.map(f=>f.name)).toEqual(['002_next.sql']);
  expect(plan(files,files.map(row)).pending).toHaveLength(0);
 });
 it('rejects changed bytes, missing checksums, names and unknown versions',()=>{
  for(const patch of [{checksum:null},{checksum:'a'.repeat(64)},{name:'001_wrong.sql'},{version:'999'}])
   expect(()=>plan(files,[{...row(files[0]),...patch}])).toThrow('MIGRATION_HISTORY_DRIFT');
  expect(()=>plan(files,[row(files[1])])).toThrow('MIGRATION_HISTORY_GAP');
  expect(()=>plan(files,[row(files[0]),row(files[0])])).toThrow('MIGRATION_HISTORY_INVALID');
 });
 it('rejects duplicate or missing migration versions',()=>{
  for(const bad of [[],[files[1]],[files[0],files[0]],[{...files[0],sql:''}]])expect(()=>plan(bad,[])).toThrow();
 });
});
