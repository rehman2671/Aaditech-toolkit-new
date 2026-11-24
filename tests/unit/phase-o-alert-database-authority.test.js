import {afterEach,describe,expect,it,vi} from 'vitest';
import * as db from '../../db.js';
const saved=process.env.NODE_ENV;
afterEach(()=>{
 db.setConnectionStateForTesting(false,null);db.invalidateAlertRulesCache();
 if(saved===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=saved;
});
function use(query){
 process.env.NODE_ENV='production';db.invalidateAlertRulesCache();
 db.setConnectionStateForTesting(true,{query});
}
describe('Phase O database rule and notification lease authority',()=>{
 it('never reuses local rule cache across deployed calls',async()=>{
  const query=vi.fn().mockResolvedValueOnce([[{id:'a',enabled:1}],[]]).mockResolvedValueOnce([[{id:'a',enabled:0}],[]]);
  use(query);
  expect((await db.getAlertRules())[0].enabled).toBe(true);
  expect((await db.getAlertRules())[0].enabled).toBe(false);
  expect(query).toHaveBeenCalledTimes(2);
 });
 for(const [i,enabled] of [0,2,-1,'0','1','false','true',null,undefined,{},[]].entries())
  it('refuses ambiguous persisted enablement '+i,async()=>{
   const query=vi.fn(async()=>[[{id:'a',name:'rule-a',enabled}],[]]);use(query);
   expect((await db.getAlertRules())[0].enabled).toBe(false);
   expect((await db.getAlertRuleById('a')).enabled).toBe(false);
   expect((await db.getAlertRuleByName('rule-a')).enabled).toBe(false);
  });
 it('preserves genuine zero threshold and explicit disabled write',async()=>{
  const query=vi.fn(async()=>[{affectedRows:1},[]]);use(query);
  await db.createAlertRule({id:'a',tenant_id:'tenant-A',name:'rule',metric:'disk',threshold:0,enabled:false});
  expect(query.mock.calls[0][1][6]).toBe(0);
  expect(query.mock.calls[0][1][9]).toBe(0);
 });
 for(const [i,enabled] of [0,1,'0','false','true',null,{},[]].entries())
  it('rejects ambiguous rule write '+i,async()=>{
   const query=vi.fn();use(query);
   await expect(db.createAlertRule({enabled})).rejects.toThrow('INVALID_ALERT_RULE_ENABLED');
   await expect(db.updateAlertRule('a',{enabled})).rejects.toThrow('INVALID_ALERT_RULE_ENABLED');
   expect(query).not.toHaveBeenCalled();
  });
 it('uses database time and lease token for completion and retry',async()=>{
  const query=vi.fn(async()=>[{affectedRows:0},[]]);use(query);
  expect(await db.finishNotificationOutbox(1,'lease','DELIVERED')).toBe(false);
  expect(await db.retryNotificationOutbox({id:1,lease_token:'lease',attempts:1})).toBe(false);
  for(const [sql] of query.mock.calls)
   expect(sql).toContain("lease_token = ? AND status = 'PROCESSING' AND lease_expires_at > UTC_TIMESTAMP(3)");
 });
 for(const [i,attempts] of [0,-1,6,1.5,NaN,Infinity,'1',null,undefined,{}].entries())
  it('rejects invalid retry attempt count '+i,async()=>{
   const query=vi.fn();use(query);
   await expect(db.retryNotificationOutbox({id:1,lease_token:'lease',attempts})).rejects.toThrow('INVALID_OUTBOX_ATTEMPTS');
   expect(query).not.toHaveBeenCalled();
  });
 it('bounds error codes and preserves terminal retry state',async()=>{
  const query=vi.fn(async()=>[{affectedRows:1},[]]);use(query);
  expect(await db.retryNotificationOutbox({id:1,lease_token:'lease',attempts:5},'BAD\n')).toBe(true);
  expect(query.mock.calls[0][1]).toEqual(['DEAD',240,'DELIVERY_FAILED',1,'lease']);
 });
});
