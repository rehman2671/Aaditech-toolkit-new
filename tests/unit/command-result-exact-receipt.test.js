import { afterEach, describe, expect, it } from 'vitest';
import * as db from '../../db.js';
const mode = process.env.NODE_ENV;
afterEach(() => {
  db.setConnectionStateForTesting(false, null);
  if (mode === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = mode;
});
const row = {
  id:'cmd-1', device_id:'device-1', status:'COMPLETED', stdout:'Measured OK ', stderr:'', exit_code:0,
  completed_at:'2026-11-24T00:00:00.123Z'
};
describe('authoritative exact command result receipt', () => {
  it('returns persisted time with only an ownership-scoped SELECT', async () => {
    process.env.NODE_ENV = 'production';
    const calls=[];
    db.setConnectionStateForTesting(true,{query:async(sql,args)=>{calls.push({sql,args});return [[row],[]]}});
    expect(await db.getExactCommandResultReceipt('cmd-1','device-1','completed','Measured OK ','',0))
      .toEqual({id:'cmd-1',status:'completed',completed_at:row.completed_at});
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/^SELECT .* WHERE id = \? AND device_id = \? LIMIT 1$/);
    expect(calls[0].args).toEqual(['cmd-1','device-1']);
    for (const [owner,status,output,stderr,exit] of [
      ['other','completed','Measured OK ','',0],
      ['device-1','failed','Measured OK ','',0],
      ['device-1','completed','MEASURED OK ','',0],
      ['device-1','completed','Measured OK','',0],
      ['device-1','completed','Measured OK ','changed',0],
      ['device-1','completed','Measured OK ','',1]
    ]) expect(await db.getExactCommandResultReceipt('cmd-1',owner,status,output,stderr,exit)).toBeNull();
  });
  it('rejects uncertain/missing/nonterminal records and never falls back outside tests', async () => {
    process.env.NODE_ENV = 'development';
    await expect(db.getExactCommandResultReceipt('cmd-1','device-1','completed','Measured OK ','',0)).rejects.toThrow('COMMAND_RESULT_RECEIPT_DATABASE_UNAVAILABLE');
    for (const rows of [[], [{...row,status:'IN_PROGRESS'}], [{...row,completed_at:null}], [{...row,exit_code:null}]]) {
      db.setConnectionStateForTesting(true,{query:async()=>[rows,[]]});
      expect(await db.getExactCommandResultReceipt('cmd-1','device-1','completed','Measured OK ','',0)).toBeNull();
    }
    db.setConnectionStateForTesting(true,{query:async()=>{throw Error('database lost')}});
    await expect(db.getExactCommandResultReceipt('cmd-1','device-1','completed','Measured OK ','',0)).rejects.toThrow('database lost');
  });
});
