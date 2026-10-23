import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe,it,expect} from 'vitest';
import {closeDeadRequestTails} from '../../control/terminal-audit.js';

describe('dead request tail journal',()=>{
 it('keeps alive owners and appends an idempotent unknown record only after death',async()=>{
  const root=mkdtempSync(join(tmpdir(),'eval-tail-')),path=join(root,'wire.jsonl');
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
  try{
   writeFileSync(path,JSON.stringify({event:'start',requestId:'r',lease:'l',pid:child.pid})+'\n');
   expect(closeDeadRequestTails(path)).toBe(0);
   child.kill('SIGKILL');await new Promise(resolve=>child.once('close',resolve));
   expect(closeDeadRequestTails(path)).toBe(1);expect(closeDeadRequestTails(path)).toBe(0);
   const rows=readFileSync(path,'utf8').trim().split('\n').map(line=>JSON.parse(line));
   expect(rows[1]).toMatchObject({event:'end',terminalState:'owner_dead',usage:null,error:'os_confirmed_owner_dead'});
   expect(rows).toHaveLength(2);
  }finally{child.kill();rmSync(root,{recursive:true,force:true});}
 });
});
