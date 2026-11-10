import {describe,it,expect} from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import {app} from '../../server.js';
import {verifySignedCommand} from '../../agent-command-security.js';

describe('Device-scoped signed command API',()=>{
  it('does not permit GET enrollment with credentials in URL',async()=>{
    const result=await request(app).get('/api/v1/agent/enroll?bootstrap_token=sample');
    expect(result.status).toBe(405);
    expect(result.body.error).toBe('METHOD_NOT_ALLOWED');
  });
  it('enrolls device with a unique scoped key and signs short-lived commands',async()=>{
    const login=await request(app).post('/api/v1/auth/login').send({username:'admin',password:'Admin123!'});
    expect(login.status).toBe(200);
    const bearer='Bearer '+login.body.token;
    const packageResult=await request(app).post('/api/v1/msi/generate')
      .set('Authorization',bearer)
      .send({package_name:'CI-device-command-security-'+Date.now(),version:'1.1.2'});
    expect(packageResult.status).toBe(201);
    const host='CI-SIGNED-'+crypto.randomBytes(4).toString('hex').toUpperCase();
    const enrolled=await request(app).post('/api/v1/agent/enroll')
      .set('X-Bootstrap-Token',packageResult.body.bootstrap_token)
      .send({hostname:host,os_version:'Windows 11 Enterprise'});
    expect(enrolled.status).toBe(201);
    const dev=enrolled.body;
    expect(dev.device_token).toMatch(/^itk_dev_/);
    expect(dev.command_signing_key).toMatch(/^[a-f0-9]{64}$/);
    expect(dev.command_signing_key).not.toBe(process.env.COMMAND_SIGNING_KEY);

    const dispatch=await request(app).post('/api/v1/commands/dispatch')
      .set('Authorization',bearer)
      .send({device_id:host,kind:'reboot',payload:{delay_seconds:15}});
    expect(dispatch.status).toBe(201);

    const poll=await request(app).get('/api/v1/commands/poll')
      .set('X-Device-Token',dev.device_token)
      .query({hostname:host});
    expect(poll.status).toBe(200);
    expect(Array.isArray(poll.body)).toBe(true);
    const cmd=poll.body.find(c=>String(c.id)===String(dispatch.body.id));
    expect(cmd).toBeDefined();
    expect(cmd.signing_version).toBe(1);
    expect(verifySignedCommand(cmd,dev.command_signing_key,{
      id:dev.device_id,hostname:host
    },Date.now())).toMatchObject({id:String(dispatch.body.id),hostname:host,kind:'reboot'});

    const rejected=await request(app).get('/api/v1/commands/poll')
      .set('X-Device-Token',process.env.API_TOKEN)
      .query({hostname:host});
    expect(rejected.status).toBe(403);
    expect(rejected.body.error).toBe('DEVICE_ENROLLMENT_REQUIRED');
  });
});
