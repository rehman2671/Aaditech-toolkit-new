import {describe,it,expect} from 'vitest';
import {mkdtempSync,readFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {populateAppSecrets,REQUIRED_SECRETS}=require('../../Enterprise/deploy/bootstrap-secrets.cjs');
describe('First-run persistent secrets',()=>{
 it('generates six strong values once and reuses them across restart',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aaditech-secret-'));
  try{
   const first={};expect(populateAppSecrets({dataDir:dir,env:first})).toBe(6);
   const second={};populateAppSecrets({dataDir:dir,env:second});
   expect(second).toEqual(first);
   expect(new Set(Object.values(first)).size).toBe(6);
   for(const name of REQUIRED_SECRETS){
    expect(first[name].length).toBeGreaterThanOrEqual(64);
    const p=join(dir,'generated-'+name.toLowerCase());
    expect(readFileSync(p,'utf8').trim()).toBe(first[name]);
    if(process.platform!=='win32')expect(statSync(p).mode & 0o077).toBe(0);
   }
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
 it('refuses hardcoded placeholder secrets',()=>{
  const dir=mkdtempSync(join(tmpdir(),'aaditech-secret-'));
  try{expect(()=>populateAppSecrets({dataDir:dir,env:{JWT_SECRET:'change-me'}})).toThrow();}
  finally{rmSync(dir,{recursive:true,force:true});}
 });
});
