import {describe,it,expect} from 'vitest';
import request from 'supertest';
import {app} from '../../server.js';

describe('Cloud audit and ticket config fallback contracts',()=>{
  it('reports NOT_CONFIGURED without Azure Graph credentials, with actual fleet derived counts',async()=>{
    const login=await request(app).post('/api/v1/auth/login')
      .send({username:'admin',password:'Admin123!'});
    expect(login.status).toBe(200);
    const res=await request(app).get('/api/v1/compliance/cloud-audit')
      .set('Authorization','Bearer '+login.body.token);
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(res.body.status).toBe('NOT_CONFIGURED');
    expect(res.body.summary.azure_ad_sync).toBe('Not Configured');
    expect(res.body.cloud_services).toEqual([]);
    expect(Array.isArray(res.body.agent_compliance)).toBe(true);
    for(const device of res.body.agent_compliance){
      expect(typeof device.hostname).toBe('string');
      expect(device.azure_ad_joined).toBe(false);
      expect(device.intune_managed).toBe(false);
    }
  });
  it('serves ticket configuration through authenticated API',async()=>{
    const login=await request(app).post('/api/v1/auth/login')
      .send({username:'admin',password:'Admin123!'});
    expect(login.status).toBe(200);
    const res=await request(app).get('/api/v1/tickets/config')
      .set('Authorization','Bearer '+login.body.token);
    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
  });
});
