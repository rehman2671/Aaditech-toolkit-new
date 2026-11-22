'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { REQUIRED_CHECKS, GH_APP_ID, evaluate, mainTarget } =
  require('../../scripts/check-phase-n71-live-main-protection.cjs');
const SHA = 'a'.repeat(40), REPO = 'rehman2671/Aaditech-toolkit-new';
function sample() {
  return {
    repository: { full_name: REPO, default_branch: 'main' },
    branch: { name: 'main', protected: true, commit: { sha: SHA } },
    rulesets: [{ target: 'branch', enforcement: 'active', bypass_actors: [],
      conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
      rules: [
        { type: 'non_fast_forward' }, { type: 'deletion' },
        { type: 'pull_request', parameters: { required_approving_review_count: 1,
          dismiss_stale_reviews_on_push: true, require_last_push_approval: true,
          required_review_thread_resolution: true } },
        { type: 'required_status_checks', parameters: {
          strict_required_status_checks_policy: true,
          required_status_checks:
            REQUIRED_CHECKS.map(context => ({ context, integration_id: GH_APP_ID })) } }
      ]
    }]
  };
}
function deny(mutator, reason) {
  const s=sample();mutator(s);const actual=evaluate(s,SHA,REPO);
  assert.equal(actual.allowed,false,reason);assert.ok(actual.blockers.length>0,reason);
}
test('only an active non-bypassable reviewed main and exact workflow source qualifies', () => {
  assert.equal(evaluate(sample(),SHA,REPO).allowed,true);
  assert.equal(mainTarget(sample().rulesets[0]),true);
});
test('wrong SHA, repository, missing branch and main protection fail closed', () => {
  deny(x=>x.branch.commit.sha='b'.repeat(40),'main moved after dispatch');
  deny(x=>x.branch.protected=false,'unprotected main');
  deny(x=>x.repository.default_branch='develop','default branch changed');
  deny(x=>x.repository.full_name='attacker/other','repo changed');
  deny(x=>delete x.branch.commit,'branch commit absent');
});
test('ruleset exemptions, inactive protection and bypass actors rejected', () => {
  deny(x=>x.rulesets=[],'no rulesets');
  deny(x=>x.rulesets[0].enforcement='disabled','disabled');
  deny(x=>x.rulesets[0].enforcement='evaluate','monitor-only');
  deny(x=>x.rulesets[0].conditions.ref_name.exclude.push('refs/heads/main'),'excluded main');
  deny(x=>x.rulesets[0].conditions.ref_name.exclude.push('refs/heads/*'),'wildcard excludes main');
  deny(x=>x.rulesets[0].bypass_actors.push({actor_id:1}),'admin bypass');
  deny(x=>delete x.rulesets[0].bypass_actors,'unknown bypass');
});
test('force-push deletion and human review guards fail closed', () => {
  deny(x=>x.rulesets[0].rules.splice(0,1),'force pushes');
  deny(x=>x.rulesets[0].rules.splice(1,1),'branch deletion');
  deny(x=>x.rulesets[0].rules[2].parameters.required_approving_review_count=0,'zero reviewers');
  deny(x=>x.rulesets[0].rules[2].parameters.dismiss_stale_reviews_on_push=false,'stale approvals');
  deny(x=>x.rulesets[0].rules[2].parameters.require_last_push_approval=false,'self-push approval');
  deny(x=>x.rulesets[0].rules[2].parameters.required_review_thread_resolution=false,'open discussions');
});
test('untrusted, weak or missing required CI contexts do not authorize signing', () => {
  deny(x=>x.rulesets[0].rules[3].parameters.required_status_checks[0].integration_id=1,'fake CI App');
  deny(x=>x.rulesets[0].rules[3].parameters.required_status_checks.pop(),'missing safety gate');
  deny(x=>x.rulesets[0].rules[3].parameters.required_status_checks[1].context='Build agent exe + MSI','skipped status');
  deny(x=>x.rulesets[0].rules[3].parameters.required_status_checks=[],'no CI checks');
});

test('reject misleading ruleset controls or completely absent metadata', () => {
  deny(x => delete x.rulesets[0].rules, 'no complete rules');
  deny(x => x.rulesets[0].target='tag', 'tag-only ruleset');
  deny(x => x.rulesets[0].conditions.ref_name.include=['refs/heads/release'], 'different branch');
  deny(x => x.rulesets[0].rules[3].parameters.required_status_checks[0].integration_id='15368', 'string instead of reviewed app ID');
  deny(x => x.rulesets[0].rules[2].parameters.required_approving_review_count=1.5, 'fractional reviewer approval');
  assert.equal(evaluate(null,SHA,REPO).allowed,false);
  assert.equal(evaluate(sample(),'b'.repeat(40),REPO).allowed,false);
});

test('N72 reject non-strict, missing or fragmented required status rules', () => {
  deny(x => x.rulesets[0].rules[3].parameters.strict_required_status_checks_policy=false, 'stale statuses could be accepted');
  deny(x => delete x.rulesets[0].rules[3].parameters.strict_required_status_checks_policy, 'missing strict policy');
  deny(x => x.rulesets[0].rules[3].parameters.required_status_checks.splice(0,1), 'partial required context');
  deny(x => {
    const statuses=x.rulesets[0].rules[3].parameters.required_status_checks;
    x.rulesets[0].rules[3].parameters.required_status_checks=statuses.slice(0,3);
    x.rulesets[0].rules.push({type:'required_status_checks',parameters:{
      strict_required_status_checks_policy:false,
      required_status_checks:statuses.slice(3)
    }});
  }, 'strict and loose policy union');
  deny(x => {
    const statuses=x.rulesets[0].rules[3].parameters.required_status_checks;
    x.rulesets[0].rules[3].parameters.required_status_checks=statuses.slice(0,3);
    x.rulesets[0].rules.push({type:'required_status_checks',parameters:{
      strict_required_status_checks_policy:true,
      required_status_checks:statuses.slice(3)
    }});
  }, 'fragmentation across separate strict rules');
});
