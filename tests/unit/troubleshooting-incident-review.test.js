import {describe,it,expect,vi} from 'vitest';
import {allowedReviewTransitions,listIncidentReviews,listEmployeeIncidentReviews,transitionIncidentReview} from '../../troubleshooting-incident-review.js';
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const principal={id:1,role:'SUPER_ADMIN',tenant_id:id(1)},installationId=id(2),deviceId=id(3),incidentId=id(4),requestId=id(5);
const incident={incident_id:incidentId,installation_id:installationId,tenant_id:principal.tenant_id,device_id:deviceId,actor_user_id:2,category_id:'TR-01',hazard:'NONE',status:'OPEN'};
const input={principal,installationId,deviceId,incidentId,requestId,expectedRevision:0,nextState:'IN_REVIEW',confirmation:'CONFIRM_HUMAN_REVIEW_ONLY'};
function fixture({row,events=[],inc=[incident],listed=[incident],writes=1,role='SUPER_ADMIN',actor=1}={}){
 const c={beginTransaction:vi.fn(),commit:vi.fn(),rollback:vi.fn(),release:vi.fn(),destroy:vi.fn(),query:vi.fn(async(sql)=>{
  if(sql.includes('FROM users'))return [[{id:actor,role,tenant_id:principal.tenant_id,active:1,status:'ACTIVE'}]];
  if(sql.includes('LEFT JOIN'))return [listed];
  if(sql.includes('FROM troubleshooting_incident_review_events'))return [events];
  if(sql.includes('FROM troubleshooting_incident_reviews'))return [row?[row]:[]];
  if(sql.includes('FROM troubleshooting_incidents'))return [inc];
  if(sql.includes('FROM devices'))return [[{id:deviceId}]];
  if(sql.startsWith('INSERT')||sql.startsWith('UPDATE'))return [{affectedRows:writes}];
  throw Error(sql);
 })};return {c,pool:{getConnection:async()=>c}};
}
describe('human review lifecycle only',()=>{
 it('never allows a resolved state, and preserves escalations',()=>{
  expect(allowedReviewTransitions('UNREVIEWED','OPEN')).toEqual(['IN_REVIEW','REFERRED']);
  expect(allowedReviewTransitions('IN_REVIEW','ESCALATED')).toEqual(['REFERRED']);
  expect(allowedReviewTransitions('REFERRED','OPEN')).toEqual(['REOPENED']);
  expect(()=>allowedReviewTransitions('RESOLVED','OPEN')).toThrow('REVIEW_INVALID');
 });
 it('lists employee-origin reports for the active tenant admin without claiming outcomes',async()=>{
  const f=fixture();const r=await listIncidentReviews(f.pool,{principal,installationId,category:'TR-01',deviceId});
  expect(r.items[0]).toMatchObject({incident_id:incidentId,review_state:'UNREVIEWED',revision:0,verified_resolved:false});
  expect(f.c.query.mock.calls[1][1]).toEqual([installationId,principal.tenant_id,deviceId,'TR-01']);
 });
 it('rejects a foreign or malformed row rather than leaking it',async()=>{
  const f=fixture({listed:[{...incident,tenant_id:id(9)}]});await expect(listIncidentReviews(f.pool,{principal,installationId})).rejects.toThrow();expect(f.c.rollback).toHaveBeenCalledOnce();
 });
 it('requires persisted employee role and own active-assignment query',async()=>{
  const f=fixture({role:'MONITORING',actor:2});const r=await listEmployeeIncidentReviews(f.pool,{principal:{...principal,id:2,role:'MONITORING'},installationId});
  expect(r.items[0]).not.toHaveProperty('allowed_transitions');expect(f.c.query.mock.calls[1][0]).toContain("b.state='ACTIVE'");
 });
 it('records a review, immutable event and audit in one transaction',async()=>{
  const f=fixture();const r=await transitionIncidentReview(f.pool,input);expect(r).toMatchObject({review_state:'IN_REVIEW',revision:1,verified_resolved:false});expect(f.c.commit).toHaveBeenCalledOnce();
  expect(f.c.query.mock.calls.filter(([q])=>q.startsWith('INSERT'))).toHaveLength(3);
 });
 it('denies stale revision, unknown incident and failed writes',async()=>{
  for(const [f,patch] of [[fixture(),{expectedRevision:2}],[fixture({inc:[]}),{}],[fixture({writes:0}),{}]]){await expect(transitionIncidentReview(f.pool,{...input,...patch})).rejects.toThrow();expect(f.c.commit).not.toHaveBeenCalled();expect(f.c.rollback).toHaveBeenCalledOnce()}
 });
 it('exact replay returns prior receipt and rejects changed semantics',async()=>{
  const row={incident_id:incidentId,installation_id:installationId,tenant_id:principal.tenant_id,device_id:deviceId,review_state:'IN_REVIEW',revision:1};
  const event={...row,event_id:id(6),request_id:requestId,actor_user_id:1,previous_state:'UNREVIEWED',next_state:'IN_REVIEW'};
  const f=fixture({row,events:[event]});expect(await transitionIncidentReview(f.pool,input)).toMatchObject({duplicate:true,event_id:id(6),current_revision:1});expect(f.c.query.mock.calls.every(([q])=>q.startsWith('SELECT'))).toBe(true);
  await expect(transitionIncidentReview(f.pool,{...input,nextState:'REFERRED'})).rejects.toThrow('REVIEW_CONFLICT');
 });
});
