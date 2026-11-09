import {describe,it,expect} from 'vitest';
import {setupSchema,systemConfigSchema,systemConfigTestSchema} from '../../validation.js';
const good={company_name:'Example Industries',server_host:'rmm.example.com',
 admin_username:'rootadmin',admin_password:'strong-unique-password-2026',
 branding:{color:'#38bdf8',logo_text:'Example'},build_mode:'manual',
 github_repo:'',smtp:{provider:'none'}};
describe('Setup and editable configuration contracts',()=>{
 it('accepts the required first-run data',()=>{
  expect(setupSchema.safeParse(good).success).toBe(true);
 });
 it('rejects unsafe, missing, weak or unknown fields',()=>{
  for(const candidate of [
   {...good,admin_password:'12345678'},{...good,company_name:''},
   {...good,server_host:'https://host.example/path'},
   {...good,setup_complete:true}
  ])expect(setupSchema.safeParse(candidate).success).toBe(false);
 });
 it('accepts allowed admin edits only',()=>{
  expect(systemConfigSchema.safeParse({server_host:'good.example'}).success).toBe(true);
  expect(systemConfigSchema.safeParse({clear_github_token:true}).success).toBe(true);
  expect(systemConfigSchema.safeParse({jwt_secret:'attack'}).success).toBe(false);
  expect(systemConfigTestSchema.safeParse({kind:'database'}).success).toBe(true);
  expect(systemConfigTestSchema.safeParse({kind:'arbitrary_url'}).success).toBe(false);
 });
});
