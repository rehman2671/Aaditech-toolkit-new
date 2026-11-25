// Verify complete release history BEFORE any pending migration is executed.
import {createHash} from 'node:crypto';
const fail=code=>{throw Error(code)};
export function planMigrationHistory(files,rows){
 if(!Array.isArray(files)||!files.length||files.length>999||!Array.isArray(rows))fail('MIGRATION_HISTORY_INVALID');
 if(files.some(file=>!file||typeof file.name!=='string'||/[\r\n]/.test(file.name)||typeof file.sql!=='string'))fail('MIGRATION_SEQUENCE_INVALID');
 const sorted=[...files].sort((a,b)=>a.name.localeCompare(b.name,'en'));
 const plan=sorted.map((file,i)=>{
  const prefix=String(i+1).padStart(3,'0');
  if(typeof file.name!=='string'||!new RegExp('^'+prefix+'_[a-z0-9_]+\\.sql$').test(file.name)||
    typeof file.sql!=='string'||!file.sql.trim())fail('MIGRATION_SEQUENCE_INVALID');
  return Object.freeze({version:prefix,name:file.name,sql:file.sql,
    checksum:createHash('sha256').update(file.sql,'utf8').digest('hex')});
 });
 const history=new Map();
 for(const row of rows){
  if(!row||typeof row.version!=='string'||row.version.length!==3||history.has(row.version))fail('MIGRATION_HISTORY_INVALID');
  const expected=plan.find(f=>f.version===row.version);
  if(!expected||row.name!==expected.name||row.checksum!==expected.checksum)fail('MIGRATION_HISTORY_DRIFT');
  history.set(row.version,row);
 }
 if(plan.slice(0,history.size).some(f=>!history.has(f.version)))fail('MIGRATION_HISTORY_GAP');
 return Object.freeze({applied:Object.freeze(plan.slice(0,history.size)),pending:Object.freeze(plan.slice(history.size))});
}
