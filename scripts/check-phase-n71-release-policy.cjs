'use strict';
// N71 offline structural regression: a protected signing/publish workflow must
// invoke a LIVE governance guard, never a no-op or mock. This validator does
// not call GitHub, read signing secrets or use private networks.
const fs=require('node:fs');
const path=require('node:path');
const YAML=require('yaml');
const ROOT=path.resolve(__dirname,'..');
const CMD='node ./scripts/check-phase-n71-live-release-governance.cjs --live';
const TOKEN='$'+'{{ secrets.GITHUB_TOKEN }}';
const SIGN_TOKEN='$'+"{{ github.event_name == 'workflow_dispatch' && secrets.GITHUB_TOKEN || '' }}";
function deny(){throw new Error('N71 protected-release governance workflow blocked.');}
function parse(raw){
  try {
    const d=YAML.parseDocument(raw,{uniqueKeys:true});
    if(d.errors.length)deny();
    return d.toJS();
  }catch(_){deny();}
}
function only(steps,name){
  if(!Array.isArray(steps))deny();
  const matching=steps.filter(x=>x?.name===name);
  if(matching.length!==1)deny();
  return matching[0];
}
function checkN71ReleasePolicy(ciSource,publisherSource,signingSource){
  const ci=parse(ciSource), pub=parse(publisherSource);
  const agent=ci.jobs?.['agent-build'], publisher=pub.jobs?.publish;
  if(!agent || !publisher || !Array.isArray(agent.steps) || !Array.isArray(publisher.steps) ||
     agent.environment?.name?.includes('production-installer')!==true ||
     publisher.environment!=='production-installer' ||
     publisher.if!=="github.ref == 'refs/heads/main'")deny();
  const a=agent.steps,b=publisher.steps;
  const first=only(a,'N71 verify live protected main ruleset before approved compiler download');
  const early=only(b,'N71 verify live main ruleset before accepting signed publication');
  if(first.shell!=='pwsh' || first.run?.trim()!==CMD ||
     first.if!=="github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'" ||
     first.env?.GH_TOKEN!==TOKEN || first['continue-on-error']!==undefined ||
     early.shell!=='pwsh' || early.run?.trim()!==CMD ||
     early.env?.GH_TOKEN!==TOKEN || early.if!==undefined ||
     early['continue-on-error']!==undefined)deny();
  function idx(items,name){return items.findIndex(x=>x?.name===name);}
  if(idx(a,first.name)>=idx(a,'N63 install independently SHA-approved PS2EXE NUPKG (protected manual only)') ||
     idx(a,first.name)>=idx(a,'Sign release EXE before WiX embeds it (or keep diagnostic only)') ||
     idx(b,early.name)>=idx(b,'Validate source GitHub CI run provenance and manual confirmation'))deny();
  const pre=only(a,'Sign release EXE before WiX embeds it (or keep diagnostic only)');
  const post=only(a,'Verify pre-signed MSI payload and sign release MSI');
  if(pre.env?.GH_TOKEN!==SIGN_TOKEN || post.env?.GH_TOKEN!==SIGN_TOKEN ||
     !String(pre.run).includes('Release-Sign.ps1 -Stage PrePackage') ||
     !String(post.run).includes('Release-Sign.ps1 -Stage Finalize'))deny();
  if(typeof signingSource!=='string' ||
     !signingSource.includes('N71 live protected main governance blocked signing.') ||
     !signingSource.includes('& node $liveGuard --live') ||
     signingSource.indexOf('& node $liveGuard --live')<=signingSource.indexOf('^[A-F0-9]{40}$') ||
     signingSource.indexOf('& node $liveGuard --live')>=signingSource.indexOf('[IO.File]::WriteAllBytes($pfx') ||
     !signingSource.includes("if ($LASTEXITCODE -ne 0)"))deny();

  const source=only(b,'Validate source GitHub CI run provenance and manual confirmation');
  const stage=only(b,'Stage draft, attest hosted SHA256 digests, then publish verified GitHub Release');
  if(source.env?.GH_TOKEN!==TOKEN ||
     !String(source.run).includes('$source.head_sha -cne $env:GITHUB_SHA') ||
     !String(source.run).includes('$source.head_sha -cne $env:APPROVED_SOURCE_SHA.ToLowerInvariant()') ||
     stage.env?.GH_TOKEN!==TOKEN || typeof stage.run!=='string' ||
     stage['continue-on-error']!==undefined)deny();
  const script=stage.run;
  const draft=script.indexOf('& gh release create $env:RELEASE_TAG @assets --draft');
  const pubidx=script.indexOf('& gh release edit $env:RELEASE_TAG --draft=false --latest=false');
  const earlyGuard=script.indexOf('& node ./scripts/check-phase-n71-live-release-governance.cjs --live');
  const lastGuard=script.lastIndexOf('& node ./scripts/check-phase-n71-live-release-governance.cjs --live');
  if(draft<0 || pubidx<0 || earlyGuard<0 || lastGuard<=earlyGuard ||
     earlyGuard>=draft || lastGuard<=draft || lastGuard>=pubidx ||
     script.indexOf("if ($env:SOURCE_SHA -cne $env:GITHUB_SHA)")>earlyGuard ||
     script.lastIndexOf("if ($env:SOURCE_SHA -cne $env:GITHUB_SHA)")>lastGuard ||
     (script.match(/if \(\$env:SOURCE_SHA -cne \$env:GITHUB_SHA\)/g)||[]).length!==2 ||
     !script.includes('N71 live branch protection changed before publication.') ||
     !script.includes('N71 main governance changed before draft staging.'))deny();
  return true;
}
function readN71Bundle(){
  return [
    fs.readFileSync(path.join(ROOT,'.github/workflows/ci.yml'),'utf8'),
    fs.readFileSync(path.join(ROOT,'.github/workflows/publish-signed-installer.yml'),'utf8'),
    fs.readFileSync(path.join(ROOT,'Enterprise/agent/build/Release-Sign.ps1'),'utf8'),
  ];
}
if(require.main===module){
  try{
    checkN71ReleasePolicy(...readN71Bundle());
    console.log('N71 PASS: live ruleset and exact current main SHA guard protected signer and signed publication.');
  }catch(_){console.error('N71 protected-release governance workflow blocked.');process.exitCode=1;}
}
module.exports={checkN71ReleasePolicy,readN71Bundle};
