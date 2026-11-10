'use strict';
const {populateAppSecrets}=require('./bootstrap-secrets.cjs');
populateAppSecrets();
console.log('[startup] Application secrets initialized; values not logged.');
import('../../server.js').catch(e=>{console.error('[startup] Failed:',e.message);process.exitCode=1;});
