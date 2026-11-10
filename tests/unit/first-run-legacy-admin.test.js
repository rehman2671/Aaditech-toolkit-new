import {describe,it,expect} from 'vitest';
import bcrypt from 'bcrypt';
import {getStrictSetupState} from '../../first-run-routes.js';

function mockedDb(settingRow, legacyAdmins=[]) {
  return {
    isMysqlConnected:()=>true,
    executeQuery:async sql => {
      if(sql.includes('FROM system_settings'))return settingRow ? [settingRow] : [];
      if(sql.includes('FROM users'))return legacyAdmins;
      throw new Error('Unexpected SQL');
    }
  };
}

describe('Existing installation first-run migration safety',()=>{
  it('preserves existing owner when no setup flag exists but password was rotated',async()=>{
    const hash=await bcrypt.hash('PreviouslyChangedAndSecurePassword',10);
    const state=await getStrictSetupState(mockedDb(null,[{username:'admin',password_hash:hash}]));
    expect(state.setup_complete).toBe(true);
    expect(state.legacy_installation).toBe(true);
  });
  it('allows untouched seeded development owner to be replaced by protected local setup',async()=>{
    const hash=await bcrypt.hash('Admin123!',10);
    const state=await getStrictSetupState(mockedDb(null,[{username:'admin',password_hash:hash}]));
    expect(state.setup_complete).toBe(false);
  });
  it('does not auto-complete an explicitly incomplete setup despite non-seed user',async()=>{
    const hash=await bcrypt.hash('ChangedButWizardNotFinished',10);
    const state=await getStrictSetupState(mockedDb(
      {setting_value:JSON.stringify({setup_complete:false})},
      [{username:'admin',password_hash:hash}]
    ));
    expect(state.setup_complete).toBe(false);
  });
  it('returns completed status from durable branding when already installed',async()=>{
    const state=await getStrictSetupState(mockedDb({setting_value:{setup_complete:true}}));
    expect(state.setup_complete).toBe(true);
  });
});
