#!/usr/bin/env node
// Stage N33 operator-run MySQL-only receipt check. No deployment, writes,
// enrollment, HTTPS requests or access to raw telemetry/agent credentials.
// Credentials are supplied ONLY using DB_* environment or a protected socket.
import fs from 'node:fs';
import path from 'node:path';
import { validateEvidence, verifyScopedReceipt, Stage33Error } from './stage33-receipt-core.mjs';

const deny = code => { throw new Stage33Error(code); };
function args(argv) {
  if (argv.length !== 6 || argv[0] !== '--evidence-dir' ||
      argv[2] !== '--identity-file' || argv[4] !== '--output') deny('ARGUMENTS_REQUIRED');
  const o = { dir:path.resolve(argv[1]), identity:path.resolve(argv[3]), out:path.resolve(argv[5]) };
  if ([o.dir,o.identity,o.out].some(x => !path.isAbsolute(x)) || o.out === o.identity) deny('INVALID_PATH');
  return o;
}
function privateFile(file, requirePrivateMode=false) {
  const s = fs.lstatSync(file);
  if (!s.isFile() || s.isSymbolicLink() || s.size < 2 || s.size > 65536) deny('INVALID_EVIDENCE_FILE');
  // The server-side scope binding contains tenant and device identifiers.
  if (requirePrivateMode && process.platform !== 'win32' && (s.mode & 0o077) !== 0) {
    deny('IDENTITY_FILE_PERMISSIONS');
  }
  return fs.readFileSync(file);
}
function config() {
  const {DB_USER,DB_PASSWORD,DB_NAME,DB_HOST,DB_PORT,DB_SOCKET_PATH,DB_SSL_CA_FILE} = process.env;
  if (!DB_USER || !DB_PASSWORD || !DB_NAME ||
      !/^[A-Za-z0-9_]+$/.test(DB_NAME)) deny('DATABASE_CONFIGURATION_REQUIRED');
  const options={user:DB_USER,password:DB_PASSWORD,database:DB_NAME,connectTimeout:10000,
    charset:'utf8mb4',dateStrings:true,multipleStatements:false};
  if (DB_SOCKET_PATH) { options.socketPath=DB_SOCKET_PATH; }
  else {
    if (!DB_HOST) deny('DATABASE_CONFIGURATION_REQUIRED');
    options.host=DB_HOST;
    options.port=Number(DB_PORT || 3306);
    if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) deny('INVALID_DB_PORT');
    const loopback=['127.0.0.1','localhost','::1'].includes(DB_HOST.toLowerCase());
    if (!loopback && !DB_SSL_CA_FILE) deny('REMOTE_DB_TLS_REQUIRED');
  }
  if (DB_SSL_CA_FILE) {
    const ca=privateFile(DB_SSL_CA_FILE);
    options.ssl={ca, rejectUnauthorized:true,minVersion:'TLSv1.2'};
  }
  return options;
}
async function main() {
  const o=args(process.argv.slice(2));
  const directory=fs.lstatSync(o.dir);
  if (!directory.isDirectory() || directory.isSymbolicLink()) deny('INVALID_EVIDENCE_DIRECTORY');
  if (fs.existsSync(o.out)) deny('REFUSING_OVERWRITE');
  const outParent=fs.lstatSync(path.dirname(o.out));
  if (!outParent.isDirectory() || outParent.isSymbolicLink()) deny('INVALID_OUTPUT_DIRECTORY');
  const offlineBytes=privateFile(path.join(o.dir,'stage32-offline.json'));
  const recoveredBytes=privateFile(path.join(o.dir,'stage32-recovered.json'));
  const identityBytes=privateFile(o.identity,true);
  const offline=JSON.parse(offlineBytes.toString('utf8'));
  const recovered=JSON.parse(recoveredBytes.toString('utf8'));
  const identity=JSON.parse(identityBytes.toString('utf8'));
  const evidence=validateEvidence(offline,recovered,identity,offlineBytes,recoveredBytes);
  const dbOptions=config();
  const mysql=await import('mysql2/promise');
  const conn=await mysql.default.createConnection(dbOptions);
  let report;
  try {
    await conn.query('START TRANSACTION READ ONLY');
    report=await verifyScopedReceipt(async (sql,params) => {
      const [rows]=await conn.execute(sql,params);
      return rows;
    }, evidence);
    await conn.rollback();
  } catch (e) {
    try { await conn.rollback(); } catch { /* keep first failure */ }
    throw e;
  } finally { await conn.end(); }
  // Output is redacted and immutable. DB account privileges are NOT modified.
  fs.writeFileSync(o.out,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('N33 PASS: one authenticated tenant/device-scoped MySQL receipt matched local event count; production signoff remains blocked.');
}
main().catch(error => {
  // Never echo database/network errors, credential values, paths, IDs or SQL.
  console.error('N33 BLOCKED: '+(error instanceof Stage33Error ? error.code : 'UNVERIFIED_OR_UNAVAILABLE'));
  process.exitCode=1;
});
