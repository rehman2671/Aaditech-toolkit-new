import {it,expect} from 'vitest';
import {renderPrivateLanServiceUnit as render,validateServiceStagingPolicy as validate,admitPrivateLanServicePolicy as admit} from '../../scripts/private-lan-service-policy.mjs';
const policy={policyDirectory:'/etc/aaditech/private-lan',policySha256:'a'.repeat(64),adapterLockRoot:'/var/lib/aaditech/adapter-lock'};
it('renders a fixed explicitly started, non-restarting service candidate with read-only system sandbox and one writable lock root',()=>{
 const u=render(policy);
 expect(u).toContain('Type=exec\nUser=root\nGroup=root');
 expect(u).toContain('ExecStart=/usr/bin/node /opt/aaditech/runtime/scripts/run-private-lan-service-cli.mjs --run-pinned-service '+policy.policyDirectory+'/forwarder-policy.json '+policy.policySha256+'\n');
 expect(u).toContain('Restart=no\n');expect(u).toContain('ProtectSystem=strict\n');
 expect(u).toContain('ReadWritePaths='+policy.adapterLockRoot+'\n');
 expect(u).toContain('NoNewPrivileges=yes\n');expect(u).toContain('KillMode=control-group\n');
 expect(u).not.toContain('[Install]');expect(u).not.toContain('WantedBy=');expect(u).not.toContain('ExecStartPre=');expect(u).not.toContain('/bin/sh');expect(u).not.toContain('EnvironmentFile=');
});
it.each([{policyDirectory:'/etc/x\nExecStart=/bin/sh'},{policyDirectory:'/etc/x y'},{policyDirectory:'/etc/%n'},{policyDirectory:'/etc/$HOME'},{policyDirectory:'/etc/../etc/x'},{policyDirectory:'relative'},{policyDirectory:'/opt/aaditech/runtime/policy'},{policyDirectory:'/var/lib/docker/volumes/x'},{policyDirectory:'/run/docker.sock'},{adapterLockRoot:'/var/lib/docker'},{adapterLockRoot:'/etc/aaditech/private-lan/lock'},{adapterLockRoot:'/'},{policySha256:'0'.repeat(64)},{policySha256:'a'.repeat(64)+'\n'},{policySha256:'bad'}])('refuses unsafe systemd policy %j',patch=>expect(()=>render({...policy,...patch})).toThrow());
it('denies staging without exact explicit confirmation and full live admission policy',()=>{
 for(const p of [null,{}, {confirmation:'yes'}, {confirmation:'STAGE_PINNED_PRIVATE_LAN_SERVICE_ONLY_EXCLUSIVE_OPERATOR_CUSTODY',policyDirectory:'/etc/aaditech/private-lan',stagingLockRoot:'/private/lock',existingPolicy:{live_stack_verified:true}}])expect(()=>validate(p)).toThrow();
});
it('rejects untrusted service pin and noncanonical file name before access',async()=>{
 for(const [p,s] of [['/etc/x/forwarder-policy.json','0'.repeat(64)],['/etc/x/other.json','a'.repeat(64)],['relative/forwarder-policy.json','a'.repeat(64)],['/etc/x/forwarder-policy.json\n','a'.repeat(64)]])await expect(admit(p,s)).rejects.toThrow();
});
