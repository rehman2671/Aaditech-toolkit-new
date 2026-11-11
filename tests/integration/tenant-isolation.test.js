import {describe,it,expect,beforeAll} from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import * as db from '../../db.js';
import {app} from '../../server.js';
import {DEFAULT_TENANT_ID} from '../../tenant-security.js';

const unique=crypto.randomBytes(5).toString('hex');
const otherTenantId=crypto.randomUUID();
const adminHost='TK-ADMIN-'+unique.toUpperCase();
const otherHost='TK-OTHER-'+unique.toUpperCase();
const otherName='tenant_k_'+unique;
const password='TenantKDemo123!';
let adminToken,otherToken,adminDevice,otherDevice,otherUser;

function bearer(t){return 'Bearer '+t}

describe('Phase K cross-tenant isolation at API boundary',()=>{
  beforeAll(async()=>{
    const login=await request(app).post('/api/v1/auth/login')
      .send({username:'admin',password:'Admin123!'});
    expect(login.status).toBe(200);
    adminToken=login.body.token;

    otherUser=await db.createUser({
      username:otherName,email:otherName+'@example.test',
      password_hash:await bcrypt.hash(password,10),
      role:'SUPER_ADMIN',active:true,status:'ACTIVE',
      tenant_id:otherTenantId,company_id:1
    });
    const otherLogin=await request(app).post('/api/v1/auth/login')
      .send({username:otherName,password});
    expect(otherLogin.status).toBe(200);
    otherToken=otherLogin.body.token;

    const main=await request(app).post('/api/v1/devices')
      .set('Authorization',bearer(adminToken))
      .send({hostname:adminHost,os_type:'WINDOWS'});
    expect(main.status).toBe(201);
    adminDevice=main.body;

    const other=await request(app).post('/api/v1/devices')
      .set('Authorization',bearer(otherToken))
      .send({hostname:otherHost,os_type:'WINDOWS'});
    expect(other.status).toBe(201);
    otherDevice=other.body;
    expect(otherDevice.tenant_id).toBe(otherTenantId);
  });

  it('isolates device lists and hides internal credential hashes in detail',async()=>{
    const res=await request(app).get('/api/v1/devices')
      .set('Authorization',bearer(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.some(x=>x.id===adminDevice.id)).toBe(true);
    expect(res.body.some(x=>x.id===otherDevice.id)).toBe(false);

    const foreign=await request(app).get('/api/v1/devices/'+otherDevice.id)
      .set('Authorization',bearer(adminToken));
    expect(foreign.status).toBe(404);

    const detail=await request(app).get('/api/v1/devices/'+adminDevice.id)
      .set('Authorization',bearer(adminToken));
    expect(detail.status).toBe(200);
    for(const name of ['device_token_hash','auth_token_hash','device_token','device_token_prefix','command_signing_key']){
      expect(detail.body[name]).toBeUndefined();
    }
  });

  it('blocks other-tenant user, processes, app-usage and report details',async()=>{
    const requests=[
      '/api/v1/devices/'+otherDevice.id+'/processes',
      '/api/v1/devices/'+otherDevice.id+'/app-usage',
      '/api/v1/reports/device/'+otherDevice.id,
    ];
    for(const path of requests){
      const res=await request(app).get(path)
        .set('Authorization',bearer(adminToken));
      expect(res.status).toBe(404);
    }
    const users=await request(app).get('/api/v1/users')
      .set('Authorization',bearer(adminToken));
    expect(users.status).toBe(200);
    expect(users.body.some(u=>u.id===otherUser.id)).toBe(false);
    const update=await request(app).put('/api/v1/users/'+otherUser.id)
      .set('Authorization',bearer(adminToken)).send({active:false});
    expect(update.status).toBe(404);
  });

  it('refuses cross-tenant command dispatch and command history disclosure',async()=>{
    const forbidden=await request(app).post('/api/v1/commands/dispatch')
      .set('Authorization',bearer(adminToken))
      .send({device_id:otherDevice.id,kind:'reboot',payload:{delay_seconds:5}});
    expect(forbidden.status).toBe(404);

    const permitted=await request(app).post('/api/v1/commands/dispatch')
      .set('Authorization',bearer(otherToken))
      .send({device_id:otherDevice.id,kind:'reboot',payload:{delay_seconds:5}});
    expect(permitted.status).toBe(201);
    const list=await request(app).get('/api/v1/commands')
      .set('Authorization',bearer(adminToken));
    expect(list.status).toBe(200);
    expect(list.body.some(cmd=>cmd.id===permitted.body.id)).toBe(false);

    const submit=await request(app).post('/api/v1/commands/'+permitted.body.id+'/result')
      .set('X-Device-Token',adminDevice.device_token)
      .send({hostname:adminHost,status:'completed',output:'forged',exit_code:0});
    expect([401,403]).toContain(submit.status);

    const adminResult=await request(app).post('/api/v1/commands/'+permitted.body.id+'/result')
      .set('Authorization',bearer(adminToken))
      .send({status:'completed',output:'forged',exit_code:0});
    expect(adminResult.status).toBe(404);
  });

  it('denies bootstrap-driven credential takeover of an existing foreign endpoint',async()=>{
    const pkg=await request(app).post('/api/v1/msi/generate')
      .set('Authorization',bearer(otherToken))
      .send({package_name:'TK-conflict-'+unique,version:'1.1.3'});
    expect(pkg.status).toBe(201);
    const takeover=await request(app).post('/api/v1/agent/enroll')
      .set('X-Bootstrap-Token',pkg.body.bootstrap_token)
      .send({hostname:adminHost,os_version:'Windows 11'});
    expect(takeover.status).toBe(409);
    expect(takeover.body.error).toBe('DEVICE_ALREADY_ENROLLED');

    const unchanged=await db.getDeviceById(adminDevice.id);
    const expectedHash=crypto.createHash('sha256').update(adminDevice.device_token).digest('hex');
    expect(unchanged.device_token_hash).toBe(expectedHash);
    expect(unchanged.tenant_id).toBe(DEFAULT_TENANT_ID);
  });

  it('rejects role and tenant tampering even in a signed JWT',async()=>{
    const validOther=jwt.verify(otherToken,process.env.JWT_SECRET);
    const tamperedTenant=jwt.sign({...validOther,tenant_id:DEFAULT_TENANT_ID,jti:crypto.randomUUID()},
      process.env.JWT_SECRET,{algorithm:'HS256'});
    const rejected=await request(app).get('/api/v1/devices')
      .set('Authorization',bearer(tamperedTenant));
    expect(rejected.status).toBe(401);

    const ops=await request(app).post('/api/v1/auth/login')
      .send({username:'ops_lead',password:'Operator123!'});
    expect(ops.status).toBe(200);
    const opsClaims=jwt.verify(ops.body.token,process.env.JWT_SECRET);
    const forgedRole=jwt.sign({...opsClaims,role:'SUPER_ADMIN',jti:crypto.randomUUID()},
      process.env.JWT_SECRET,{algorithm:'HS256'});
    const roleEscalation=await request(app).post('/api/v1/groups')
      .set('Authorization',bearer(forgedRole))
      .send({name:'forged-'+unique});
    expect(roleEscalation.status).toBe(403);
  });

  it('denies exposing or overwriting records of an unrelated tenant via list query',async()=>{
    const params=['/api/v1/devices?tenant_id='+otherTenantId,
      '/api/v1/users?tenant_id='+otherTenantId,
      '/api/v1/commands?tenant_id='+otherTenantId];
    for(const path of params){
      const res=await request(app).get(path)
        .set('Authorization',bearer(adminToken));
      expect(res.status).toBe(200);
      const list=Array.isArray(res.body)?res.body:[];
      expect(list.some(x=>x.tenant_id===otherTenantId || x.id===otherDevice.id ||
        x.id===otherUser.id)).toBe(false);
    }
  });
});
