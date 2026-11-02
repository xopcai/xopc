/** Publish immutable dialogue evidence and a conservative, human-gated decision. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {analyzeFlow,type FlowCase} from './assistant-flow-analysis.js';
import {hash} from '../../control/evidence.js';
import {ControlStore} from '../../control/store.js';
import {reconcileJob} from '../../control/reconciliation.js';
const root=process.argv[2]&&resolve(process.argv[2]);
if(!root)throw Error('Pass registered cycle directory');
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const write=(p:string,v:unknown)=>writeFileSync(p,JSON.stringify(v,null,2)+'\n',{flag:'wx',mode:0o600});
const registrationPath=join(root,'registration.json'),reg=read(registrationPath);
assert.deepEqual(reg.gate,{validationOverallMinNetWins:1,validationNaturalnessMinNetWins:1,noCandidateMajorEitherOrder:true,validationViolationsNonincrease:true,validationP95LatencyRatio:1.2,minIndependentHumanReviewers:2,completeDenominatorRequired:true});
const fixtures=read(reg.fixture),cases:FlowCase[]=fixtures.cases;
assert.equal(hash(readFileSync(reg.fixture)),reg.fixtureSha256);
assert.equal(cases.length,reg.expectedScenes);assert.deepEqual(cases.filter(c=>c.split==='validation').map(c=>c.id),reg.validation);assert.deepEqual(cases.filter(c=>c.split==='development').map(c=>c.id),reg.development);assert.ok(reg.validation.length>=6&&reg.development.length>=6);
const dirs=[join(root,'baseline-run/baseline'),join(root,'candidate-run/candidate')];
const manifests=dirs.map(d=>read(join(d,'manifest.json'))),completions=dirs.map(d=>read(join(d,'completion.json')));
const fingerprints:string[]=[];
for(const [i,manifest] of manifests.entries()){
 assert.equal(manifest.model,reg.model);assert.equal(manifest.judge,reg.judge);assert.equal(manifest.reasoning,reg.reasoning);assert.equal(manifest.evaluatorReasoning,reg.evaluatorReasoning);assert.equal(manifest.transportRetries,0);assert.equal(manifest.dialogueFixtureHash,reg.fixtureSha256);assert.equal(manifest.concurrency,reg.concurrency);assert.equal(completions[i].sourceChanged,false);assert.equal(manifest.commit,reg.conditions[i].commit);fingerprints.push(manifest.sourceHash);
 const profile=read(join(dirs[i]!, 'runtime.json')).profile;
 if(i){const a=read(join(dirs[0]!, 'runtime.json')).profile;const {instructions:_a,...left}=a,{instructions:_b,...right}=profile;assert.ok(isDeepStrictEqual(left,right),'Profile differs beyond tested instructions');}
}
const judgeDir=join(root,'judging/judge'),judgeRegistration=read(join(judgeDir,'registration.json'));
assert.equal(judgeRegistration.judge,reg.judge);assert.equal(judgeRegistration.assistantFlow,true);
assert.deepEqual(judgeRegistration.sourceManifests,dirs.map(d=>hash(readFileSync(join(d,'manifest.json')))));
const captures:Record<string,any>={},judgments:Record<string,any[]>={};
const artifactHashes:Record<string,string>={};
for(const c of cases){
 captures[c.id]=dirs.map(d=>{const path=join(d,'cases',c.id+'.json');if(!existsSync(path))return undefined;artifactHashes[path]=hash(readFileSync(path));return read(path);});
 judgments[c.id]=['forward','reverse'].flatMap(order=>{const p=join(judgeDir,`${c.id}.${order}.json`);if(!existsSync(p))return [];artifactHashes[p]=hash(readFileSync(p));return [read(p)];});
}
const analysis=analyzeFlow(cases,captures,judgments);
const campaignDirs=[join(root,'baseline-run'),join(root,'candidate-run'),join(root,'judging')];
const audit=campaignDirs.map((d,i)=>reconcileJob(d,['baseline','candidate','judge'][i]!));
const reasons:string[]=[];
for(const [i,d] of campaignDirs.entries()){
 const campaign=read(join(d,'campaign.json'));
 assert.ok(Date.parse(reg.registeredAt)<Date.parse(campaign.startedAt),'Preregistration did not precede execution');
 if(campaign.status!=='completed'||campaign.sourceChanged!==false||campaign.validity!=='valid'||campaign.pool.active!==0||campaign.pool.queued!==0)reasons.push(`Campaign validity or idle state failed: ${i}`);
}
for(const a of audit)if(!a.perRequestMatched||!a.usageMatched||a.unknownRequests||!a.ledgerFinalSnapshotGuaranteed)reasons.push(`Physical request/runtime usage reconciliation failed: ${a.id}`);
for(const [gate,passed] of Object.entries(analysis.gates))if(!passed)reasons.push(`Style gate failed: ${gate}`);
// No human votes are invented. A later review is an append-only supplement/new decision.
reasons.push('Human blind review pending: two independent reviewers required before adoption');
const humanMapping:any[]=[];
const humanQueue=cases.map(c=>{
 const swapped=parseInt(hash(reg.fixtureSha256+c.id).slice(0,2),16)%2===1;
 humanMapping.push({caseId:c.id,A:swapped?'candidate':'baseline',B:swapped?'baseline':'candidate'});
 return {caseId:c.id,context:'Chinese assistant conversation; judge visible text only. Drafting does not authorize sending.',expectations:c.expectations,
  A:captures[c.id]?.[swapped?1:0]?.transcript??null,B:captures[c.id]?.[swapped?0:1]?.transcript??null,
  reviewSlots:[1,2].map(slot=>({slot,reviewerId:null,overall:null,naturalness:null,issues:[],note:null})),
  instructions:'Review independently before inspecting condition mapping/model judgments. Choose A|B|tie or unreviewable; cite exact assistant turn and quote for issues. Missing is pending, never tie.'};
});
write(join(root,'human-blind-review.json'),{schemaVersion:1,createdAt:new Date().toISOString(),expectedReviewers:2,cases:humanQueue});
write(join(root,'human-condition-mapping.json'),humanMapping);
const store=new ControlStore(resolve('.xopc-evals/control/index.db'));
for(const [index,d] of dirs.entries()){
 const source=join(d,'control-evidence.json'),manifest=manifests[index];
 const evidence={createdAt:manifest.createdAt,expected:cases.length,complete:captures&&cases.every(c=>!captures[c.id]?.[index]?.error&&captures[c.id]?.[index]?.transcript?.filter((m:any)=>m.role==='assistant').length===c.userTurns.length),sourceChanged:false,
  manifest:{sourceHash:manifest.sourceHash,model:reg.model,reasoning:reg.reasoning,suiteHash:hash(reg.suite),selectionHash:reg.fixtureSha256,fixtureCommit:reg.fixtureSha256,graderHash:judgeRegistration.rubricSha256,lockfileHash:hash(readFileSync(join(reg.conditions[index].path,'pnpm-lock.yaml'))),environmentHash:hash(process.version),budget:reg.budget},
  cases:cases.map(c=>({caseId:c.id,variant:'personal',runnerStatus:captures[c.id]?.[index]?.error?'error':captures[c.id]?.[index]?'completed':'unknown',assessment:'manual_review',durationMs:captures[c.id]?.[index]?.durationMs??null})),
  metrics:{condition:index===0?'baseline':'candidate',captureOnly:true,styleAnalysisPath:join(root,'analysis.json'),humanReview:'pending',noScalarQualityScore:true}};
 write(source,evidence);const imported=store.import({path:source,kind:'style',benchmark:'personal-style',evidenceClass:'live_product',expected:cases.length});if(imported.error)throw Error(imported.error);
}
const related=store.list({limit:100}).items.filter(e=>dirs.some(d=>e.source.startsWith(d+'/'))).map(e=>e.id);
const id=store.improvement({problem:'Personal 中文多轮助理风格 '+reg.suite+(reg.methodologyRecoveryOf?'（方法修复复验）':'（首批）')+'：流畅衔接与偏好作用域',hypothesis:'Experimental shared style module versus unchanged production baseline; same specified GPT-5.6 Sol model and GPT-6.1 Sol blind judge, all fixed protections retained.',budget:reg.budget,protection:['Completeness, grounded facts, necessary authorization, scoped preferences, latency and original failures'],preregistration:registrationPath});
const styleAcceptance={expected:analysis.expected,completed:analysis.completed,cohorts:analysis.cohorts,automatedPassed:analysis.automatedPassed&&reasons.length===1,humanReview:{status:'pending',expectedReviewers:2,completedReviewers:0,queue:join(root,'human-blind-review.json')},
 model:reg.model,judge:reg.judge,pairs:analysis.pairs,examples:humanQueue.map(c=>({caseId:c.caseId,A:c.A,B:c.B})),limitations:reg.limitations};
const decision={schemaVersion:1,decidedAt:new Date().toISOString(),promotion:'rejected',scope:'Pilot candidate not adopted; single-judge disclosed Chinese fixed-trajectory regression, human review remains pending',reasons,preregistrationHash:hash(readFileSync(registrationPath)),audit,evidenceIds:related,
 reports:[{id:'双序评审覆盖（不代表风格质量通过）',passed:analysis.completed,expected:analysis.expected}],styleAcceptance,productionDefaultsChanged:false};
write(join(root,'analysis.json'),analysis);write(join(root,'decision.json'),decision);store.decideImprovement(id,decision);write(join(root,'improvement-id.json'),{id});store.close();
const report={schemaVersion:1,date:'2026-11-02',phaseOneComplete:false,improvementId:id,promotion:decision.promotion,scope:decision.scope,registration:reg,sourceManifests:manifests,sourceCompletions:completions,analysis,audit,artifactHashes,
 humanReview:styleAcceptance.humanReview,decisionSha256:hash(readFileSync(join(root,'decision.json'))),actualCharge:null,productionDefaultsChanged:false,limitations:reg.limitations};
write(join(root,'portable-report.json'),report);
console.log(JSON.stringify({id,reasons,automatedPassed:analysis.automatedPassed,cohorts:analysis.cohorts,physicalRequests:audit.reduce((n,a)=>n+a.physicalRequests,0)},null,2));
