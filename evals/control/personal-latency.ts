import {existsSync,readFileSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {hash} from './evidence.js';
import {reconcileJob} from './reconciliation.js';
import {array,record} from './types.js';

/** Keep the full v7 verdict separate from foreground latency and request-accounting observations. */
export function assessPersonalLatency(directory:string,registrationPath:string,candidateRoot:string) {
 const read=(path:string)=>record(JSON.parse(readFileSync(path,'utf8')));
 const registration=read(registrationPath),campaign=read(join(directory,'campaign.json'));
 const reasons:string[]=[];
 if(!(Date.parse(String(registration.registeredAt))<Date.parse(String(campaign.startedAt))))reasons.push('Registration did not precede execution');
 if(campaign.validity!=='valid'||campaign.sourceChanged!==false||!['completed','failed'].includes(String(campaign.status)))reasons.push('Source or execution validity failed');
 const sourceHashes=record(registration.candidateSourceHashes);
 if(!Object.keys(sourceHashes).length)reasons.push('Candidate hashes missing');
 for(const [path,digest] of Object.entries(sourceHashes)){
  const target=resolve(candidateRoot,path);
  if(!target.startsWith(resolve(candidateRoot)+sep)||!existsSync(target)||hash(readFileSync(target))!==digest)reasons.push(`Candidate hash mismatch: ${path}`);
 }
 const summaryPath=join(directory,'personal/summary.json');
 const summary=existsSync(summaryPath)?read(summaryPath):{};
 const trials=array(summary.trials).map(record);
 if(summary.suiteVersion!==7||summary.total!==1||trials.length!==1)reasons.push('Expected one complete v7 mixed trial');
 if(summary.requestedRounds!==1||JSON.stringify(summary.requestedScenarios)!==JSON.stringify(['mixed']))reasons.push('Mixed trial selection mismatch');
 const trial=trials[0]??{};
 const reportPath=join(directory,'personal/mixed-round-1.json');
 const report=existsSync(reportPath)?read(reportPath):{};
 const timing=record(report.rawTimings),elapsed=(end:string,start:string)=>typeof timing[end]==='number'&&typeof timing[start]==='number'?Number(timing[end])-Number(timing[start]):null;
 const latency:Record<string,number|null>={requestToSubmit:elapsed('taskPersisted','requestSent'),initialReplyAfterSubmit:elapsed('personalInitialCompleted','submitToolReturned'),pingResponse:elapsed('pingCompleted','pingSent'),total:elapsed('personalResultDelivered','requestSent')};
 const thresholds={requestToSubmit:20000,initialReplyAfterSubmit:5000,pingResponse:5000,total:600000};
 const gate=record(registration.gate);
 if(gate.requestToSubmitMs!==20000||gate.acknowledgementMs!==5000||gate.pingMs!==5000||gate.totalMs!==600000||gate.submitHostMs!==250)reasons.push('Latency gates changed or missing');
 const latencyFailures=Object.entries(thresholds).filter(([key,limit])=>latency[key]===null||latency[key]!<0||latency[key]!>limit).map(([key,limit])=>({key,limit,actual:latency[key]}));
 for(const item of latencyFailures)reasons.push(`Latency failed: ${item.key} (${item.actual??'unknown'}/${item.limit} ms)`);
 if(typeof timing.submitToolMs!=='number'||timing.submitToolMs>250)reasons.push('Local submit persistence gate failed');
 if(trial.success!==true||report.success!==true)reasons.push(`Full v7 acceptance failed: ${report.failure??trial.failure??'unknown'}`);
 if(record(report.benchmark).version!==7||record(report.benchmark).sourceChangedDuringRun!==false)reasons.push('Trial source or protocol mismatch');
 const audit=reconcileJob(directory,'personal');
 if(!audit.perRequestMatched||!audit.usageMatched||audit.unknownRequests!==0||!audit.ledgerFinalSnapshotGuaranteed)reasons.push('Request identity, token or tail reconciliation failed');
 const pool=record(campaign.pool);
 if(pool.active!==0||pool.queued!==0)reasons.push('Request pool not idle');
 return{schemaVersion:1,decidedAt:new Date().toISOString(),scope:'Personal v7 mixed regression and fixed foreground latency gates; no general SLA claim',promotion:reasons.length?'rejected':'promoted',reasons,
  reports:[{id:'personal-v7-mixed',passed:trial.success===true?1:0,expected:1}],audit:[audit],physicalRequests:audit.physicalRequests,tokens:audit.wireTokens,
  personalAcceptance:{deliveryCompleted:latency.total!==null,qualityLabel:'完整 v7 验收',deliveredInMs:latency.total,qualityChecks:null,qualityPassed:trial.success===true,latency,latencyFailures,originalGradeRetained:true,overallAccepted:reasons.length===0,sourceReport:reportPath},
  latency,thresholds,models:report.models,sourceHash:campaign.sourceHash,preregistrationHash:hash(readFileSync(registrationPath)),productionDefaultsChanged:false,
  independentValidation:'Frozen disclosed mixed regression, real router and workers, v7 download/negative-review assertions, independent HTTP/runtime usage reconciliation; not an unseen holdout.',
  limitations:['Single live trial per candidate; provider variation is not an established latency SLA.','Original failures remain immutable; no threshold relaxation or deterministic ping bypass.']};
}
