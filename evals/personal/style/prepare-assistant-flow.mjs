/** Freeze one control and one experimental source, then register before live calls. */
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {parseArgs} from 'node:util';
const {values,positionals}=parseArgs({args:process.argv.slice(2),allowPositionals:true,options:{fixtures:{type:'string'},candidate:{type:'string'},'previous-cycle':{type:'string'}}});
const out=positionals[0]&&resolve(positionals[0]);
const recoveryOf=positionals[1]&&resolve(positionals[1]);
const previousCycle=values['previous-cycle']&&resolve(values['previous-cycle']);
if(!out||existsSync(out))throw Error('Pass a new absolute output directory');
const root=process.cwd(),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
mkdirSync(out,{recursive:true,mode:0o700});
const fixture=resolve(values.fixtures??'evals/personal/style/assistant-flow-dialogues-v1.json'),candidatePath=resolve(values.candidate??'evals/personal/style/assistant-flow-candidate-v1.json'),candidate=JSON.parse(readFileSync(candidatePath,'utf8'));
const cohort=JSON.parse(readFileSync(fixture,'utf8'));
if(previousCycle){const old=JSON.parse(readFileSync(join(previousCycle,'registration.json'),'utf8'));const exposed=new Set([...old.development,...old.validation]);if(cohort.cases.some(c=>c.split==='validation'&&exposed.has(c.id)))throw Error('Exposed scenes cannot be reused as new validation');}
const baseline=join(out,'baseline-source'),patched=join(out,'candidate-source');
execFileSync(process.execPath,['evals/personal/style/snapshot.mjs',baseline],{stdio:'inherit'});
execFileSync(process.execPath,['evals/personal/style/snapshot.mjs',patched],{stdio:'inherit'});
const changes=candidate.changes??[{module:candidate.module,replacements:candidate.replacements,rule:candidate.rule}];
const changedModules=changes.map(c=>c.module);
if(new Set(changedModules).size!==changedModules.length)throw Error('Duplicate candidate modules');
if(candidate.baselineRef){
 for(const change of changes){
  const original=execFileSync('git',['show',candidate.baselineRef+':'+change.module],{cwd:root});
  for(const path of [baseline,patched])writeFileSync(join(path,change.module),original);
 }
 execFileSync('git',['add',...changedModules],{cwd:baseline});
 execFileSync('git',['-c','user.name=Eval snapshot','-c','user.email=eval@localhost','commit','-q','-m','Freeze declared pre-change baseline'],{cwd:baseline});
}
for(const change of changes){
 const module=join(patched,change.module),before=readFileSync(module,'utf8');let after=before;
 if(change.replacements){for(const patch of change.replacements){if(after.split(patch.before).length!==2)throw Error('Candidate patch must match exactly once');after=after.replace(patch.before,patch.after);}}
 else after=before.replace('export const PERSONAL_REPLY_STYLE_RULES = [','export const PERSONAL_REPLY_STYLE_RULES = [\n  '+JSON.stringify(change.rule)+',');
 if(before===after)throw Error('Candidate insertion point missing');writeFileSync(module,after);
}
execFileSync('git',['add',...changedModules],{cwd:patched});
execFileSync('git',['-c','user.name=Eval snapshot','-c','user.email=eval@localhost','commit','--allow-empty','-q','-m','Freeze experimental conversation rules'],{cwd:patched});
const files=execFileSync('git',['ls-files','-z'],{cwd:baseline,encoding:'utf8'}).split('\0').filter(Boolean);
const differences=files.filter(p=>hash(readFileSync(join(baseline,p)))!==hash(readFileSync(join(patched,p)))).filter(p=>p!=='.xopc-source-origin.json');
if(JSON.stringify([...differences].sort())!==JSON.stringify([...changedModules].sort()))throw Error('Undeclared condition differences: '+differences.join(','));
const cases=JSON.parse(readFileSync(fixture,'utf8')).cases;
const runDate=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'}),runStamp=runDate.replaceAll('-','');
const plan={schemaVersion:1,runDate, ...(recoveryOf ? {methodologyRecoveryOf:recoveryOf,methodologyRepair:'Gateway.stop closes the application DB handle. Use an independent read-only connection for the final ledger; filter scripted latency extensions from the upstream EQ CompletionResult contract. Original complete captures and cleanup failures are retained; no style scores inspected when this recovery was registered.'} : {}),registeredAt:new Date().toISOString(),suite:'personal-assistant-flow-zh-v'+(cohort.protocolVersion??1),previousCycle:previousCycle??null,candidateSpec:candidatePath,candidateSpecSha256:hash(readFileSync(candidatePath)),model:'xopc-cloud/openai-codex/gpt-5.6-sol',judge:'xopc-cloud/openai-codex/gpt-6.1-sol',reasoning:'off',evaluatorReasoning:'low',personalProfile:'fresh-production-default',concurrency:2,transportRetries:0,
 expectedScenes:cases.length,expectedUserInputs:cases.reduce((n,c)=>n+c.userTurns.length*2,0),expectedJudgeCalls:cases.length*2,
 development:cases.filter(c=>c.split==='development').map(c=>c.id),validation:cases.filter(c=>c.split==='validation').map(c=>c.id),fixture,fixtureSha256:hash(readFileSync(fixture)),
 baselineRef:candidate.baselineRef??null,candidateRuleSha256:hash(candidate.rule??JSON.stringify(changes)),conditions:[baseline,patched].map(path=>({path,commit:execFileSync('git',['rev-parse','HEAD'],{cwd:path,encoding:'utf8'}).trim(),moduleSha256:changedModules.length===1?hash(readFileSync(join(path,changedModules[0]))):null,moduleHashes:Object.fromEntries(changedModules.map(module=>[module,hash(readFileSync(join(path,module)))]))})),onlyChangedModule:changedModules.length===1?changedModules[0]:null,changedModules,
 gate:{validationOverallMinNetWins:1,validationNaturalnessMinNetWins:1,noCandidateMajorEitherOrder:true,validationViolationsNonincrease:true,validationP95LatencyRatio:1.2,minIndependentHumanReviewers:2,completeDenominatorRequired:true},
 budget:{generationMaxRequests:2*Math.max(90,cases.reduce((n,c)=>n+c.userTurns.length,0)+15),judgeMaxRequests:Math.max(40,cases.length*2+8),totalWallMs:1800000,requestTimeoutMs:240000},
 limitations:['Product-authored fixed continuations, not observed adaptive human behavior','Single judge, swapped orders correlated','No paid unchanged rerun, no score-based replacement','No production adoption before human review; task execution transitions require stage two live-tool fixtures']};
