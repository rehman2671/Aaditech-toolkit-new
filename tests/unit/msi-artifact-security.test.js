import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createValidMsiFixture,isGenuineMsiArtifact,resolveAgentMsi} from '../../agent-artifacts.js';

describe('Windows MSI distribution fails closed',()=>{
  it('rejects synthetic CFB fixtures even if they have the correct magic header',()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aaditech-fixture-'));
    try{
      const target=path.join(dir,'fake.msi');
      createValidMsiFixture(target);
      expect(fs.statSync(target).size).toBe(1536);
      expect(fs.readFileSync(target).subarray(0,8).toString('hex')).toBe('d0cf11e0a1b11ae1');
      expect(isGenuineMsiArtifact(target)).toBe(false);
    }finally{fs.rmSync(dir,{recursive:true,force:true})}
  });
  it('rejects missing, invalid and tiny installer files',()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aaditech-msi-'));
    try{
      expect(isGenuineMsiArtifact(path.join(dir,'missing.msi'))).toBe(false);
      const fake=path.join(dir,'not-installer.msi');
      fs.writeFileSync(fake,Buffer.alloc(128*1024,0));
      expect(isGenuineMsiArtifact(fake)).toBe(false);
      fs.writeFileSync(fake,Buffer.alloc(80,0));
      expect(isGenuineMsiArtifact(fake)).toBe(false);
    }finally{fs.rmSync(dir,{recursive:true,force:true})}
  });
  it('rejects version path traversal before resolving artifact candidates',()=>{
    expect(resolveAgentMsi('../secrets').found).toBe(false);
    expect(resolveAgentMsi('../../1.2.3').found).toBe(false);
    expect(resolveAgentMsi('1.1.2/../../test').found).toBe(false);
  });
});
