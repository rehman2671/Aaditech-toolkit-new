'use strict';
// N73 offline regression: no GitHub token, network or administration mutation.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readLiveSnapshot, evaluate, REQUIRED_CHECKS, GH_APP_ID} =
  require('../../scripts/check-phase-n71-live-main-protection.cjs');
const REPO='rehman2671/Aaditech-toolkit-new', SHA='a'.repeat(40);
function mainRule(id, bypass=[]) {
  return {id, target:'branch', enforcement:'active', bypass_actors:bypass,
    conditions:{ref_name:{include:['refs/heads/main'],exclude:[]}},
    rules:[
      {type:'non_fast_forward'}, {type:'deletion'},
      {type:'pull_request',parameters:{
        required_approving_review_count:1,
        dismiss_stale_reviews_on_push:true,require_last_push_approval:true,
        required_review_thread_resolution:true
      }},
      {type:'required_status_checks',parameters:{
        strict_required_status_checks_policy:true,
        required_status_checks:REQUIRED_CHECKS.map(context=>({context,integration_id:GH_APP_ID}))
      }}
    ]};
}
function fakeRequest(pages, details={}, errors={}) {
  const calls=[];
  const get=async path=>{
    calls.push(path);
    if (errors[path]) throw Error('HTTP 403');
    if (path===`/repos/${REPO}`) return {full_name:REPO,default_branch:'main'};
    if (path===`/repos/${REPO}/branches/main`)
      return {name:'main',protected:true,commit:{sha:SHA}};
    if (path.includes('/rulesets?')) {
      const u=new URL('https://api.github.com'+path);
      assert.equal(u.searchParams.get('includes_parents'),'true');
      assert.equal(u.searchParams.get('per_page'),'100');
      return pages[Number(u.searchParams.get('page'))-1] || [];
    }
    const match=path.match(/\/rulesets\/(\d+)$/);
    if (match) return details[Number(match[1])] || {id:Number(match[1]),target:'tag'};
    throw Error('Unexpected GitHub API request: '+path);
  };
  return {get,calls};
}
test('N73 enumerates a second page and rejects hidden active main bypass',async()=>{
  const first=Array.from({length:100},(_,i)=>({id:i+1}));
  const next=[{id:101}], main=mainRule(1);
  const fake=fakeRequest([first,next],{
    1:main,101:mainRule(101,[{actor_id:5,actor_type:'RepositoryRole'}])
  });
  const snapshot=await readLiveSnapshot(REPO,'no-real-token',fake.get);
  assert.equal(snapshot.rulesets.length,101);
  assert.ok(fake.calls.some(path=>path.includes('page=2')));
  assert.equal(evaluate(snapshot,SHA,REPO).allowed,false);
  assert.match(evaluate(snapshot,SHA,REPO).blockers.join(';'),/bypass/);
});
test('N73 rejects duplicate across pages even before policy fetch',async()=>{
  const first=Array.from({length:100},(_,i)=>({id:i+1}));
  const fake=fakeRequest([first,[{id:1}]]);
  await assert.rejects(readLiveSnapshot(REPO,'none',fake.get),/duplicate/);
  assert.equal(fake.calls.some(s=>s.endsWith('/rulesets/1')),false);
});
test('N73 rejects malformed, oversized, unsafe and repeated identifiers',async()=>{
  for(const page of [[{id:'1'}],[{id:0}],[{id:1},{id:1}],{},Array.from({length:101},(_,i)=>({id:i+1}))]){
    await assert.rejects(readLiveSnapshot(REPO,'none',fakeRequest([page]).get),/N73/);
  }
});
test('N73 refuses inconsistent detailed ruleset identity',async()=>{
  const fake=fakeRequest([[{id:41}]],{41:mainRule(42)});
  await assert.rejects(readLiveSnapshot(REPO,'none',fake.get),/do not match/);
});
test('N73 refuses partial GitHub page failures and excessive rule-count',async()=>{
  const first=Array.from({length:100},(_,i)=>({id:i+1}));
  const page2=`/repos/${REPO}/rulesets?includes_parents=true&per_page=100&page=2`;
  await assert.rejects(readLiveSnapshot(REPO,'none',fakeRequest([first],{}, {[page2]:true}).get),/HTTP 403/);
  const many=Array.from({length:10},(_,n)=>
    Array.from({length:100},(_,i)=>({id:n*100+i+1})));
  await assert.rejects(readLiveSnapshot(REPO,'none',fakeRequest(many).get),/page limit exceeded/);
});
test('N73 still accepts a complete single-page proof with unchanged N71 checks',async()=>{
  const rule=mainRule(7);
  const fake=fakeRequest([[{id:7}]],{7:rule});
  const snapshot=await readLiveSnapshot(REPO,'none',fake.get);
  assert.equal(snapshot.rulesets.length,1);
  assert.equal(evaluate(snapshot,SHA,REPO).allowed,true);
});

test('N73 refuses wildcards and additional excluded main rulesets with bypass actors',()=>{
  const {mainTarget}=require('../../scripts/check-phase-n71-live-main-protection.cjs');
  for(const pattern of ['refs/heads/*','refs/heads/m*','refs/heads/m[ai]in','~UNRECOGNIZED']) {
    const extra=mainRule(8,[{actor_type:'RepositoryRole',actor_id:5}]);
    extra.conditions.ref_name.include=[pattern];
    assert.equal(mainTarget(extra),true,pattern);
    const s={repository:{full_name:REPO,default_branch:'main'},
      branch:{name:'main',protected:true,commit:{sha:SHA}},
      rulesets:[mainRule(7),extra]};
    assert.equal(evaluate(s,SHA,REPO).allowed,false,pattern);
  }
  const excluded=mainRule(8);
  excluded.conditions.ref_name.exclude=['refs/heads/release/*'];
  const s={repository:{full_name:REPO,default_branch:'main'},
    branch:{name:'main',protected:true,commit:{sha:SHA}},
    rulesets:[mainRule(7),excluded]};
  assert.equal(evaluate(s,SHA,REPO).allowed,false);
  assert.match(evaluate(s,SHA,REPO).blockers.join(';'),/exclusions/);
});
test('N73 rejects malformed additional active rule even beside valid main policy',()=>{
  for(const broken of [
    {id:8,enforcement:'active',target:'branch',conditions:{}},
    {id:8,enforcement:'active',target:'branch',
      conditions:{ref_name:{include:[null],exclude:[]}}},
    {id:8,enforcement:'active',target:'branch',
      conditions:{ref_name:{include:['refs/heads/main'],exclude:[4]}}}
  ]){
    const s={repository:{full_name:REPO,default_branch:'main'},
      branch:{name:'main',protected:true,commit:{sha:SHA}},
      rulesets:[mainRule(7),broken]};
    assert.equal(evaluate(s,SHA,REPO).allowed,false);
    assert.match(evaluate(s,SHA,REPO).blockers.join(';'),/unverifiable/);
  }
});
