import {it,expect,vi} from 'vitest';
import {completeInitialSetup,readPersistentSetupStatus} from '../../initial-setup-transaction.js';
const tenant='00000000-0000-0000-0000-000000000001',seed='$2b$10$TdjPGYqvBhQ/znxrISK4leR0Q7x4QAQW2ZGzOCAx.YK35eHrbROmW',passwordHash='$2b$10$'+'a'.repeat(53);
const body={server_host:'toolkit.example.com',admin_username:'newadmin',company_name:'Example IT',branding:{color:'#123456',logo_text:'Example'},build_mode:'manual'};
const admin={id:1,tenant_id:tenant,company_id:1,username:'admin',email:'admin@example.com',password_hash:seed,role:'SUPER_ADMIN',active:1,status:'ACTIVE'};
function fixture({complete=false,user=admin,membership=true,failed=false}={}){
 const query=vi.fn(async q=>{
 if(q.startsWith('SELECT setting_value'))return [[{setting_value:{setup_complete:complete}}]];
 if(q.includes("WHERE role='SUPER_ADMIN'"))return [[user]];
 if(q.includes('FROM user_workspace_memberships'))return [membership?[{user_id:1,tenant_id:tenant,role:'SUPER_ADMIN',status:'ACTIVE'}]:[]];
 if(q.startsWith('SELECT id,tenant_id,username'))return [[{...admin,username:body.admin_username,password_hash:passwordHash}]];
 if(q.startsWith('INSERT INTO audit_logs')&&failed)return [{affectedRows:0}];
 return [{affectedRows:1}];
 });
 const c={query,beginTransaction:vi.fn(),commit:vi.fn(),rollback:vi.fn(),release:vi.fn(),destroy:vi.fn()};return {c,db:{isMysqlConnected:()=>true,getPool:()=>({query,getConnection:async()=>c})}}
}
const input={body,configuredHost:body.server_host,passwordHash};
it('rotates factory credentials and closes bootstrap atomically without returning password hash',async()=>{const f=fixture();const r=await completeInitialSetup(f.db,input);expect(r.admin).toMatchObject({username:'newadmin',tenant_id:tenant});expect(r.admin).not.toHaveProperty('password_hash');expect(f.c.commit).toHaveBeenCalledOnce();expect(f.c.query.mock.calls.some(([q])=>q.includes("setting_key='branding' FOR UPDATE"))).toBe(true)});
it('refuses completed, altered factory identity, absent membership and failed audit',async()=>{for(const f of [fixture({complete:true}),fixture({user:{...admin,password_hash:passwordHash}}),fixture({membership:false}),fixture({failed:true})]){await expect(completeInitialSetup(f.db,input)).rejects.toThrow();expect(f.c.commit).not.toHaveBeenCalled();expect(f.c.rollback).toHaveBeenCalledOnce()}});
it('fails closed on unavailable persistence and mismatched configured hostname',async()=>{await expect(readPersistentSetupStatus({isMysqlConnected:()=>false})).rejects.toThrow();await expect(completeInitialSetup(fixture().db,{...input,configuredHost:'other.example.com'})).rejects.toThrow('SETUP_INVALID')});

it('clean profile cannot create a user without independent identity pins',async()=>{const f=fixture();f.c.query.mockImplementation(async q=>q.startsWith('SELECT setting_value')?[[{setting_value:{setup_complete:false,bootstrap_profile:'clean_install_v1',installation_id:'fixture',identity_sha256:'a'.repeat(64)}}]]:[{affectedRows:1}]);await expect(completeInitialSetup(f.db,{...input,body:{...body,admin_email:'new@example.com'}})).rejects.toThrow('SETUP_RECOVERY_REQUIRED');expect(f.c.commit).not.toHaveBeenCalled();expect(f.c.query.mock.calls.some(([q])=>q.startsWith('INSERT INTO users'))).toBe(false)});

it('discards an ambiguous first-run begin even when rollback succeeds',async()=>{const f=fixture();f.c.beginTransaction.mockRejectedValueOnce(Error('lost begin acknowledgement'));await expect(completeInitialSetup(f.db,input)).rejects.toThrow();expect(f.c.destroy).toHaveBeenCalledOnce();expect(f.c.release).not.toHaveBeenCalled()});
