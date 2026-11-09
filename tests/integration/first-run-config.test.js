import {describe,it,expect} from 'vitest';
import request from 'supertest';
import {app} from '../../server.js';
describe('System configuration authorization',()=>{
 it('rejects anonymous configuration reads and updates',async()=>{
  expect((await request(app).get('/api/v1/system/config')).status).toBe(401);
  expect((await request(app).patch('/api/v1/system/config').send({company_name:'Injected'})).status).toBe(401);
 });
 it('rejects non-admin users and does not expose credential fields',async()=>{
  const ops=await request(app).post('/api/v1/auth/login').send({username:'ops_lead',password:'Operator123!'});
  expect(ops.status).toBe(200);
  const denial=await request(app).get('/api/v1/system/config').set('Authorization','Bearer '+ops.body.token);
  expect(denial.status).toBe(403);
  const admin=await request(app).post('/api/v1/auth/login').send({username:'admin',password:'Admin123!'});
  expect(admin.status).toBe(200);
  const data=await request(app).get('/api/v1/system/config').set('Authorization','Bearer '+admin.body.token);
  expect(data.status).toBe(200);
  expect(data.body).not.toHaveProperty('github_token');
  expect(data.body.smtp).not.toHaveProperty('password_encrypted');
  expect(data.body.smtp).not.toHaveProperty('password');
 });
 it('rejects invalid host settings before DB writes',async()=>{
  const admin=await request(app).post('/api/v1/auth/login').send({username:'admin',password:'Admin123!'});
  const data=await request(app).patch('/api/v1/system/config')
   .set('Authorization','Bearer '+admin.body.token).send({server_host:'https://bad/path'});
  expect(data.status).toBe(400);
 });
});
