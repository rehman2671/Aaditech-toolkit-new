#!/usr/bin/env node
'use strict';
// N74: privileged production signing is not allowed to begin while a
// mandatory Windows PowerShell security suite is unfinished or failing.
const fs=require('node:fs'),path=require('node:path'),YAML=require('yaml');
const REQUIRED=Object.freeze({
  'powershell-validation':'PowerShell validation',
  'node-tests':'Node.js Unit & Integration Tests (Vitest + MySQL 8)',
  'api-tests':'API test suite (Node.js vs MySQL 8)'
});
function requireSafe(ok,why){if(!ok)throw new Error('N74 signer prerequisite bypass: '+why);}
function inspect(src){
  const doc=YAML.parseDocument(src,{version:'1.2',uniqueKeys:true});
  requireSafe(doc.errors.length===0,'invalid or ambiguous YAML');
  const jobs=doc.toJS({maxAliasCount:0})?.jobs;
  requireSafe(jobs&&typeof jobs==='object','CI jobs missing');
  for(const [id,name] of Object.entries(REQUIRED)){
    const job=jobs[id];
    requireSafe(job?.name===name,id+' must retain its exact required check name');
    requireSafe(!Object.prototype.hasOwnProperty.call(job,'if') &&
      !job['continue-on-error'],id+' must execute and fail closed');
    requireSafe(Array.isArray(job.steps)&&job.steps.length>0,id+' is not executable');
  }
  const signer=jobs['agent-build'];
  requireSafe(signer?.name==='Build agent exe + MSI','signer job missing');
  requireSafe(Array.isArray(signer.needs)&&signer.needs.length===3&&
    new Set(signer.needs).size===3&&
    Object.keys(REQUIRED).every(id=>signer.needs.includes(id)),
    'signer must await PowerShell, Node and API success');
  const allowed="(github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main') || (github.event_name == 'push' && github.ref == 'refs/heads/main')";
  requireSafe(signer.if===allowed&&!signer['continue-on-error'],
    'signing build must retain exact main-only event restrictions');
  const envName='$'+"{{ github.event_name == 'workflow_dispatch' && 'production-installer' || 'ci-diagnostic' }}";
  requireSafe(signer.environment?.name===envName,
    'manual signer must retain protected production-installer environment');
  requireSafe(Array.isArray(signer.steps),'signing steps missing');
  const ix=name=>signer.steps.findIndex(s=>s?.name===name);
  const gate=ix('N70 verify live protected main before release (manual only)');
  const exe=ix('Sign release EXE before WiX embeds it (or keep diagnostic only)');
  const msi=ix('Verify pre-signed MSI payload and sign release MSI');
  requireSafe(gate>=0&&exe>gate&&msi>exe,'live governance must precede both signing stages');
  const pre=signer.steps[gate];
  requireSafe(pre.if==="github.event_name == 'workflow_dispatch'" &&
    pre.shell==='pwsh' &&
    pre.run?.trim()==='node ./scripts/check-phase-n70-live-main-protection.cjs --live' &&
    pre.env?.GH_TOKEN===('$'+'{{ secrets.GITHUB_TOKEN }}') &&
    !pre['continue-on-error'],'authenticated N70 gate must fail closed');
  return true;
}
function check(root=path.resolve(__dirname,'..')){
  return inspect(fs.readFileSync(path.join(root,'.github/workflows/ci.yml'),'utf8'));
}
if(require.main===module){
  check();
  process.stdout.write('N74 PASS: protected signer waits for all three security suites.\n');
}
module.exports={REQUIRED,inspect,check};
