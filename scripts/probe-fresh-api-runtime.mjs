// Fixed local in-container fresh API admission probe. Never expose secrets,
// create accounts, modify data, publish ports or claim production readiness.
import {lookup} from 'node:dns/promises';
import {isIPv4} from 'node:net';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import mysql from 'mysql2/promise';
import {verifyBoundRuntimeHistory} from '../bound-runtime-schema.js';
const fail=()=>{throw Error('FRESH_API_RUNTIME_UNCONFIRMED')};
async function json(url){
 const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(5000)});
 if(!response.ok||!response.headers.get('content-type')?.startsWith('application/json'))fail();
 const reader=response.body?.getReader();if(!reader)fail();
 const chunks=[];let n=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;n+=value.byteLength;if(n>16384)fail();chunks.push(value)}}finally{await reader.cancel()}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function main(){
 const e=process.env,ip=process.argv[2];
 if(process.argv.length!==3||process.getuid?.()!==1000||process.getgid?.()!==1000||process.geteuid?.()!==1000||process.getegid?.()!==1000||e.NODE_ENV!=='production'||e.AADITECH_BOUND_REPORTS!=='enabled'||e.AADITECH_IDENTITY_DIRECTORY!=='/run/aaditech-identity'||e.DB_HOST!=='db'||e.DB_PORT!=='3306'||e.DB_NAME!=='it_toolkit'||e.DB_USER!=='itk_user'||e.PORT!=='3000'||!isIPv4(ip))fail();
 const [a,b]=ip.split('.').map(Number);
 if(a!==10&&!(a===172&&b>=16&&b<=31)&&!(a===192&&b===168))fail();
 const dns=async()=>{const rows=await lookup('db',{all:true});if(rows.length!==1||rows[0].address!==ip||rows[0].family!==4)fail()};
 await dns();
 const dir='/app/database/migrations',names=(await readdir(dir)).filter(x=>x.endsWith('.sql')&&!x.startsWith('.')).sort();
 const files=[];for(const name of names)files.push({name,sql:await readFile(join(dir,name),'utf8')});
 let c;
 try{
  c=await mysql.createConnection({host:ip,port:3306,user:e.DB_USER,password:e.DB_PASSWORD,database:e.DB_NAME,connectTimeout:5000});
  if(c.connection?.stream?.remoteAddress!==ip||c.connection?.stream?.remotePort!==3306)fail();
  const history=await verifyBoundRuntimeHistory(c,files,e);
  if(history.status!=='BOUND_RUNTIME_HISTORY_VERIFIED'||history.skipped.length!==24)fail();
  const health=await json('http://127.0.0.1:3000/healthz'),status=await json('http://127.0.0.1:3000/api/v1/setup/status');
  if(health.status!=='ok'||health.components?.database!=='HEALTHY'||status.setup_complete!==false||status.bootstrap_profile!=='clean_install_v1'||status.server_host!==e.SERVER_HOST)fail();
  await dns();await verifyBoundRuntimeHistory(c,files,e);await c.end();c=undefined;
  process.stdout.write(JSON.stringify({schema_version:1,non_root_verified:true,identity_verified:true,database_history_verified:true,private_database_verified:true,http_readiness_verified:true,clean_setup_verified:true,production_accepted:false})+'\n');
 }finally{if(c)c.destroy()}
}
main().catch(()=>{process.stderr.write('Fresh API runtime probe unconfirmed.\n');process.exitCode=1});
