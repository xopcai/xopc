/** Append-only independent inspection of a retained live Personal result; never regrades its original trial. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { serve } from '@hono/node-server';
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readRuntimeUsage } from '../evals/control/runtime-usage.mjs';

const option = (key: string) => { const i = process.argv.indexOf(key); assert.ok(i >= 0, key+' required'); return resolve(process.argv[i+1]); };
assert.ok(process.argv.includes('--configured-models'), 'Explicit authorization for one negative review required');
const reportPath=option('--report'), output=option('--output'); mkdirSync(output,{recursive:true});
const original=JSON.parse(readFileSync(reportPath,'utf8'));
const hash=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
const originalDb=join(original.isolatedStateDirectory,'xopc.db');
const before={report:hash(reportPath),db:hash(originalDb)};
const sourcePaths=['src/tasks/task-research-result.ts','src/usage/cloud-wire.ts','src/usage/recorder.ts','scripts/verify-personal-delivery-evidence.mts'];
const fingerprint=()=>Object.fromEntries(sourcePaths.map(path=>[path,hash(path)]));
const sourceHashes=fingerprint();
const sharedRoot=process.env.XOPC_STATE_DIR??join(homedir(),'.xopc');
const configPath=process.env.XOPC_CONFIG_PATH??join(sharedRoot,'xopc.json');
process.env.XOPC_CREDENTIALS_DIR??=join(sharedRoot,'credentials');
const db=new DatabaseSync(originalDb,{readOnly:true});
const checks:Array<{name:string;passed:boolean;error?:string}>=[];
const check=(name:string,fn:()=>void)=>{try{fn();checks.push({name,passed:true});}catch(error){checks.push({name,passed:false,error:error instanceof Error?error.message:String(error)});}};
const task=db.prepare('SELECT task_id FROM tasks LIMIT 1').get()!;
const run=db.prepare('SELECT * FROM task_runs WHERE task_id=? ORDER BY queued_at DESC LIMIT 1').get(task.task_id as string)!;
const delivery=db.prepare('SELECT * FROM task_result_deliveries WHERE task_run_id=?').get(run.run_id as string)!;
const outcome=JSON.parse(String(delivery.payload_json)).outcome;
const personal=db.prepare("SELECT conversation_id FROM sessions WHERE json_extract(custom_data_json,'$.personalAgent')=1 LIMIT 1").get()!;
const rows=db.prepare('SELECT e.payload_json FROM transcript_entries e JOIN transcripts t ON t.transcript_id=e.transcript_id WHERE t.conversation_id=? ORDER BY e.seq').all(personal.conversation_id as string).map(row=>JSON.parse(String(row.payload_json)));
check('structured_executor_identity',()=>assert.ok(rows.some(row=>row.customType==='task_allocation_status'&&row.details?.allocation?.selectedAgentId==='data-analyst'&&/开始执行|started/i.test(row.content))));
check('delivered_before_10min',()=>assert.ok(original.rawTimings.personalResultDelivered-original.rawTimings.requestSent<600000));
check('all_current_criteria_and_directions',()=>assert.ok(outcome.research.review==='model_reviewed'&&outcome.research.checks.every(c=>c.status==='passed')&&outcome.research.instructionChecks.every(c=>c.status==='passed')));
check('same_task_single_allocation',()=>{assert.equal(db.prepare('SELECT COUNT(*) n FROM tasks').get()!.n,1);assert.equal(db.prepare('SELECT attempts FROM task_allocations WHERE task_id=?').get(task.task_id as string)!.attempts,1);});
const repairCount=db.prepare("SELECT COUNT(*) n FROM task_run_events WHERE type='task_run.continuation_scheduled'").get()!.n;
process.env.XOPC_STATE_DIR=original.isolatedStateDirectory;
const {readMediaReference}=await import('../src/media/media-reference.js');
const contents=new Map<string,string>(); const artifacts:unknown[]=[];
for(const artifact of outcome.deliverables){const {buffer}=await readMediaReference(artifact.uri,100000);contents.set(artifact.title,buffer.toString('utf8'));artifacts.push({title:artifact.title,sha256:createHash('sha256').update(buffer).digest('hex'),bytes:buffer.length});}
check('all_four_final_artifacts',()=>{assert.deepEqual([...contents.keys()].sort(),['change_notes.md','monthly_summary.csv','report.md','reproduce.mjs']);assert.equal(outcome.deliverables.length,outcome.research.finalArtifactIds.length);assert.ok(outcome.deliverables.every(a=>outcome.research.finalArtifactIds.includes(a.artifactId)));});
check('independent_sales_totals',()=>{const csv=contents.get('monthly_summary.csv')!;assert.match(csv,/2026-01,150,/);assert.match(csv,/2026-02,210,40(?:\.0+)?/);});
check('direction_marker',()=>assert.ok(contents.get('change_notes.md')!.includes('REVISED-'+original.marker)));
check('file_loss_recovered',()=>{const deleted=original.injections.find(i=>i.kind==='published_file_deleted');assert.ok(deleted&&!outcome.research.finalArtifactIds.includes(deleted.artifactId));});
check('factual_limits',()=>{const text=contents.get('report.md')!;assert.match(text,/未公开|未披露|not disclosed/i);assert.match(text,/冲突|contradic|conflict/i);assert.match(text,/404/);assert.match(text,/不能|不区分|not.*permanent/i);});
const reproduction=join(output,'reproduction');mkdirSync(reproduction);
for(const title of ['monthly_summary.csv','reproduce.mjs'])writeFileSync(join(reproduction,title),contents.get(title)!);
writeFileSync(join(reproduction,'sales.csv'),'date,amount\n2026-01-01,100\n2026-01-15,50\n2026-02-01,120\n2026-02-15,90\n');
check('sandboxed_independent_reproduction',()=>{
 assert.equal(process.platform,'darwin','No silent unsandboxed fallback');
 const profile=`(version 1)(allow default)(deny network*)(deny file-write*)(allow file-write* (subpath ${JSON.stringify(realpathSync(reproduction))}))(deny file-read* (subpath ${JSON.stringify(join(homedir(),'.xopc'))}))`;
 const stdout=execFileSync('sandbox-exec',['-p',profile,process.execPath,'reproduce.mjs'],{cwd:reproduction,encoding:'utf8',timeout:10000,env:{PATH:process.env.PATH}});
 writeFileSync(join(output,'reproduction.stdout'),stdout);assert.match(stdout,/VERIFY OK|CHECK OK/i);
 assert.equal(readFileSync(join(reproduction,'monthly_summary.csv'),'utf8'),contents.get('monthly_summary.csv'));
});
const latency={requestToSubmit:original.rawTimings.taskPersisted-original.rawTimings.requestSent,initialReplyAfterSubmit:original.rawTimings.personalInitialCompleted-original.rawTimings.submitToolReturned,pingResponse:original.rawTimings.pingCompleted-original.rawTimings.pingSent,total:original.rawTimings.personalResultDelivered-original.rawTimings.requestSent};
const latencyGates={requestToSubmit:20000,initialReplyAfterSubmit:5000,pingResponse:5000};
const latencyFailures=Object.entries(latencyGates).filter(([key,limit])=>latency[key]>limit).map(([key,limit])=>({key,limit,actual:latency[key]}));
db.close();
const state=join(output,'review-state');mkdirSync(state);copyFileSync(originalDb,join(state,'xopc.db'));
for(const folder of ['cache/model-catalog'])if(existsSync(join(sharedRoot,folder)))cpSync(join(sharedRoot,folder),join(state,folder),{recursive:true});
process.env.XOPC_STATE_DIR=state;process.env.XOPC_CONFIG_PATH=configPath;process.env.XOPC_LOG_CONSOLE='false';
const {openXopcDatabase,closeXopcDatabase}=await import('../src/storage/sqlite/connection.js');
openXopcDatabase({path:join(state,'xopc.db')});
const {getSqliteDatabase}=await import('../src/storage/sqlite/transaction.js');
getSqliteDatabase().exec('DELETE FROM ai_usage_events');
const {reviewResearchResult,applyResearchReview}=await import('../src/tasks/task-research-result.js');
const source=outcome.research.sources.find(s=>s.excerpt.includes('Vendor A ASR: 1.00'));
assert.ok(source,'Retained pricing evidence required');
const negative={...outcome.research,finalArtifactIds:[],inspectedArtifactIds:[],instructionChecks:[],sources:[source],claims:[{id:'wrong-price',kind:'fact' as const,statement:'Vendor A ASR costs 100.00 CNY per hour.',sourceIds:[source.id],support:'unreviewed' as const}],checks:[],review:'unavailable' as const};
let negativeReview:unknown;
try{
 const raw=await reviewResearchResult({conversationId:String(run.conversation_id),brief:'Frozen-source independent negative review: inspect the Vendor A hourly price against its original quote.',criteria:['The hourly price follows the cited original source.'],result:negative},AbortSignal.timeout(30000));
 const reviewed=applyResearchReview(negative,raw,['The hourly price follows the cited original source.']);negativeReview=reviewed;
 check('real_wrong_price_rejected',()=>{assert.notEqual(reviewed.claims[0].support,'supported');assert.notEqual(reviewed.checks[0].status,'passed');});
}catch(error){checks.push({name:'real_wrong_price_rejected',passed:false,error:error instanceof Error?error.message:String(error)});}
finally{closeXopcDatabase();}
cpSync(join(original.isolatedStateDirectory,'media'),join(state,'media'),{recursive:true});
const isolatedConfig=JSON.parse(readFileSync(configPath,'utf8'));
const token=randomUUID();
isolatedConfig.gateway={...isolatedConfig.gateway,auth:{mode:'token',token},tailscale:{mode:'off'}};
if(isolatedConfig.tunnel)isolatedConfig.tunnel.enabled=false;
for(const channel of Object.values(isolatedConfig.channels??{}) as Array<{enabled:boolean}>)channel.enabled=false;
if(isolatedConfig.heartbeat)isolatedConfig.heartbeat.enabled=false;
isolatedConfig.userContext={...isolatedConfig.userContext,enabled:false};
const isolatedConfigPath=join(state,'xopc.json');writeFileSync(isolatedConfigPath,JSON.stringify(isolatedConfig),{mode:0o600});
process.env.XOPC_CONFIG_PATH=isolatedConfigPath;process.env.XOPC_CONFIG=isolatedConfigPath;
const {GatewayService}=await import('../src/gateway/service.js');
const {createHonoApp}=await import('../src/gateway/hono/app.js');
const gateway=new GatewayService({configPath:isolatedConfigPath,enableHotReload:false,listenPort:0});
let server:ReturnType<typeof serve>|undefined;
try {
 await gateway.start();server=serve({fetch:createHonoApp({service:gateway}).fetch,hostname:'127.0.0.1',port:0});
 if(!server.listening)await once(server,'listening');
 const base='http://127.0.0.1:'+(server.address() as {port:number}).port;
 for(const artifact of outcome.deliverables){
  const path=base+'/api/media/read?uri='+encodeURIComponent(artifact.uri)+'&conversationId='+personal.conversation_id;
  const denied=await fetch(path);const allowed=await fetch(path,{headers:{Authorization:'Bearer '+token}});
  const bytes=Buffer.from(await allowed.arrayBuffer());
  check('authenticated_download:'+artifact.title,()=>{assert.equal(denied.status,401);assert.equal(allowed.status,200);assert.equal(bytes.toString('utf8'),contents.get(artifact.title));});
 }
} finally {
 if(server){server.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>resolve()));}
 await gateway.stop();rmSync(isolatedConfigPath,{force:true});
}
writeFileSync(join(output,'runtime-usage.json'),JSON.stringify({mode:'post-close-readonly',finalSnapshotGuaranteed:true,rows:readRuntimeUsage(join(state,'xopc.db'))},null,2));
const unchanged=before.report===hash(reportPath)&&before.db===hash(originalDb);
const qualityPassed=checks.every(c=>c.passed)&&unchanged;
writeFileSync(join(output,'summary.json'),JSON.stringify({schemaVersion:1,manifest:{sourceHashes,sourceChangedDuringRun:JSON.stringify(sourceHashes)!==JSON.stringify(fingerprint())},createdAt:new Date().toISOString(),qualityPassed,originalTrialUnchanged:unchanged,originalTrialSuccess:original.success,originalFailure:original.failure,sourceReport:reportPath,originalHashes:before,checks,latency,latencyGates,latencyFailures,repairCount,artifacts,negativeReview,overallAcceptance:qualityPassed&&!latencyFailures.length,limitation:'Post-hoc independent supplement, not preregistered unseen quality validation; original grade is retained. Authenticated file downloads were verified through a new isolated Gateway using a clone; no rewrite of the original failed trial.'},null,2));
process.exit(qualityPassed?0:1);
