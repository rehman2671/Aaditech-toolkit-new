'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {join}=require('node:path');
const {REQUIRED_CHECKS,GH_APP_ID,evaluate}=require('../../scripts/check-phase-n71-live-main-protection.cjs');
const {buildMainRuleset,validateProposal,REPO}=require('../../scripts/build-phase-n72-main-ruleset.cjs');
const script=join(__dirname,'../../scripts/build-phase-n72-main-ruleset.cjs');
const SHA='a'.repeat(40);
function snapshot(rule){
  return {repository:{full_name:REPO,default_branch:'main'},
    branch:{name:'main',protected:true,commit:{sha:SHA}},rulesets:[rule]};
}
function reject(title,mutate){
  test(title,()=>{
    const proposal=buildMainRuleset();
    mutate(proposal);
    assert.equal(evaluate(snapshot(proposal),SHA,REPO).allowed,false);
    assert.throws(()=>validateProposal(proposal),/N72/);
  });
}
test('N72 main ruleset template is exact and accepted by N71 simulated live gate',()=>{
  const p=buildMainRuleset();
  assert.equal(validateProposal(p),true);
  assert.equal(evaluate(snapshot(p),SHA,REPO).allowed,true);
  assert.deepEqual(p.rules[3].parameters.required_status_checks,
    REQUIRED_CHECKS.map(context=>({context,integration_id:GH_APP_ID})));
  assert.deepEqual(p.conditions.ref_name,{include:['refs/heads/main'],exclude:[]});
});
test('N72 generator does not require secrets, network or mutate GitHub',()=>{
  const result=spawnSync(process.execPath,[script,'--json'],{
    encoding:'utf8',timeout:10000,
    env:{PATH:process.env.PATH,HOME:process.env.HOME}
  });
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),buildMainRuleset());
  const fail=spawnSync(process.execPath,[script,'--apply'],{encoding:'utf8',timeout:10000});
  assert.notEqual(fail.status,0);
  assert.match(fail.stderr,/No GitHub settings changed/);
});
reject('N72 cannot create monitoring-only instead of active ruleset',p=>p.enforcement='evaluate');
reject('N72 cannot exclude main',p=>p.conditions.ref_name.exclude.push('refs/heads/main'));
reject('N72 cannot target another branch',p=>p.conditions.ref_name.include[0]='refs/heads/dev');
reject('N72 cannot grant bypass actor',p=>p.bypass_actors.push({actor_type:'RepositoryRole',actor_id:5}));
reject('N72 cannot omit independent reviewer',p=>p.rules[2].parameters.required_approving_review_count=0);
reject('N72 cannot reuse stale human approval',p=>p.rules[2].parameters.dismiss_stale_reviews_on_push=false);
reject('N72 cannot skip latest-push reviewer',p=>p.rules[2].parameters.require_last_push_approval=false);
reject('N72 cannot skip resolution',p=>p.rules[2].parameters.required_review_thread_resolution=false);
reject('N72 cannot permit force-push',p=>p.rules.shift());
reject('N72 cannot permit branch deletion',p=>p.rules.splice(1,1));
reject('N72 cannot loosen strict up-to-date status policy',p=>p.rules[3].parameters.strict_required_status_checks_policy=false);
reject('N72 cannot silently omit one status check',p=>p.rules[3].parameters.required_status_checks.pop());
reject('N72 cannot attribute status to untrusted app',p=>p.rules[3].parameters.required_status_checks[0].integration_id=12);
test('N72 does not accept an extra unexpected setting',()=>{
  const p=buildMainRuleset();p.unreviewed_extra=true;
  assert.throws(()=>validateProposal(p),/N72/);
});
