import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {appendFileSync,closeSync,cpSync,existsSync,lstatSync,mkdirSync,mkdtempSync,openSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {dirname,join,resolve,relative} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {EvalRunner,loadSuite} from '@agent-evals/runner';
import {EvalStore,ArtifactStore} from '@agent-evals/storage';
import {XopcGatewayAdapter} from '@agent-evals/adapter-xopc';
import {TraceEmitter,redactSensitive} from '@agent-evals/protocol';
import {createRecorder} from './prompt-ab-recorder.mjs';
import {gatewayConfig,waitForGateway,scrub,assertSafeArtifacts} from './run-github-eval.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const output=resolve(process.argv[2]??'.xopc-evals/prompt-ab-p2-2026-10-17');
const probe=process.argv.includes('--preflight-only');
const phase=probe?(process.env.PROMPT_AB_PREFLIGHT_TAG??'preflight'):(process.env.PROMPT_AB_LIVE_TAG??'main');
delete process.env.XOPC_EVAL_TOKEN;
const phaseDir=join(output,phase);mkdirSync(phaseDir,{recursive:false});
const convergence=process.argv.includes('--convergence');
const roots=convergence?{C:process.env.XOPC_EVAL_CANDIDATE_ROOT??'/Users/micjoyce/.codex/worktrees/benchmark-deepseek-convergence/xopc'}:{A:'/Users/micjoyce/.codex/worktrees/prompt-ab-a/xopc',B:'/Users/micjoyce/.codex/worktrees/prompt-ab-b/xopc'};
const arms=Object.keys(roots);
const refs=convergence?['deepseek/deepseek-flash']:['deepseek/deepseek-flash','minimax-cn/MiniMax-M2.7'];
const seed='prompt-p2-ab-2026-10-17-v1';
process.env.XOPC_LOG_LEVEL='fatal';
const {resolveModel,getApiKey}=await import('../../../src/providers/index.ts');
const {getModelThinking}=await import('../../../src/providers/model-thinking.ts');
const models=[];const keys=[];
for(const ref of refs){const m=resolveModel(ref);assert.equal(`${m.provider}/${m.id}`,ref);assert.ok(getModelThinking(m).options.includes('off'));const key=await getApiKey(m.provider);assert.ok(key,`Missing configured key for ${m.provider}`);keys.push(key);models.push({ref,provider:m.provider,id:m.id,api:m.api,baseUrl:m.baseUrl,cost:m.cost});}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function sourceHashes(directory) {
 const paths=execFileSync('git',['ls-files','-z','--','src','packages','extensions','package.json','pnpm-lock.yaml'],{cwd:directory,encoding:'utf8'}).split('\0').filter(Boolean);
 return Object.fromEntries(paths.map(path=>[path,sha(readFileSync(join(directory,path)))]));
}
const hashes=Object.fromEntries(arms.map(arm=>[arm,sourceHashes(roots[arm])]));
function harnessHashes(){
 const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z','--','evals/coder/packages','evals/coder/scripts','evals/coder/suites','evals/coder/apps'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
 return Object.fromEntries(files.map(p=>[p,sha(readFileSync(join(root,p)))]));
}
const initialHarnessHashes=harnessHashes();
const controlArchive=join(phaseDir,'control-plane-source');
for(const p of Object.keys(initialHarnessHashes)){const dest=join(controlArchive,p);mkdirSync(dirname(dest),{recursive:true});cpSync(join(root,p),dest);}

const allowed=path=>path.startsWith('src/agent/prompt/')||path==='src/agent/skills/format-skills-prompt.ts'||['prompts','communication','reply-style','persona'].some(name=>path===`src/personal-agent/${name}.ts`);
const baseline=convergence?sourceHashes('/Users/micjoyce/.codex/worktrees/prompt-ab-b/xopc'):hashes.A;
const candidate=convergence?hashes.C:hashes.B;
const changed=Object.keys(baseline).filter(path=>baseline[path]!==candidate[path]);assert.ok(changed.length>0);
if(!convergence)assert.ok(changed.every(allowed),'Runtime drift between prompt variants');
else assert.ok(changed.every(path=>allowed(path)||path==='src/agent/coding/run-verification.ts'||path==='src/agent/orchestration/loop-guard.ts'||path.endsWith('/__tests__/run-verification.test.ts')||path.endsWith('/__tests__/loop-guard.test.ts')),'Unexpected candidate runtime change');
const fixtures=join(phaseDir,'fixtures');mkdirSync(fixtures);
const suites=[];
for(const name of ['xopc-core','xopc-agent-growth','prompt-behavior']) {
 const dir=join(root,'evals/coder/suites',name);
 const f=JSON.parse(execFileSync(process.execPath,[join(dir,'create-fixture.mjs'),fixtures],{encoding:'utf8'}));
 if(name==='prompt-behavior'){process.env.EVAL_PROMPT_REPO=f.repo;process.env.EVAL_PROMPT_COMMIT=f.commit;}
 else {process.env.EVAL_FIXTURE_REPO=f.repo;process.env.EVAL_FIXTURE_COMMIT=f.commit;for(const [id,commit]of Object.entries(f.caseCommits??{}))process.env[`EVAL_FIXTURE_${id}_COMMIT`]=commit;}
 execFileSync('git',['bundle','create',join(fixtures,name+'.bundle'),'--all'],{cwd:f.repo});
 const s=await loadSuite(join(dir,'suite.yaml'));suites.push(s);
}
assert.equal(suites[0].contentHash,'b7335af765b54cee3c956b7ec7362925dd96c5b5d63f2acf305f30490c109cb5');
assert.equal(suites[1].contentHash,'df2333ee2f1ace2f135bf5d8ce8eef56bb0d72d836bd1842422df8994df88472');
const allCases=suites.flatMap(s=>s.cases);
assert.equal(allCases.length,31);
for(const c of suites[2].cases)assert.deepEqual(c.budget,{timeoutMs:180000,maxModelRequests:12,maxTokens:30000});
const suite={id:'prompt-p2-ab',version:'1.0.0',description:'Combined frozen suites; original contracts unchanged.',sourcePath:suites[2].sourcePath,contentHash:sha(suites.map(s=>s.contentHash).join('\n')),cases:probe?suites[2].cases:allCases};
const manifest={schemaVersion:1,evidenceClass:probe?'configuration-probe-no-model':convergence?'live-convergence-baseline':'live-prompt-only-ab',phase,startedAt:new Date().toISOString(),runtimeCommit:'666f2b245',models,thinkingLevel:'off',fallbacks:[],commonRuntimeFixture:{file:'shared-tool-exposure-fixture.patch',sha256:sha(readFileSync(join(output,'shared-tool-exposure-fixture.patch'))),configuration:'XOPC_EVAL_INLINE_SINGLE_SKILL_TOOLS=1',scope:'Only singleton skills_list / skill_view allowlists; other tool sets and verification unchanged',userAuthorized:true},repetitions:probe?1:3,seed,concurrency:2,suites:suites.map(s=>({id:s.id,version:s.version,hash:s.contentHash,cases:s.cases.map(c=>({id:c.id,budget:c.budget,fixtureCommit:c.repo.commit}))})),sourceHashes:hashes,harnessHashes:initialHarnessHashes,candidateChangedFiles:changed,comparisonBaseline:convergence?{directory:'.xopc-evals/prompt-ab-p2-2026-10-17',arm:'B',scoringVersion:'prompt-behavior@1.0.1',comparison:'historical matched runs; provider sampling and time uncontrolled',sourceHashes:baseline}:undefined,promptOnlyChangedFiles:convergence?undefined:changed,controls:{runtimeVerificationIdentical:!convergence,compactionImplementationIdentical:true,toolImplementationIdentical:true,credentials:'local environment only; redacted',cachePolicy:'same default runtime policy; provider cache state uncontrolled',providerRecorder:'same buffered forwarding for all arms; exact request payloads and response identifiers retained'},reviewRubric:{language:'English: Latin words with no Han prose; Simplified Chinese: at least 4 Han characters. Ambiguous language stays pending.',style:'Frozen explicit word/character limits and no-heading/bullet counts are deterministic. Formal/casual tone is blindly reviewed: formal is reserved and respectful without slang, casual is conversational and relaxed without ceremonial address. Ambiguous tone is manual_review.',falseSuccess:'Positive claims are reviewed against successful actual tool results and artifacts; capability limitations must be explicit.',blindLabels:'SHA256(seed, runId, turnIndex); arm key stored separately.'},rerunPolicy:'No automatic experiment reruns. Provider retries count against the original run budget. Infrastructure reruns require separate preserved experiment records.',environment:{node:process.version,platform:process.platform,arch:process.arch},frozenBeforeFirstModelRequest:true};
writeFileSync(join(phaseDir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
writeFileSync(join(phaseDir,'manifest.sha256'),sha(readFileSync(join(phaseDir,'manifest.json')))+'\n');
const processes=[];const states=[];const databases=[];const cohortResults=[];
let recorder;
const personalId='personal-'+sha('local-owner').slice(0,12);
async function port(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function api(context,path,body,method) {
 const r=await fetch(context.baseUrl+path,{method:method??(body===undefined?'GET':'POST'),headers:context.headers,...(body===undefined?{}:{body:JSON.stringify(body)}),signal:context.signal});
 const j=await r.json();if(!r.ok)throw new Error(`Infrastructure API ${path}: ${r.status} ${JSON.stringify(j)}`);return j.payload??j;
}
async function gateway(model,arm) {
 const state=mkdtempSync(join(tmpdir(),`xopc-prompt-${arm.toLowerCase()}-`));states.push(state);mkdirSync(join(state,'workspace'));
 const p=await port(),token=randomBytes(32).toString('hex');keys.push(token);
 const configPath=join(state,'xopc.json'),modelsPath=join(state,'models.json');
 const config=gatewayConfig(model.ref,join(state,'workspace'),p,token);writeFileSync(configPath,JSON.stringify(config),{mode:0o600});
 writeFileSync(modelsPath,JSON.stringify({providers:Object.fromEntries(models.map((m,i)=>[m.provider,{baseUrl:recorder.baseUrl+'/'+m.provider,apiKey:`PROMPT_AB_KEY_${i}`}]))}),{mode:0o600});
 const env={...process.env,XOPC_CONFIG:configPath,XOPC_CONFIG_PATH:configPath,XOPC_STATE_DIR:state,XOPC_WORKSPACE:join(state,'workspace'),XOPC_HOME:state,XOPC_MODELS_JSON:modelsPath,XOPC_EVAL_INLINE_SINGLE_SKILL_TOOLS:'1',XOPC_SKIP_CHANNELS:'1',XOPC_NO_RESPAWN:'1',XOPC_LOG_LEVEL:'info',XOPC_LOG_FILE:'false',PROMPT_AB_KEY_0:keys[0],PROMPT_AB_KEY_1:keys[1],DEEPSEEK_API_KEY:keys[0],MINIMAX_CN_API_KEY:keys[1]};
 execFileSync(process.execPath,['--import','tsx','evals/coder/scripts/prompt-ab-seed.mjs',state,model.ref],{cwd:roots[arm],env,stdio:'pipe'});
 const directory=join(phaseDir,'gateways',model.provider,arm);mkdirSync(directory,{recursive:true});writeFileSync(join(directory,'config.redacted.json'),JSON.stringify({...config,gateway:{...config.gateway,auth:{mode:'token',token:'[REDACTED]'}}},null,2));writeFileSync(join(directory,'models.json'),readFileSync(modelsPath));
 const log=join(state,'gateway.log'),fd=openSync(log,'w',0o600);const child=spawn(process.execPath,['--import','tsx','src/cli/bin.ts','gateway','--port',String(p),'--bind','loopback','--no-hot-reload'],{cwd:roots[arm],env,detached:true,stdio:['ignore',fd,fd]});processes.push({child,fd,log,directory});
 await waitForGateway(`http://127.0.0.1:${p}`,token,child);
 const db=new DatabaseSync(join(state,'xopc.db'));databases.push(db);db.exec('PRAGMA busy_timeout=5000');
 const agent=db.prepare('SELECT profile_json FROM agents WHERE id=?').get(personalId);assert.ok(agent);const profile=JSON.parse(agent.profile_json);
 return {arm,baseUrl:`http://127.0.0.1:${p}`,token,db,profile,state};
}
try {
 recorder=await createRecorder({output:phaseDir,models,keys,dryRun:probe});
 const gateways=new Map();
 for(const m of models)for(const arm of arms)gateways.set(`${m.ref}/${arm}`,await gateway(m,arm));
 const cohortOutcomes=await Promise.allSettled(models.map(async model=>{
  const cohortDir=join(phaseDir,model.provider);mkdirSync(cohortDir,{recursive:true});
  const store=new EvalStore(join(cohortDir,'evals.db'));const artifacts=new ArtifactStore(join(cohortDir,'artifacts'));
  const activeContext=new Map();
  const runTraces=new Map();
  const adapter=new XopcGatewayAdapter({
   async onSession(request,context){
    const g=gateways.get(`${model.ref}/${request.variant.id}`);const scenario=request.evalCase.scenario;
    activeContext.set(request.runId,{g,context,profile:scenario?.personal?g.profile:{name:'Mira',description:'Helpful executor',language:'en',style:'Formal'},trace:runTraces.get(request.runId)});
    if(scenario){
     const agentId=scenario.personal?personalId:'capability-eval';
     await api(context,`/api/agents/${agentId}`,{profile:scenario.personal?g.profile:{name:'Mira',description:'Helpful executor',language:'en',style:'Formal'},toolAllowlist:scenario.tools},'PATCH');
     if(scenario.personal)g.db.prepare("UPDATE sessions SET custom_data_json=json_set(COALESCE(custom_data_json,'{}'),'$.personalAgent',1) WHERE conversation_id=?").run(context.conversationId);
    }
   },
   async beforeTurn(request,context){
    const scenario=request.evalCase.scenario,action=scenario?.actions[context.turnIndex];
    const {g}=activeContext.get(request.runId);
    if(action?.profile){const entry=activeContext.get(request.runId);entry.profile={...entry.profile,...action.profile};await api(context,`/api/agents/${request.variant.agentId}`,{profile:entry.profile},'PATCH');}
    if(action?.compact&&!probe){
     const data=await api(context,`/api/sessions/${context.conversationId}/compaction/run`,{force:true});
     const r=data.result??data;await activeContext.get(request.runId).trace.emit('agent.event',{kind:'harness.compaction',turnIndex:context.turnIndex,result:r});
     if(!r.compacted)throw new Error('Infrastructure: forced compaction did not produce a boundary');
    }
   },
   async afterTurn(request,context){
    const data=await api(context,`/api/sessions/${context.conversationId}?include=transcript,transcriptRows`);
    const directory=join(phaseDir,'runs',request.runId);writeFileSync(join(directory,`turn-${context.turnIndex}-transcript.json`),JSON.stringify(redactSensitive(data),null,2));
   },
  });
  const original=adapter.run.bind(adapter),cleanup=adapter.cleanup.bind(adapter);
  adapter.run=async(request,onEvent,signal)=>{
   const g=gateways.get(`${model.ref}/${request.variant.id}`);request.variant.config={...request.variant.config,token:g.token};
   request.variant.agentId=request.evalCase.scenario?(request.evalCase.scenario.personal?personalId:'capability-eval'):'coder';
   const directory=join(phaseDir,'runs',request.runId);mkdirSync(directory,{recursive:true});
   const files=execFileSync('git',['ls-files','-z'],{cwd:request.environment.workspace,encoding:'utf8'}).split('\0').filter(Boolean);
   writeFileSync(join(directory,'initial-files.json'),JSON.stringify(Object.fromEntries(files.map(p=>[p,sha(readFileSync(join(request.environment.workspace,p)))])),null,2));
   const sink=async event=>{appendFileSync(join(directory,'trajectory.jsonl'),JSON.stringify(redactSensitive(event))+'\n');return onEvent(event);};
   const trace=new TraceEmitter(request.runId,sink);runTraces.set(request.runId,trace);
   recorder.activate(model.ref,request,sink,signal);
   const start=Date.now();console.log(`${model.ref} ${request.evalCase.id} ${request.variant.id} ${request.runId}`);
   try {
    return await original(request,event=>sink(['model.request','model.response'].includes(event.type)?{...event,type:'agent.event'}:event),signal);
   }finally{
    recorder.deactivate(model.ref);
    const outputs=join(directory,'workspace-final');mkdirSync(outputs);for(const entry of readdirSync(request.environment.workspace))if(entry!=='.git')cpSync(join(request.environment.workspace,entry),join(outputs,entry),{recursive:true,dereference:false});
    writeFileSync(join(directory,'run-metadata.json'),JSON.stringify({runId:request.runId,model:model.ref,arm:request.variant.id,caseId:request.evalCase.id,durationMs:Date.now()-start,budget:request.evalCase.budget},null,2));
   }
  };
  adapter.cleanup=async id=>{try{await cleanup(id);}finally{activeContext.delete(id);runTraces.delete(id);}};
  const runner=new EvalRunner({store,artifactStore:artifacts,adapters:[adapter]});
  const spec={name:`${convergence?'Execution convergence':'P2 prompt-only A/B'} ${model.ref} ${phase}`,repetitions:probe?1:3,randomizeVariantOrder:true,randomSeed:seed,variants:arms.map(arm=>({id:arm,adapter:'xopc',agentId:'coder',model:model.ref,reasoning:'off',config:{baseUrl:gateways.get(`${model.ref}/${arm}`).baseUrl}}))};
  try{const result=await runner.runExperiment(suite,spec);const detail=store.getExperiment(result.experimentId);writeFileSync(join(cohortDir,'results.json'),JSON.stringify(detail,null,2));cohortResults.push({model:model.ref,experimentId:result.experimentId,runs:result.runs.map(r=>({runId:r.runId,status:r.status,score:r.score,grades:r.grades}))});}
  finally{store.close();}
 }));
 writeFileSync(join(phaseDir,'cohort-outcomes.json'),JSON.stringify(cohortOutcomes.map((r,i)=>({model:models[i].ref,status:r.status,...(r.status==='rejected'?{error:scrub(String(r.reason?.stack??r.reason),keys)}:{})})),null,2));
 if(cohortOutcomes.some(r=>r.status==='rejected'))process.exitCode=1;
 const harnessDrift=JSON.stringify(harnessHashes())!==JSON.stringify(initialHarnessHashes);
 const drift=harnessDrift||Object.entries(roots).some(([arm,path])=>JSON.stringify(sourceHashes(path))!==JSON.stringify(hashes[arm]));
 writeFileSync(join(phaseDir,'results.json'),JSON.stringify({evidenceClass:manifest.evidenceClass,sourceDrift:drift,cohorts:cohortResults},null,2));
 writeFileSync(join(phaseDir,'completion.json'),JSON.stringify({completedAt:new Date().toISOString(),sourceDrift:drift,recordedRuns:cohortResults.reduce((s,c)=>s+c.runs.length,0)},null,2));
 if(drift||probe&&cohortResults.some(c=>c.runs.some(r=>['error','timed_out','budget_exceeded'].includes(r.status))))process.exitCode=1;
} catch(error) {writeFileSync(join(phaseDir,'error.json'),JSON.stringify({error:scrub(String(error.stack??error),keys),at:new Date().toISOString()},null,2));process.exitCode=1;console.error(scrub(String(error.message),keys));}
finally {
 for(const g of processes){try{process.kill(-g.child.pid,'SIGKILL');}catch{}closeSync(g.fd);if(existsSync(g.log))writeFileSync(join(g.directory,'gateway.log'),scrub(readFileSync(g.log,'utf8'),keys));}
 await recorder?.close();
 for(const db of databases)db.close();
 for(const state of states)rmSync(state,{recursive:true,force:true});
 assertSafeArtifacts(phaseDir,keys);
}
