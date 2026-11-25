import {describe,it,expect} from 'vitest';
import {employeeGuidanceCatalog,getEmployeeGuidance} from '../../troubleshooting-guidance.js';
import {renderOfflineTroubleshootingGuide,runLocalTroubleshootingGuide} from '../../scripts/local-troubleshooting-guide.mjs';
const ids=Array.from({length:26},(_,i)=>'TR-'+String(i+1).padStart(2,'0'));
const humanOnly=new Set(['TR-05','TR-09','TR-11','TR-19','TR-24']);
const hazards=['NONE','UNKNOWN','PHYSICAL_HAZARD','SUSPECTED_COMPROMISE','DATA_LOSS_RISK','BOOT_OR_ENCRYPTION_DAMAGE'];
describe('26-category employee advisory acceptance matrix: 156 cases',()=>{
 for(const id of ids)for(const hazard of hazards){
  it(id+' / '+hazard+' stays advisory and enforces hazard precedence',()=>{
   const r=getEmployeeGuidance({category_id:id,hazard});
   expect(r).toMatchObject({category_id:id,diagnostic_authorized:false,repair_authorized:false,execution_authorized:false,verified_resolved:false,production_accepted:false});
   expect(Object.isFrozen(r)).toBe(true);expect(Object.isFrozen(r.instructions)).toBe(true);
   expect(r.instructions.length).toBeGreaterThan(0);
   expect(typeof r.success_check).toBe('string');
   if(humanOnly.has(id)||!['NONE','UNKNOWN'].includes(hazard)){
    expect(r).toMatchObject({decision:'HUMAN_ONLY',guidance_type:'HUMAN_ONLY'});
    if(id==='TR-24'||hazard==='PHYSICAL_HAZARD')expect(r.instructions.join(' ')).toMatch(/stop use/i);
    else if(hazard==='SUSPECTED_COMPROMISE')expect(r.instructions.join(' ')).toMatch(/security team/i);
    else if(hazard==='DATA_LOSS_RISK')expect(r.instructions.join(' ')).toMatch(/do not delete/i);
    else if(hazard==='BOOT_OR_ENCRYPTION_DAMAGE')expect(r.instructions.join(' ')).toMatch(/do not repeatedly restart/i);
   }else if(hazard==='UNKNOWN'){
    expect(r).toMatchObject({decision:'BLOCKED',guidance_type:'HAZARD_ASSESSMENT',reason:'HAZARD_ASSESSMENT_REQUIRED'});
    expect(r.instructions).toHaveLength(1);
   }else{
    expect(r).toMatchObject({decision:'BLOCKED',guidance_type:'ADVISORY_ONLY',reason:'CONSENT_AND_POLICY_REQUIRED'});
    expect(r.instructions).toHaveLength(3);
   }
  });
 }
});
describe('offline guide presentation and input integrity',()=>{
 it('has one immutable content card and success criterion for each original category',()=>{
  expect(employeeGuidanceCatalog.map(x=>x.id)).toEqual(ids);
  expect(new Set(employeeGuidanceCatalog.map(x=>x.title)).size).toBe(26);
  expect(Object.isFrozen(employeeGuidanceCatalog)).toBe(true);
  for(const card of employeeGuidanceCatalog){expect(Object.isFrozen(card)).toBe(true);expect(Object.isFrozen(card.steps)).toBe(true);expect(card.steps).toHaveLength(3);}
 });
 it('refuses caller consent, repair instructions, unknown inputs and accessors',()=>{
  let read=0;const accessor={get category_id(){read++;return 'TR-01'}};
  for(const x of [null,[],{},Object.create({category_id:'TR-01'}),accessor,
   {category_id:'TR-01',consent_status:'RECORDED'},{category_id:'TR-01',command:'anything'},{category_id:'TR-01',hazard:true},
   {category_id:'TR-99'}])expect(getEmployeeGuidance(x)).toMatchObject({reason:'INVALID_INPUT',execution_authorized:false});
  expect(read).toBe(0);
 });
 it('renders all 26 accessible disclosure cards without scripts, forms or external resources',()=>{
  const html=renderOfflineTroubleshootingGuide();
  expect(html.match(/<details id="TR-/g)).toHaveLength(26);
  for(const id of ids)expect(html).toContain('id="'+id+'"');
  expect(html).toContain('Content-Security-Policy');expect(html).toContain('Safety first');
  expect(html).not.toMatch(/<script|<form|<iframe|<link|https?:\/\//i);
  expect(html).toContain('not consent, diagnosis, approval, repair or verified resolution');
 });
 it('CLI produces only static HTML or categorical JSON and rejects malformed input',()=>{
  expect(runLocalTroubleshootingGuide(['--html'])).toBe(renderOfflineTroubleshootingGuide());
  expect(JSON.parse(runLocalTroubleshootingGuide(['--category','TR-24','--hazard','NONE']))).toMatchObject({guidance_type:'HUMAN_ONLY'});
  for(const args of [[],['--html','extra'],['--category','TR-99','--hazard','NONE'],['--category','TR-01','--hazard','unsafe']])
   expect(()=>runLocalTroubleshootingGuide(args)).toThrow('GUIDE_INPUT_INVALID');
 });
});