writeFileSync(join(out,'registration.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
const modelArgs=['--model',plan.model,'--judge',plan.judge,'--persona',plan.judge,'--fresh-profile','--no-transport-retries','--concurrency','2','--dialogue-fixtures',fixture,'--upstream',resolve('.xopc-evals/style-upstream')];
const job=(id,path)=>({id,timeoutMs:900000,args:['--import','tsx',join(path,'evals/personal/style/run.mts'),...modelArgs,'--out',`{output}/${id}`],evidence:[]});
// Execute each entry from its frozen source to keep production/evaluator fingerprints stable.
for(const [id,path] of [['baseline',baseline],['candidate',patched]])writeFileSync(join(out,id+'-plan.json'),JSON.stringify({id:'assistant-flow-'+id+'-'+runStamp,concurrency:1,maxWallMs:1000000,maxRequests:plan.budget.generationMaxRequests/2,modelOrigins:['https://router.xopc.ai'],pool:{generation:2,judge:1,parent:3},jobs:[job(id,path)]},null,2)+'\n',{flag:'wx'});
const judgePlan={id:'assistant-flow-judge-'+runStamp,concurrency:1,maxWallMs:1000000,maxRequests:plan.budget.judgeMaxRequests,modelOrigins:['https://router.xopc.ai'],pool:{generation:2,judge:2,parent:3},jobs:[{id:'judge',timeoutMs:900000,args:['--import','tsx',join(patched,'evals/personal/style/compare-p0.mts'),'--left',join(out,'baseline-run/baseline'),'--right',join(out,'candidate-run/candidate'),'--fixtures',fixture,'--kind','scripted','--style-focus','--assistant-flow','--evidence-focus','--runtime-context','--judge',plan.judge,'--concurrency','2','--out','{output}/judge'],evidence:[]}]};
writeFileSync(join(out,'judge-plan.json'),JSON.stringify(judgePlan,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({out,baseline,patched,registration:join(out,'registration.json')},null,2));
