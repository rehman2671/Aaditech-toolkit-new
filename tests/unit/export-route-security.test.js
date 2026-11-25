import {beforeAll,afterEach,it,expect,vi} from 'vitest';
import request from 'supertest';
import * as db from '../../db.js';
import {app} from '../../server.js';
let token;
beforeAll(async()=>{const response=await request(app).post('/api/v1/auth/login').send({username:'admin',password:'Admin123!'});expect(response.status).toBe(200);token=response.body.token});
afterEach(()=>vi.restoreAllMocks());
const tenant='00000000-0000-0000-0000-000000000001';
const device={id:'csv-fixture',tenant_id:tenant,hostname:'=1+1',os_version:'Windows "test"',ip_address:'@unsafe',agent_version:'1.0',status:'online'};
const auth=path=>request(app).get(path).set('Authorization','Bearer '+token);
function fixtures(){
 const getDevices=vi.spyOn(db,'getDevices').mockResolvedValue([device]);
 const getDevice=vi.spyOn(db,'getDeviceById').mockResolvedValue(device);
 const processes=vi.spyOn(db,'getDeviceProcesses').mockResolvedValue([{name:' +SUM(1,2)',path:'C:/fixture'},{name:'plain "text"',path:'C:/fixture2'}]);
 const events=vi.spyOn(db,'getEvents').mockResolvedValue([{kind:'@unsafe',created_at:'2026-11-26T00:00:00Z'}]);
 return {getDevices,getDevice,processes,events};
}
for(const path of ['/api/v1/software/export','/api/software/export'])it('safe software CSV '+path,async()=>{
 const f=fixtures(),r=await auth(path);expect(r.status).toBe(200);expect(r.headers['content-type']).toContain('text/csv');expect(r.text).toContain('"\'=1+1","\' +SUM(1,2)"');expect(r.text).toContain('"plain ""text"""');expect(f.getDevices).toHaveBeenCalledWith({tenant_id:tenant});expect(f.processes).toHaveBeenCalledWith(device.id);
});
for(const path of ['/api/v1/license/export','/api/license/export'])it('safe license CSV '+path,async()=>{fixtures();const r=await auth(path);expect(r.status).toBe(200);expect(r.text).toContain('"\'=1+1","UNKNOWN","NOT_CONFIGURED","UNKNOWN"')});
for(const path of ['/api/v1/reports/fleet','/api/report/fleet'])it('safe fleet CSV '+path,async()=>{fixtures();const r=await auth(path);expect(r.status).toBe(200);expect(r.text).toContain('"\'=1+1","Windows ""test""","\'@unsafe"')});
for(const path of ['/api/v1/reports/device/csv-fixture','/api/report/agent/csv-fixture']){
 it('safe event CSV '+path,async()=>{const f=fixtures(),r=await auth(path+'?format=csv');expect(r.status).toBe(200);expect(r.headers['content-disposition']).toBe('attachment; filename="1_1_events.csv"');expect(r.text).toContain('"\'=1+1","\'@unsafe"');expect(f.events).toHaveBeenCalledWith(device.hostname,100,null,tenant,device.id)});
 it('foreign device export denied '+path,async()=>{const f=fixtures();f.getDevice.mockResolvedValue({...device,tenant_id:'foreign'});const r=await auth(path+'?format=csv');expect(r.status).toBe(404);expect(f.events).not.toHaveBeenCalled()});
 it('JSON report remains unchanged '+path,async()=>{fixtures();const r=await auth(path);expect(r.status).toBe(200);expect(r.body[0].kind).toBe('@unsafe')});
}
