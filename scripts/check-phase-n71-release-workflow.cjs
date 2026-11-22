'use strict';
// N71: offline structural protection for production signing and publication.
// Uses checked-in YAML, not production secrets or any network requests.
const fs=require('node:fs');
const path=require('node:path');
const YAML=require('yaml');
const FIRST='N71 check live protected main before approved compiler downloads (manual only)';
const RECHECK='N71 recheck protected main before final MSI signing (manual only)';
const PUB='N71 verify live non-bypassable main review and trusted CI checks before release';
const CMD='node ./scripts/check-phase-n71-live-main-protection.cjs --live';
const TOKEN='$'+'{{ secrets.GITHUB_TOKEN }}';
const MANUAL_TOKEN='$'+"{{ github.event_name == 'workflow_dispatch' && secrets.GITHUB_TOKEN || '' }}";
const MANUAL="github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'";
function fail(){throw new Error('N71 workflow bypass blocked.');}
function parse(raw){
  try{
    const doc=YAML.parseDocument(raw,{uniqueKeys:true,version:'1.2'});
    if(doc.errors.length)fail();
    return doc.toJS({maxAliasCount:0});
  }catch(_){fail();}
}
function only(steps,name){
  if(!Array.isArray(steps))fail();
  const found=steps.filter(s=>s && s.name===name);
  if(found.length!==1)fail();
  return found[0];
}
function guard(steps,name,manual){
  const step=only(steps,name);
  if(step.shell!=='pwsh'||step.run?.trim()!==CMD||step.env?.GH_TOKEN!==TOKEN||
     (manual ? step.if!==MANUAL : step.if!==undefined)||
     step['continue-on-error']===true||step.uses||step.with)fail();
}
function inspect(ciRaw,publisherRaw,signerRaw){
  const ci=parse(ciRaw), pub=parse(publisherRaw);
  const build=ci.jobs?.['agent-build'], publisher=pub.jobs?.publish;
  const a=build?.steps, b=publisher?.steps;
  if(!Array.isArray(a)||!Array.isArray(b)||typeof signerRaw!=='string')fail();
  if(build.if!=="github.event_name == 'workflow_dispatch' || github.event_name == 'push'" ||
     !String(build.environment?.name).includes('production-installer') ||
     publisher.if!=="github.ref == 'refs/heads/main'" ||
     publisher.environment!=='production-installer')fail();
  guard(a,FIRST,true);
  guard(a,RECHECK,true);
  guard(b,PUB,false);
  const pos=(items,name)=>items.findIndex(s=>s && s.name===name);
  const protectedPs='N63 install independently SHA-approved PS2EXE NUPKG (protected manual only)';
  const extraction='Validate MSI payload by Windows Installer administrative extraction';
  const finalSign='Verify pre-signed MSI payload and sign release MSI';
  const source='Validate source GitHub CI run provenance and manual confirmation';
  if(pos(a,protectedPs)<0||pos(a,extraction)<0||pos(a,finalSign)<0||pos(b,source)<0||
    pos(a,FIRST)>=pos(a,protectedPs)||
    pos(a,RECHECK)<=pos(a,extraction)||pos(a,RECHECK)>=pos(a,finalSign)||
    pos(b,PUB)>=pos(b,source))fail();
  for(const n of [
    'Sign release EXE before WiX embeds it (or keep diagnostic only)',
    finalSign
  ]){
    const step=only(a,n);
    if(step.env?.GH_TOKEN!==MANUAL_TOKEN||!String(step.run).includes('Release-Sign.ps1'))fail();
  }
  const authorizer=only(b,source);
  if(authorizer.env?.GH_TOKEN!==TOKEN ||
     !String(authorizer.run).includes('$source.head_sha -cne $env:APPROVED_SOURCE_SHA.ToLowerInvariant()')||
     !String(authorizer.run).includes('$source.head_sha -cne $env:GITHUB_SHA'))fail();
  const stage=only(b,'Stage draft, attest hosted SHA256 digests, then publish verified GitHub Release');
  const s=String(stage.run||'');
  const bind='if ($env:SOURCE_SHA -cne $env:GITHUB_SHA)';
  const firstBind=s.indexOf(bind),lastBind=s.lastIndexOf(bind);
  const create=s.indexOf('& gh release create $env:RELEASE_TAG');
  const attested=s.lastIndexOf('Assert-RemoteReleaseAssets.ps1 -ArtifactDir release -ReleaseId $releaseId -RequireDraft');
  const liveFirst=s.indexOf(CMD),liveLast=s.lastIndexOf(CMD);
  const publish=s.indexOf('& gh release edit $env:RELEASE_TAG --draft=false --latest=false');
  if(stage.shell!=='pwsh'||stage.env?.GH_TOKEN!==TOKEN||stage['continue-on-error']===true||
     firstBind<0||firstBind>=create||create<0||
     liveFirst<=firstBind||liveFirst>=create||
     attested<=create||lastBind<=attested||liveLast<=attested||
     lastBind>=publish||liveLast>=publish||liveLast<=lastBind||
     !s.includes("if ($LASTEXITCODE -ne 0) { throw 'N71 live main policy blocked draft creation.' }")||
     !s.includes("if ($LASTEXITCODE -ne 0) { throw 'N71 live main policy blocked public release.' }"))fail();
  const pin="if ($expected -cnotmatch '^[A-F0-9]{40}$')";
  const local=signerRaw.indexOf(pin),live=signerRaw.indexOf('& node $preflight --live');
  const pfx=signerRaw.indexOf('[Convert]::FromBase64String');
  if(local<0||live<=local||pfx<=live||pfx<0||
     !signerRaw.includes('N71 live protected-main governance denied signing.'))fail();
  return true;
}
function check(root=path.resolve(__dirname,'..')){
  return inspect(
    fs.readFileSync(path.join(root,'.github/workflows/ci.yml'),'utf8'),
    fs.readFileSync(path.join(root,'.github/workflows/publish-signed-installer.yml'),'utf8'),
    fs.readFileSync(path.join(root,'Enterprise/agent/build/Release-Sign.ps1'),'utf8')
  );
}
if(require.main===module){
  try{check();console.log('N71 PASS: live protected-main signing and publishing gates match reviewed workflow structure.');}
  catch(_){console.error('N71 workflow bypass blocked.');process.exitCode=1;}
}
module.exports={FIRST,RECHECK,PUB,CMD,TOKEN,MANUAL_TOKEN,inspect,check};
