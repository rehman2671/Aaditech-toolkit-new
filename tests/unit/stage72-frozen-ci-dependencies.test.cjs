'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {inspect,check,REQUIRED}=require('../../scripts/check-phase-n72-frozen-ci-dependencies.cjs');
const root=path.resolve(__dirname,'../..');
const ci=fs.readFileSync(path.join(root,'.github/workflows/ci.yml'),'utf8');
const pkg=fs.readFileSync(path.join(root,'package.json'),'utf8');
const lock=fs.readFileSync(path.join(root,'package-lock.json'),'utf8');
function deny(nextCi=ci,nextPkg=pkg,nextLock=lock,reason){
  assert.notDeepEqual([nextCi,nextPkg,nextLock],[ci,pkg,lock],reason+' fixture must mutate');
  assert.throws(()=>inspect(nextCi,nextPkg,nextLock),/N72 unfrozen CI dependencies/,reason);
}
function firstInstall(change){return ci.replace('        run: npm ci\n',change);}
function secondInstall(change){
  const token='        run: npm ci\n',i=ci.lastIndexOf(token);
  assert.ok(i>=0);
  return ci.slice(0,i)+change+ci.slice(i+token.length);
}
test('Node and API jobs require exactly npm ci against synchronized lock root',()=>{
  assert.equal(check(),true);
  assert.equal(inspect(ci,pkg,lock),true);
  assert.deepEqual(Object.keys(REQUIRED),['node-tests','api-tests']);
});
test('both CI jobs reject npm install fallbacks and mutable dependency installs',()=>{
  deny(firstInstall('        run: npm ci || npm install\n'),pkg,lock,'node job fallback');
  deny(secondInstall('        run: npm ci || npm install\n'),pkg,lock,'API job fallback');
  deny(firstInstall('        run: npm install\n'),pkg,lock,'plain npm install');
  deny(secondInstall('        run: npm ci --package-lock=false\n'),pkg,lock,'lock disabled');
  deny(firstInstall('        run: npm ci\n        continue-on-error: true\n'),pkg,lock,
    'ignored failure');
  deny(secondInstall('        if: always()\n        run: npm ci\n'),pkg,lock,
    'conditional dependency install');
});
test('missing or moved dependency steps cannot silently avoid frozen install',()=>{
  deny(ci.replace('      - name: Install dependencies','      - name: Omit dependencies'),pkg,lock,
    'missing dependency step');
  deny(firstInstall('        run: npm ci\n        working-directory: Enterprise/api\n'),pkg,lock,
    'changed install directory');
  deny(ci.replace('  api-tests:\n','  api-tests:\n    continue-on-error: true\n'),pkg,lock,
    'optional API job');
  deny(ci.replace('  node-tests:\n','  node-tests:\n    if: github.event_name == \'workflow_dispatch\'\n'),pkg,lock,
    'conditionally skipped Node tests');
});
test('package-lock root must remain synchronized with package manifest',()=>{
  const p=JSON.parse(pkg),l=JSON.parse(lock);
  p.dependencies.express='^999.0.0';
  deny(ci,JSON.stringify(p),lock,'manifest changed without lock');
  l.packages[''].devDependencies.vitest='^999.0.0';
  deny(ci,pkg,JSON.stringify(l),'lock metadata changed without manifest');
  l.lockfileVersion=2;
  deny(ci,pkg,JSON.stringify(l),'unexpected npm lock version');
  l.packages[''].name='other';
  deny(ci,pkg,JSON.stringify(l),'unexpected package identity');
});
