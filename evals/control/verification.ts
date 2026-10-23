import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {jobTiming} from './performance.js';
import {hash} from './evidence.js';
import {reconcileJob} from './reconciliation.js';
import {array,record} from './types.js';

/** Verify a new telemetry batch without rewriting prior product decisions or evidence. */
export function assessVerification(directory:string,registrationPath:string) {
 const registration=record(JSON.parse(readFileSync(registrationPath,'utf8'))),campaign=record(JSON.parse(readFileSync(join(directory,'campaign.json'),'utf8')));
 const reasons:string[]=[];
 if(!(Date.parse(String(registration.registeredAt))<Date.parse(String(campaign.startedAt)))) reasons.push('Registration did not precede execution');
 if(campaign.validity!=='valid'||campaign.sourceChanged!==false)reasons.push('Source or infrastructure invalid');
 const jobs=array(registration.jobs).map(record);
 if(!jobs.length)throw Error('No predeclared verification jobs');
 const reports=jobs.map(job=>{
  const id=String(job.id),personal=job.kind==='personal',cancellation=job.kind==='cancellation',path=join(directory,id,personal||cancellation?'summary.json':'benchmark/summary.json');
  if(!existsSync(path)){reasons.push(`${id}: missing summary`);return{id,passed:0,expected:Number(job.expected),complete:false};}
  const report=record(JSON.parse(readFileSync(path,'utf8'))),cases=array(personal||cancellation?report.trials:report.cases).map(record);
  const passed=cases.filter(c=>cancellation?c.success===true&&c.stopReason==='aborted'&&typeof c.canceledAt==='number'
    &&Number(c.finishedAt)-c.canceledAt<=17000&&Number(c.finishedAt)>=c.canceledAt
    &&Number(c.totalTokens)>0&&Number(c.inputTokens)>0&&Number(c.outputTokens)>0
    :personal?c.success===true:c.status==='passed'&&c.artifactChecksPassed===true).length;
  const complete=cases.length===job.expected;
  if(!personal&&!cancellation) {
   const manifest=record(JSON.parse(readFileSync(join(directory,id,'benchmark/manifest.json'),'utf8')));
   for(const [path,digest] of Object.entries(record(registration.candidateSourceHashes))) if(record(manifest.sourceHashes)[path]!==digest) reasons.push(`${id}: preregistered candidate hash mismatch ${path}`);
  }
  if(cancellation) {
   const manifest=record(report.manifest);
   if(manifest.sourceChangedDuringRun!==false)reasons.push(`${id}: cancellation source drift/unknown`);
   for(const [path,digest] of Object.entries(record(registration.candidateSourceHashes))) if(record(manifest.sourceHashes)[path]!==digest) reasons.push(`${id}: preregistered candidate hash mismatch ${path}`);
   const wire=join(directory,`${id}-model-requests.jsonl`), ledgerPath=join(directory,id,'runtime-usage.json');
   const events=existsSync(wire)?readFileSync(wire,'utf8').trim().split('\n').filter(Boolean).map(line=>record(JSON.parse(line))):[];
   const ends=events.filter(e=>e.event==='end'),rows=existsSync(ledgerPath)?array(record(JSON.parse(readFileSync(ledgerPath,'utf8'))).rows).map(record):[];
   if(ends.length!==job.expected||ends.some((end,index)=>{
    const raw=record(end.rawUsage),row=rows.find(row=>row.cloud_request_id===end.cloudRequestId),trial=cases[index];
    return !row||!trial||row.status!=='aborted'||row.input_tokens!==raw.prompt_tokens||row.output_tokens!==raw.completion_tokens
     ||trial.totalTokens!==raw.total_tokens||trial.inputTokens!==raw.prompt_tokens||trial.outputTokens!==raw.completion_tokens;
   }))reasons.push(`${id}: canceled input/output components or response identity failed`);
  }
  if(!complete)reasons.push(`${id}: incomplete denominator`);
  if(passed!==job.expected)reasons.push(`${id}: quality assertions failed (${passed}/${job.expected})`);
  if(job.sealed){
   const boundaryPath=join(directory,id,'sealed-boundary.json');
   const boundary=existsSync(boundaryPath)?record(JSON.parse(readFileSync(boundaryPath,'utf8'))):{};
   if(boundary.denialProbePassed!==true||boundary.appliesToGatewayAndDescendants!==true)reasons.push(`${id}: sealed boundary not verified`);
  }
  return{id,passed,expected:Number(job.expected),complete};
 });
 const reviewPath=join(directory,'protocol-review.json');
 const protocolReview=existsSync(reviewPath)?record(JSON.parse(readFileSync(reviewPath,'utf8'))):null;
 if(protocolReview?.blocking===true)reasons.push('Independent grading protocol concern requires review; original grades retained');
 const audit=jobs.map(job=>reconcileJob(directory,String(job.id)));
 for(const a of audit) {
  if(!a.requestCountMatched||!a.perRequestMatched||!a.usageMatched||a.unknownRequests!==0||!a.ledgerFinalSnapshotGuaranteed)reasons.push(`${a.id}: physical identity/usage/tail reconciliation failed`);
 }
 return{schemaVersion:1,decidedAt:new Date().toISOString(),scope:registration.scope??'Cloud usage and evaluation shutdown correction; no quality/efficiency promotion of the rejected 8-turn candidate',
  promotion:reasons.length?'rejected':'promoted',productionDefaultsChanged:false,reasons,protocolReview,reports,audit,timing:jobs.map(job=>jobTiming(directory,String(job.id),String(campaign.startedAt))),sourceHash:campaign.sourceHash,
  preregistrationHash:hash(readFileSync(registrationPath,'utf8')),physicalRequests:audit.reduce((n,a)=>n+a.physicalRequests,0),tokens:audit.every(a=>a.wireTokens!==null)?audit.reduce((n,a)=>n+a.wireTokens!,0):null,
  independentValidation:registration.independence,limitations:['Bounded configured Cloud HTTP transport; not arbitrary provider/native/WebSocket coverage.','Authoritative total is preserved without inferring unidentified cache components.','The prior 8-turn candidate remains rejected and its records are unchanged.']};
}
