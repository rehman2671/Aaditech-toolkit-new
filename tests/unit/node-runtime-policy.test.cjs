'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {check,read}=require('../../scripts/check-node-runtime-policy.cjs');
const base=read();
test('actual runtime and protected audit contract',()=>assert.equal(check(base),true));
for(const [label,patch] of [
 ['package drift',{pkg:{...base.pkg,engines:{node:'>=20'}}}],
 ['lock drift',{lock:{packages:{'':{engines:{node:'>=20'}}}}}],
 ['Docker drift',{docker:base.docker.replace('node:24-alpine','node:20-alpine')}],
 ['local runtime drift',{version:'20\n'}],
 ['CI runtime drift',{workflow:base.workflow.replace('node-version: "24"','node-version: "20"')}],
 ['audit skipped',{workflow:base.workflow.replace('run: node scripts/dependency-audit-policy.cjs --release','run: echo skipped')}],
 ['audit ignored',{workflow:base.workflow.replace('run: node scripts/dependency-audit-policy.cjs --release','continue-on-error: true\n        run: node scripts/dependency-audit-policy.cjs --release')}],
 ['audit bypass on main',{workflow:base.workflow.replace("if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'\n        timeout-minutes: 3","if: false\n        timeout-minutes: 3")}]
])test(label,()=>{assert.throws(()=>check({...base,...patch}))});

test('Docker runtime check cannot be removed',()=>assert.throws(()=>check({...base,docker:base.docker.replace(/^RUN node -e .*\n/m,'')})));
test('Docker locked install cannot be replaced',()=>assert.throws(()=>check({...base,docker:base.docker.replace('RUN npm ci --omit=dev --no-audit --no-fund','RUN npm install')})));
