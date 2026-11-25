// Local operator only; never invoked by the HTTP server or automatically.
import mysql from 'mysql2/promise';
import {identityPolicy,bindFreshDatabaseIdentity} from '../installation-database-identity.js';
const env=process.env;
async function main(){
 if(process.argv.length!==3||process.argv[2]!=='--bind-empty-database'||
    !['127.0.0.1','::1'].includes(env.DB_HOST)||!env.DB_USER||!env.DB_PASSWORD||
    !/^[a-zA-Z0-9_]{1,64}$/.test(env.DB_NAME??'')||
    !/^[1-9][0-9]{0,4}$/.test(env.DB_PORT??'3306')||Number(env.DB_PORT??3306)>65535)throw Error();
 const policy=identityPolicy(env);
 const c=await mysql.createConnection({host:env.DB_HOST,port:Number(env.DB_PORT??3306),user:env.DB_USER,password:env.DB_PASSWORD,database:env.DB_NAME,connectTimeout:5000});
 try{const r=await bindFreshDatabaseIdentity(c,policy,'BIND_EMPTY_DATABASE_TO_PINNED_IDENTITY_ONLY');process.stdout.write(JSON.stringify(r)+'\n')}
 finally{await c.end()}
}
main().catch(()=>{process.stderr.write('Database identity binding refused; verify exclusive fresh DB and local identity pins.\n');process.exitCode=1});
