#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const MAIN_BUILD = "(github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main') || (github.event_name == 'push' && github.ref == 'refs/heads/main')";
const MAIN_MANUAL = "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'";
const ENV = '$' + "{{ github.event_name == 'workflow_dispatch' && 'production-installer' || 'ci-diagnostic' }}";
function ensure(value, reason) {
  if (!value) throw new Error('N67 release-gate drift: ' + reason);
}
function parse(src, label) {
  try {
    const d = YAML.parseDocument(src, { version: '1.2', uniqueKeys: true });
    if (d.errors.length) throw new Error('Invalid YAML');
    const obj = d.toJS({ maxAliasCount: 0 });
    ensure(obj && typeof obj === 'object' && !Array.isArray(obj), label + ' root');
    return obj;
  } catch {
    throw new Error('N67 malformed ' + label + ' YAML');
  }
}
function step(steps, name) {
  const matches = steps.filter(s => s && s.name === name);
  ensure(matches.length === 1, name + ' must occur exactly once');
  return matches[0];
}
function exact(steps, name, run, shell) {
  const s = step(steps, name);
  ensure(typeof s.run === 'string' && s.run.trim() === run, name + ' executable must be preserved');
  if (shell) ensure(s.shell === shell, name + ' shell must be preserved');
  return s;
}
function hasLine(run, fragment) {
  return typeof run === 'string' && run.split(/\r?\n/)
    .some(line => line.trim() === fragment || line.trim().startsWith(fragment + ' '));
}
function inspectCI(src) {
  const root = parse(src, 'CI');
  ensure(root.on?.push?.branches?.length === 1 &&
    root.on.push.branches[0] === 'main', 'push must target only main');
  const job = root.jobs?.['agent-build'];
  ensure(job && job['runs-on'] === 'windows-latest' && Array.isArray(job.steps),
    'Windows MSI job missing');
  ensure(job.if === MAIN_BUILD, 'main-only manual/push job condition');
  ensure(job.environment?.name === ENV, 'protected reviewer environment');
  ensure(Array.isArray(job.needs) && job.needs.includes('node-tests') &&
    job.needs.includes('api-tests'), 'Node/API tests must gate MSI build');
  const s = job.steps;
  ensure(exact(s, 'Install ps2exe',
    'Install-Module -Name ps2exe -RequiredVersion 1.0.18 -Repository PSGallery -Force -Scope CurrentUser',
    'powershell').if === "github.event_name == 'push'", 'diagnostic PS2EXE push-only');
  ensure(exact(s, 'Install WiX toolset', 'dotnet tool install --global wix --version 5.0.2').if ===
    "github.event_name == 'push'", 'diagnostic WiX push-only');
  for (const [name, kind, shell] of [
    ['N63 install independently SHA-approved PS2EXE NUPKG (protected manual only)', 'ps2exe', 'powershell'],
    ['N63 install independently SHA-approved WiX NUPKG (protected manual only)', 'wix', 'pwsh']
  ]) {
    const p = exact(s, name, './Enterprise/agent/build/Install-ApprovedCompiler.ps1 -Kind ' + kind, shell);
    ensure(p.if === MAIN_MANUAL, name + ' main-manual only');
    ensure(p.env?.PS2EXE_NUPKG_SHA256_APPROVED === '$' + '{{ secrets.PS2EXE_NUPKG_SHA256_APPROVED }}',
      name + ' approved PS2EXE package');
    ensure(p.env?.WIX_NUPKG_SHA256_APPROVED === '$' + '{{ secrets.WIX_NUPKG_SHA256_APPROVED }}',
      name + ' approved WiX package');
  }
  const sign = exact(s, 'Sign release EXE before WiX embeds it (or keep diagnostic only)',
    './Enterprise/agent/build/Release-Sign.ps1 -Stage PrePackage', 'pwsh');
  ensure(sign.env?.CODESIGN_PFX_B64 === '$' +
    "{{ github.event_name == 'workflow_dispatch' && secrets.CODESIGN_PFX_B64 || '' }}",
    'publisher secret manual-only');
  ensure(sign.env?.RELEASE_APPROVAL_SIGNATURE_B64 === '$' +
    "{{ github.event_name == 'workflow_dispatch' && secrets.RELEASE_APPROVAL_SIGNATURE_B64 || '' }}",
    'reviewer authorization manual-only');
  const finalize = step(s, 'Verify pre-signed MSI payload and sign release MSI');
  ensure(finalize.shell === 'pwsh' && hasLine(finalize.run,
    './Enterprise/agent/build/Release-Sign.ps1 -Stage Finalize') &&
    finalize.run.includes('Assert-N54ApprovedSqliteFile') &&
    finalize.run.includes('MSI payload did not match pre-signed EXE'),
    'EXE/MSI content comparison and final signing');
  const verified = exact(s, 'Verify final signed artifact publication',
    './Enterprise/agent/build/Verify-SignedPublication.ps1', 'pwsh');
  ensure(verified.if === "env.PUBLISH_SIGNED == 'true' && github.event_name == 'workflow_dispatch'",
    'signed artifact verification condition');
  const approval = exact(s, 'N58 record final verified source reviewer approval identity',
    './Enterprise/agent/build/Write-SourceReleaseApprovalReceipt.ps1', 'pwsh');
  ensure(approval.if === "env.PUBLISH_SIGNED == 'true' && env.PUBLICATION_VERIFIED == 'true' && github.event_name == 'workflow_dispatch'",
    'release reviewer receipt gate');
  const uploaded = step(s, 'Upload verified signed artifacts only');
  ensure(uploaded.if === "env.PUBLISH_SIGNED == 'true' && env.PUBLICATION_VERIFIED == 'true' && env.RELEASE_APPROVAL_RECEIPT_VERIFIED == 'true'",
    'signed artifacts gated on independently verified receipt');
  ensure(uploaded.uses === 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
    'upload action immutable');
  const pathset = String(uploaded.with?.path || '');
  for (const p of ['*.exe', '*.msi', 'SHA256SUMS.txt']) {
    ensure(pathset.includes('Enterprise/agent/build/out/' + p), 'signed artifact path: ' + p);
  }
  for (const [name, cmd] of [
    ['Rehearse real Windows MSI install, post-setup and clean uninstall', './Enterprise/tests/Test-Windows-MsiInstall.ps1'],
    ['Rehearse Windows MSI major upgrade and tenant configuration preservation', './Enterprise/tests/Test-Windows-MsiUpgrade.ps1'],
    ['Build MSI', './Enterprise/agent/wix/build-msi.ps1']
  ]) ensure(hasLine(step(s, name).run, cmd), name + ' Windows executable');
  return true;
}
function inspectPublisher(src) {
  const root = parse(src, 'publisher');
  ensure(root.on?.workflow_dispatch && !root.on.push && !root.on.pull_request,
    'publisher must be manual only');
  const job = root.jobs?.publish;
  ensure(job?.if === "github.ref == 'refs/heads/main'" &&
    job.environment === 'production-installer' &&
    job['runs-on'] === 'windows-latest' && Array.isArray(job.steps),
    'publisher main-only protected environment');
  const s = job.steps;
  const provenance = step(s, 'Validate source GitHub CI run provenance and manual confirmation');
  for (const expected of [
    "APPROVAL_CONFIRMATION -cne 'PUBLISH_SIGNED_AGENT'",
    "$source.event -ne 'workflow_dispatch'",
    "$source.conclusion -ne 'success'",
    "$source.head_branch -ne 'main'",
    '$source.head_sha -cne $env:APPROVED_SOURCE_SHA.ToLowerInvariant()'
  ]) ensure(provenance.run.includes(expected), 'approved source identity: ' + expected);
  const checkout = s.find(t => t?.uses ===
    'actions/checkout@11d5960a326750d5838078e36cf38b85af677262' && t.with?.ref);
  ensure(checkout?.with?.ref === '$' + '{{ env.SOURCE_SHA }}' &&
    checkout.with['persist-credentials'] === false, 'reviewed-source SHA checkout');
  const download = s.find(t => t?.uses ===
    'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093');
  ensure(download?.with?.['run-id'] === '$' + '{{ inputs.source_run_id }}' &&
    download.with['github-token'] === '$' + '{{ secrets.GITHUB_TOKEN }}' &&
    download.with.path === 'release', 'approved run artifact download');
  ensure(hasLine(step(s, 'N58 verify same signed source reviewer approval and artifact receipt').run,
    './Enterprise/agent/build/Assert-PublicationReviewerApproval.ps1'),
    'signed independent approval verification');
  ensure(hasLine(step(s, 'Verify version and exact trusted EXE/MSI publisher, timestamp and payload').run,
    './Enterprise/agent/build/Verify-ReleaseArtifact.ps1'),
    'trusted publisher and MSI SHA verification');
  const run = step(s, 'Stage draft, attest hosted SHA256 digests, then publish verified GitHub Release').run;
  const draft = run.indexOf('gh release create $env:RELEASE_TAG @assets --draft --target $env:SOURCE_SHA');
  const draftCheck = run.indexOf('Assert-RemoteReleaseAssets.ps1 -ArtifactDir release -ReleaseId $releaseId -RequireDraft');
  const publicize = run.indexOf('gh release edit $env:RELEASE_TAG --draft=false --latest=false');
  const publishedCheck = run.indexOf('Assert-RemoteReleaseAssets.ps1 -ArtifactDir release -ReleaseId $releaseId -RequirePublished');
  ensure(draft >= 0 && draftCheck > draft && publicize > draftCheck &&
    publishedCheck > publicize, 'draft attestation before and hosted check after publication');
  for (const needle of [
    'Assert-PublicationReviewerApproval.ps1 -ArtifactDir release -ApprovedSourceSha',
    'Verify-ReleaseArtifact.ps1 -ArtifactDir release -ApprovedThumbprint'
  ]) ensure(run.lastIndexOf(needle) > draftCheck && run.lastIndexOf(needle) < publicize,
    'fresh independent authorization before public release: ' + needle);
  ensure(run.includes('if ($assets.Count -ne 3)'), 'exact three-asset release');
  return true;
}
function checkAll(root = path.resolve(__dirname, '..')) {
  const workflows = path.join(root, '.github', 'workflows');
  inspectCI(fs.readFileSync(path.join(workflows, 'ci.yml'), 'utf8'));
  inspectPublisher(fs.readFileSync(path.join(workflows, 'publish-signed-installer.yml'), 'utf8'));
  return { ci: 'protected', publisher: 'protected' };
}
if (require.main === module) {
  checkAll();
  process.stdout.write('N67 PASS: main-only manual MSI, approved compiler packages, signing, and hosted release checks.\n');
}
module.exports = { MAIN_BUILD, inspectCI, inspectPublisher, checkAll };
