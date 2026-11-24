import {describe,it,expect} from 'vitest';
import {mkdtemp,writeFile,rm,realpath,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {inspectLanHost,parseLinuxListeningPorts} from '../../scripts/lan-host-preflight.mjs';
describe('read-only LAN host reference checks',()=>{
 it('parses only TCP LISTEN records and fails on malformed rows',()=>{
  const header='sl local_address rem_address st tx_queue';
  const rows='\n 0: 00000000:01BB 00000000:0000 0A 0\n 1: 0100007F:1F90 0100007F:0001 01 0';
  expect([...parseLinuxListeningPorts(header+rows)]).toEqual([443]);
  expect(()=>parseLinuxListeningPorts(header+'\n 0: invalid')).toThrow('UNKNOWN_TCP_TABLE');
 });
 it('checks actual temporary filesystem without reading marker contents or claiming absence',async()=>{
  const dir=await mkdtemp(join(await realpath(tmpdir()),'itk-host-'));
  try {
   const credential=join(dir,'private');
   await writeFile(credential,'SYNTHETIC SECRET');
   const input={targetDirectory:dir,markerPaths:{database:join(dir,'db'),credentials:credential,service:join(dir,'svc')},ports:[443],minCpu:1,minMemoryBytes:1,minFreeBytes:1};
   const result=await inspectLanHost(input);
   expect(result).toMatchObject({decision:'EXTERNAL_APPROVAL_REQUIRED',markers:{database:'NOT_OBSERVED',credentials:'PRESENT',service:'NOT_OBSERVED'},resource_absence_verified:false,installation_authorized:false});
   expect(JSON.stringify(result)).not.toContain('SYNTHETIC');
   expect(JSON.stringify(result)).not.toContain(dir);
   expect(await readFile(credential,'utf8')).toBe('SYNTHETIC SECRET');
   await expect(inspectLanHost({...input,ports:[443,443]})).rejects.toThrow();
   const low=await inspectLanHost({...input,minFreeBytes:Number.MAX_SAFE_INTEGER});
   expect(low.checks.find(c=>c.id==='disk').state).toBe('INSUFFICIENT');
  } finally {await rm(dir,{recursive:true,force:true})}
 });
});
