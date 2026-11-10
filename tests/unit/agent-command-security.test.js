import {describe,it,expect} from 'vitest';
import {deriveDeviceCommandKey,signCommandForDevice,verifySignedCommand} from '../../agent-command-security.js';

const master='test-only-hmac-master-do-not-deploy-3219';
const devA={id:'device-uuid-a',hostname:'WIN-TEST-01'};
const devB={id:'device-uuid-b',hostname:'WIN-TEST-02'};
const command={id:'cmd-001',kind:'reboot',payload:{delay_seconds:30}};
const now=Date.UTC(2026,10,11,2,0,0);

describe('Per-device expiring signed command envelopes',()=>{
  it('derives different keys for each device without exposing server secret',()=>{
    const k1=deriveDeviceCommandKey(master,devA.id);
    const k2=deriveDeviceCommandKey(master,devB.id);
    expect(k1).toMatch(/^[a-f0-9]{64}$/);
    expect(k2).not.toBe(k1);
    expect(k1).not.toBe(master);
  });
  it('signs and verifies a command only for its target device',()=>{
    const envelope={...command,...signCommandForDevice(master,devA,command,now)};
    const key=deriveDeviceCommandKey(master,devA.id);
    expect(verifySignedCommand(envelope,key,devA,now+30_000)).toMatchObject({
      id:command.id,device_id:devA.id,kind:'reboot',hostname:devA.hostname
    });
    expect(verifySignedCommand(envelope,deriveDeviceCommandKey(master,devB.id),devB,now+30_000)).toBeNull();
    expect(verifySignedCommand(envelope,key,devB,now+30_000)).toBeNull();
  });
  it('rejects unsigned, tampered, expired and future commands',()=>{
    const signed={...command,...signCommandForDevice(master,devA,command,now)};
    const key=deriveDeviceCommandKey(master,devA.id);
    for(const invalid of [
      {...signed,signature:'b'.repeat(64)},
      {...signed,signed_content:signed.signed_content.replace('reboot','run-script')},
      {...signed,id:'cmd-other'},
      {...signed,signature:null},
      {...signed,signed_content:'{}'},
    ])expect(verifySignedCommand(invalid,key,devA,now)).toBeNull();
    expect(verifySignedCommand(signed,key,devA,now+6*60_000)).toBeNull();
    expect(verifySignedCommand(signed,key,devA,now-2*60_000)).toBeNull();
  });
  it('does not permit arbitrary unstructured JSON payloads',()=>{
    expect(()=>signCommandForDevice(master,devA,{...command,payload:[]},now)).toThrow();
    expect(()=>deriveDeviceCommandKey('weak','x')).toThrow();
  });
});
