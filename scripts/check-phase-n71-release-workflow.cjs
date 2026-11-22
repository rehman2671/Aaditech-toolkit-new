#!/usr/bin/env node
'use strict';
// Structural N71 workflow admission in CI. Runtime script uses Node built-ins,
// since Windows publisher/install-sign runner does not run npm install.
const fs = require('node:fs'), path = require('node:path'), YAML = require('yaml');
const FIRST = 'N71 check live protected main before approved compiler downloads (manual only)';
const RECHECK = 'N71 recheck protected main before final MSI signing (manual only)';
const PUB = 'N71 verify live non-bypassable main review and trusted CI checks before release';
const CMD = 'node ./scripts/check-phase-n71-live-main-protection.cjs --live';
const TOKEN = '$' + '{{ secrets.GITHUB_TOKEN }}';
function fail(why) { throw new Error('N71 workflow bypass: ' + why); }
function parse(text) {
  const doc = YAML.parseDocument(text, { uniqueKeys: true, version: '1.2' });
  if (doc.errors.length) fail('invalid workflow YAML');
  return doc.toJS({ maxAliasCount: 0 });
}
function only(steps, name) {
  const x = steps.filter(s => s && s.name === name);
  if (x.length !== 1) fail('expected exactly one step ' + name);
  return x[0];
}
function assertStep(s, manual) {
  if (s.shell !== 'pwsh' || s.run?.trim() !== CMD || s.env?.GH_TOKEN !== TOKEN ||
      (manual && s.if !== "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'") ||
      (!manual && Object.prototype.hasOwnProperty.call(s, 'if')) ||
      s['continue-on-error'] || s.continue_on_error || s.with || s.uses) {
    fail('live preflight semantics weakened');
  }
}
function inspect(ci, publisher, signing) {
  const c = parse(ci), p = parse(publisher);
  const build = c.jobs?.['agent-build'];
  const publish = p.jobs?.publish;
  const a = build?.steps, b = publish?.steps;
  if (!Array.isArray(a) || !Array.isArray(b)) fail('missing protected Windows jobs');
  const first=only(a,FIRST), recheck=only(a,RECHECK), pub=only(b,PUB);
  assertStep(first,true);assertStep(recheck,true);assertStep(pub,false);
  const pos=(items,name)=>items.findIndex(s=>s && s.name === name);
  if (pos(a,FIRST) >= pos(a,'N63 install independently SHA-approved PS2EXE NUPKG (protected manual only)') ||
      pos(a,RECHECK) >= pos(a,'Verify pre-signed MSI payload and sign release MSI') ||
      pos(a,RECHECK) <= pos(a,'Validate MSI payload by Windows Installer administrative extraction') ||
      pos(b,PUB) >= pos(b,'Validate source GitHub CI run provenance and manual confirmation')) {
    fail('live governance must run before protected package/signing/publishing');
  }
  for (const signingStepName of [
    'Sign release EXE before WiX embeds it (or keep diagnostic only)',
    'Verify pre-signed MSI payload and sign release MSI'
  ]) {
    if (only(a,signingStepName).env?.GH_TOKEN !== ' {
      fail('signer missing read-only governance token');
    }
  }
  const stage=only(b,'Stage draft, attest hosted SHA256 digests, then publish verified GitHub Release').run;
  const attested=stage.indexOf('Assert-RemoteReleaseAssets.ps1 -ArtifactDir release -ReleaseId $releaseId -RequireDraft');
  const last=stage.lastIndexOf(CMD);
  const publicize=stage.indexOf('& gh release edit $env:RELEASE_TAG --draft=false --latest=false');
  if (attested < 0 || last <= attested || publicize <= last ||
      !stage.includes("if ($LASTEXITCODE -ne 0) { throw 'N71 live main policy blocked public release.' }")) {
    fail('last-moment governance check must precede public release');
  }
  // An approved historical CI SHA cannot be republished from a later
  // dispatch. Exact source approval and live main branch binding are needed.
  const sourceAdmission=only(b,'Validate source GitHub CI run provenance and manual confirmation').run;
  if (!sourceAdmission.includes('$source.head_sha -cne $env:APPROVED_SOURCE_SHA.ToLowerInvariant()') ||
      !sourceAdmission.includes('$source.head_sha -cne $env:GITHUB_SHA')) {
    fail('published signed source is not bound to the protected main dispatch');
  }
  const bind="if ($env:SOURCE_SHA -cne $env:GITHUB_SHA)";
  const firstBind=stage.indexOf(bind);
  const lastBind=stage.lastIndexOf(bind);
  const create=stage.indexOf('& gh release create $env:RELEASE_TAG');
  if (firstBind<0 || lastBind<=firstBind || create<=firstBind ||
      lastBind<=create || publicize<=lastBind) {
    fail('approved source must still match current main before draft and publication');
  }
  const pinCheck = "if ($expected -cnotmatch '^[A-F0-9]{40}
  const pinPosition = signing.indexOf(pinCheck);
  const livePosition = signing.indexOf('& node $preflight --live');
  const pfxPosition = signing.indexOf('[Convert]::FromBase64String');
  if (typeof signing !== 'string' ||
      !signing.includes('N71 protected main preflight denied signing') ||
      pinPosition < 0 || livePosition <= pinPosition || pfxPosition <= livePosition) {
    fail('nonsecret fingerprint must validate before live governance, and PFX only after');
  }
  return true;
}
function check(root=path.resolve(__dirname,'..')) {
  const folder=path.join(root,'.github','workflows');
  return inspect(fs.readFileSync(path.join(folder,'ci.yml'),'utf8'),
    fs.readFileSync(path.join(folder,'publish-signed-installer.yml'),'utf8'),
    fs.readFileSync(path.join(root,'Enterprise','agent','build','Release-Sign.ps1'),'utf8'));
}
if (require.main === module) {
  check();
  process.stdout.write('N71 PASS: signer/publisher enforce live protected main before private-key use and public release.\n');
}
module.exports={FIRST,RECHECK,PUB,CMD,TOKEN,inspect,check};
)";
  const pinPosition = signing.indexOf(pinCheck);
  const livePosition = signing.indexOf('& node $preflight --live');
  const pfxPosition = signing.indexOf('[Convert]::FromBase64String');
  if (typeof signing !== 'string' ||
      !signing.includes('N71 protected main preflight denied signing') ||
      pinPosition < 0 || livePosition <= pinPosition || pfxPosition <= livePosition) {
    fail('nonsecret fingerprint must validate before live governance, and PFX only after');
  }
  return true;
}
function check(root=path.resolve(__dirname,'..')) {
  const folder=path.join(root,'.github','workflows');
  return inspect(fs.readFileSync(path.join(folder,'ci.yml'),'utf8'),
    fs.readFileSync(path.join(folder,'publish-signed-installer.yml'),'utf8'),
    fs.readFileSync(path.join(root,'Enterprise','agent','build','Release-Sign.ps1'),'utf8'));
}
if (require.main === module) {
  check();
  process.stdout.write('N71 PASS: signer/publisher enforce live protected main before private-key use and public release.\n');
}
module.exports={FIRST,RECHECK,PUB,CMD,TOKEN,inspect,check};
 + "{{ github.event_name == 'workflow_dispatch' && secrets.GITHUB_TOKEN || '' }}") {
      fail('signer missing read-only governance token');
    }
  }
  const stage=only(b,'Stage draft, attest hosted SHA256 digests, then publish verified GitHub Release').run;
  const attested=stage.indexOf('Assert-RemoteReleaseAssets.ps1 -ArtifactDir release -ReleaseId $releaseId -RequireDraft');
  const last=stage.lastIndexOf(CMD);
  const publicize=stage.indexOf('& gh release edit $env:RELEASE_TAG --draft=false --latest=false');
  if (attested < 0 || last <= attested || publicize <= last ||
      !stage.includes("if ($LASTEXITCODE -ne 0) { throw 'N71 live main policy blocked public release.' }")) {
    fail('last-moment governance check must precede public release');
  }
  // An approved historical CI SHA cannot be republished from a later
  // dispatch. Exact source approval and live main branch binding are needed.
  const sourceAdmission=only(b,'Validate source GitHub CI run provenance and manual confirmation').run;
  if (!sourceAdmission.includes('$source.head_sha -cne $env:APPROVED_SOURCE_SHA.ToLowerInvariant()') ||
      !sourceAdmission.includes('$source.head_sha -cne $env:GITHUB_SHA')) {
    fail('published signed source is not bound to the protected main dispatch');
  }
  const bind="if ($env:SOURCE_SHA -cne $env:GITHUB_SHA)";
  const firstBind=stage.indexOf(bind);
  const lastBind=stage.lastIndexOf(bind);
  const create=stage.indexOf('& gh release create $env:RELEASE_TAG');
  if (firstBind<0 || lastBind<=firstBind || create<=firstBind ||
      lastBind<=create || publicize<=lastBind) {
    fail('approved source must still match current main before draft and publication');
  }
  const pinCheck = "if ($expected -cnotmatch '^[A-F0-9]{40}
  const pinPosition = signing.indexOf(pinCheck);
  const livePosition = signing.indexOf('& node $preflight --live');
  const pfxPosition = signing.indexOf('[Convert]::FromBase64String');
  if (typeof signing !== 'string' ||
      !signing.includes('N71 protected main preflight denied signing') ||
      pinPosition < 0 || livePosition <= pinPosition || pfxPosition <= livePosition) {
    fail('nonsecret fingerprint must validate before live governance, and PFX only after');
  }
  return true;
}
function check(root=path.resolve(__dirname,'..')) {
  const folder=path.join(root,'.github','workflows');
  return inspect(fs.readFileSync(path.join(folder,'ci.yml'),'utf8'),
    fs.readFileSync(path.join(folder,'publish-signed-installer.yml'),'utf8'),
    fs.readFileSync(path.join(root,'Enterprise','agent','build','Release-Sign.ps1'),'utf8'));
}
if (require.main === module) {
  check();
  process.stdout.write('N71 PASS: signer/publisher enforce live protected main before private-key use and public release.\n');
}
module.exports={FIRST,RECHECK,PUB,CMD,TOKEN,inspect,check};
)";
  const pinPosition = signing.indexOf(pinCheck);
  const livePosition = signing.indexOf('& node $preflight --live');
  const pfxPosition = signing.indexOf('[Convert]::FromBase64String');
  if (typeof signing !== 'string' ||
      !signing.includes('N71 protected main preflight denied signing') ||
      pinPosition < 0 || livePosition <= pinPosition || pfxPosition <= livePosition) {
    fail('nonsecret fingerprint must validate before live governance, and PFX only after');
  }
  return true;
}
function check(root=path.resolve(__dirname,'..')) {
  const folder=path.join(root,'.github','workflows');
  return inspect(fs.readFileSync(path.join(folder,'ci.yml'),'utf8'),
    fs.readFileSync(path.join(folder,'publish-signed-installer.yml'),'utf8'),
    fs.readFileSync(path.join(root,'Enterprise','agent','build','Release-Sign.ps1'),'utf8'));
}
if (require.main === module) {
  check();
  process.stdout.write('N71 PASS: signer/publisher enforce live protected main before private-key use and public release.\n');
}
module.exports={FIRST,RECHECK,PUB,CMD,TOKEN,inspect,check};
