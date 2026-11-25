import {it,expect} from 'vitest';
import {mkdtemp,mkdir,readdir,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withLocalSetupLock} from '../../scripts/local-setup-lock.mjs';
const onLinux=it.skipIf(process.platform!=='linux');
onLinux('rechecks lock custody on demand and releases after normal completion',async()=>{const root=await mkdtemp(join(await realpath(tmpdir()),'aaditech-lock-'));try{await withLocalSetupLock({confirmation:'ACQUIRE_LOCAL_SETUP_LOCK_ONLY',lockRoot:root},async({assertHeld})=>{await assertHeld();expect(await readdir(root)).toEqual(['setup.lock'])});expect(await readdir(root)).toEqual([])}finally{await rm(root,{recursive:true,force:true})}});
onLinux('detects unexpected sibling during operation and retains lock for manual review',async()=>{const root=await mkdtemp(join(await realpath(tmpdir()),'aaditech-lock-'));try{await expect(withLocalSetupLock({confirmation:'ACQUIRE_LOCAL_SETUP_LOCK_ONLY',lockRoot:root},async({assertHeld})=>{await mkdir(join(root,'unexpected'));await assertHeld()})).rejects.toThrow('SETUP_LOCK_CHANGED');expect((await readdir(root)).sort()).toEqual(['setup.lock','unexpected'])}finally{await rm(root,{recursive:true,force:true})}});
