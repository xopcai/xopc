import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {record,type Row} from './types.js';

/** Descriptive occupied-time measurements; overlapping spans are never added to claim wall time. */
export function jobTiming(directory:string,id:string,campaignStart:string) {
 const campaign=record(JSON.parse(readFileSync(join(directory,'campaign.json'),'utf8'))),job=record(record(campaign.jobs)[id]);
 const path=join(directory,`${id}-model-requests.jsonl`),wire=existsSync(path)?readFileSync(path,'utf8').trim().split('\n').filter(Boolean).map(line=>record(JSON.parse(line))):[];
 const starts=new Map(wire.filter(e=>e.event==='start').map(e=>[e.requestId,Date.parse(String(e.at))]));
 const httpOccupiedMs=wire.filter(e=>e.event==='end'&&starts.has(e.requestId)).reduce((n,e)=>n+Math.max(0,Date.parse(String(e.at))-starts.get(e.requestId)!),0);
 let firstScorableMs:number|null=null,firstFailureMs:number|null=null,toolOccupiedMs:number|null=null,graderOccupiedMs:number|null=null;
 const dbPath=join(directory,id,'benchmark/evals.db');
 if(existsSync(dbPath)){
  const db=new DatabaseSync(dbPath,{readOnly:true});
  try{
   const runs=db.prepare('SELECT status,ended_at FROM eval_runs WHERE ended_at IS NOT NULL ORDER BY ended_at').all();
   if(runs[0])firstScorableMs=Date.parse(String(runs[0].ended_at))-Date.parse(campaignStart);
   const failed=runs.find(r=>r.status!=='passed');if(failed)firstFailureMs=Date.parse(String(failed.ended_at))-Date.parse(campaignStart);
   const events=db.prepare("SELECT run_id,type,timestamp,payload_json FROM eval_run_events WHERE type IN ('tool.started','tool.finished','verification.started','verification.finished') ORDER BY timestamp,seq").all();
   const active=new Map<string,number>();toolOccupiedMs=0;graderOccupiedMs=0;
   for(const e of events){const payload=record(JSON.parse(String(e.payload_json))),isTool=String(e.type).startsWith('tool.');
    const key=`${e.run_id}/${isTool?record(payload.payload).toolCallId:payload.graderIndex}/${isTool?'tool':'grader'}`;
    if(String(e.type).endsWith('started'))active.set(key,Date.parse(String(e.timestamp)));
    else if(active.has(key)){const ms=Math.max(0,Date.parse(String(e.timestamp))-active.get(key)!);if(isTool)toolOccupiedMs+=ms;else graderOccupiedMs+=ms;active.delete(key);}
   }
  }finally{db.close();}
 }
 return{id,jobWallMs:job.durationMs??null,startAfterCampaignMs:job.startedAt?Date.parse(String(job.startedAt))-Date.parse(campaignStart):job.endedAt&&typeof job.durationMs==='number'?Date.parse(String(job.endedAt))-job.durationMs-Date.parse(campaignStart):null,httpOccupiedMs,toolOccupiedMs,graderOccupiedMs,firstScorableMs,firstFailureMs,limitations:'Occupied spans overlap across requests/tools/jobs; they are not additive wall time. Missing failure means no observed failure, not zero latency.'};
}
export function queueTiming(events:Row[]) {
 const queued=new Map<string,number>();const waits:number[]=[];
 for(const e of events){const event=record(record(e.data).event),lease=String(event.lease);if(event.type==='queued')queued.set(lease,Date.parse(String(e.at)));else if(event.type==='acquired'&&queued.has(lease)){waits.push(Math.max(0,Date.parse(String(e.at))-queued.get(lease)!));queued.delete(lease);}}
 return{observedAdmissions:waits.length,sumWaitMs:waits.reduce((a,b)=>a+b,0),maxWaitMs:waits.length?Math.max(...waits):null,scope:'Local broker queue event to acquired event; shared upstream queue is separate when configured.'};
}
