import {appendFileSync,existsSync,readFileSync} from 'node:fs';
import {record} from './types.js';

/** Append explicit unknown terminal records only after OS-confirmed local owner death. */
export function closeDeadRequestTails(path:string): number {
 if(!existsSync(path))return 0;
 const events=readFileSync(path,'utf8').trim().split('\n').filter(Boolean).map(line=>record(JSON.parse(line)));
 const ended=new Set(events.filter(e=>e.event==='end').map(e=>e.requestId));let count=0;
 for(const start of events.filter(e=>e.event==='start'&&!ended.has(e.requestId))) {
  if(!Number.isInteger(start.pid)||Number(start.pid)<1)continue;
  try{process.kill(Number(start.pid),0);continue;}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')continue;}
  appendFileSync(path,JSON.stringify({event:'end',requestId:start.requestId,lease:start.lease,pid:start.pid,at:new Date().toISOString(),terminalState:'owner_dead',status:null,error:'os_confirmed_owner_dead',usage:null,rawUsage:null})+'\n');
  ended.add(start.requestId);count++;
 }
 return count;
}
