import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const files=['configuration.js','troubleshooting-report.js','troubleshooting-review.js','diagnostic-consent.js','hazard-assessment.js','device-observations.js'];
const source=f=>readFileSync(new URL('../../Enterprise/portal/'+f,import.meta.url),'utf8');
const id='11111111-1111-1111-1111-111111111111';
describe('portal session changes while decoding JSON',()=>{
 for(const file of files)it(file+' does not start another network operation with the replaced session',async()=>{
  const elements=new Map();const el=id=>{if(!elements.has(id))elements.set(id,{hidden:true,disabled:false,value:'',addEventListener(){},replaceChildren(){},querySelectorAll(){return []}});return elements.get(id)};
  let token='original',calls=0,release;const payload=new Promise(resolve=>{release=resolve});
  runInNewContext(source(file),{document:{getElementById:el},localStorage:{getItem:()=>token},location:{search:'?incidentId='+id+'&deviceId='+id},URLSearchParams,window:{addEventListener(){}},fetch:async()=>{calls++;return {ok:true,json:()=>payload}}});
  await new Promise(resolve=>setImmediate(resolve));expect(calls).toBe(1);
  token='replacement';release({role:'SUPER_ADMIN',incident_id:id,device_id:id});
  await new Promise(resolve=>setImmediate(resolve));expect(calls).toBe(1);
  for(const panel of ['assignment-panel','review-panel','consent-panel','hazard-panel','workspace-config','observation-results'])expect(el(panel).hidden).toBe(true);
 });
 it('keeps consent and plan requests mutually exclusive and checks exact receipt',()=>{
  const s=source('diagnostic-consent.js');
  expect(s).toContain('busy||pending||planBusy||planPending');
  expect(s).toContain("r.state!=='PLANNED_ONLY'||typeof r.duplicate!=='boolean'");
  expect(s).toContain('r.revision<pending.expectedRevision+1');
  expect(s).toContain('current=null;');
 });
 it('clears stale review and observation cards on conflict',()=>{
  expect(source('troubleshooting-review.js')).toContain("pending=null;cursor=null;el('review-list').replaceChildren()");
  expect(source('device-observations.js')).toContain("pending=null;items=[];cursor=null;el('observation-list').replaceChildren()");
 });
});
