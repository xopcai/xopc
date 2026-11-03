import {describe,it,expect} from 'vitest';
import {analyzeFlow,analyzeTargetedRegressions,FLOW_DIMENSIONS,type FlowCase} from '../../personal/style/assistant-flow-analysis.js';
const scene:FlowCase={id:'P0-FLOW-V01',split:'validation',category:'flow',userTurns:['a','b','c','d'],expectations:'Keep context'};
const capture=()=>({transcript:scene.userTurns.flatMap(content=>[{role:'user',content},{role:'assistant',content:'Exact answer'}]),turnObservations:scene.userTurns.map(()=>({latencyMs:100}))});
const side=()=>Object.fromEntries(FLOW_DIMENSIONS.map(k=>[k,[]]));
const rows=()=>[{swapped:false,judgment:{left:side(),right:side(),winner:'right',naturalnessWinner:'right'}},{swapped:true,judgment:{left:side(),right:side(),winner:'left',naturalnessWinner:'left'}}];
describe('Assistant dialogue blind aggregation',()=>{
 it('maps reverse winners to the same condition and keeps all latency samples',()=>{const a=analyzeFlow([scene],{[scene.id]:[capture(),capture()]},{[scene.id]:rows()});expect(a.cohorts.validation!.overall.candidate).toBe(1);expect(a.automatedPassed).toBe(true);});
 it('retains position disagreement rather than voting it away',()=>{const r=rows();r[1]!.judgment.winner='right';const a=analyzeFlow([scene],{[scene.id]:[capture(),capture()]},{[scene.id]:r});expect(a.pairs[0]!.overall).toBe('discordant');expect(a.automatedPassed).toBe(false);});
 it('keeps failed captures and missing judges in the expected denominator',()=>{const a=analyzeFlow([scene],{[scene.id]:[capture(),{error:'timeout'}]},{[scene.id]:[]});expect(a.expected).toBe(1);expect(a.completed).toBe(0);expect(a.pairs[0]!.overall).toBe('unresolved');expect(a.automatedPassed).toBe(false);});
 it('rejects a major regression even if only one judge order catches it',()=>{const r:any[]=rows();r[0].judgment.right.required_content_or_boundary=[{turn:3,severity:'major'}];const a=analyzeFlow([scene],{[scene.id]:[capture(),capture()]},{[scene.id]:r});expect(a.gates.noCandidateMajorEitherOrder).toBe(false);});
 it('does not promote missing latency or duplicate display orders',()=>{const c=capture();c.turnObservations=[];expect(analyzeFlow([scene],{[scene.id]:[c,c]},{[scene.id]:rows()}).gates.validationLatencyComplete).toBe(false);const r=rows();r[1]!.swapped=false;expect(analyzeFlow([scene],{[scene.id]:[capture(),capture()]},{[scene.id]:r}).completed).toBe(0);});
 it('rejects fabricated quote evidence and altered user prompts',()=>{const r:any[]=rows();r[0].judgment.right.conversation_flow=[{turn:1,quote:'Not in answer',severity:'minor',reason:'unsupported evidence'}];expect(analyzeFlow([scene],{[scene.id]:[capture(),capture()]},{[scene.id]:r}).completed).toBe(0);const c=capture();c.transcript[0]!.content='different instruction';expect(analyzeFlow([scene],{[scene.id]:[c,capture()]},{[scene.id]:rows()}).completed).toBe(0);});
 it('rejects a missing rubric dimension instead of treating it as zero errors',()=>{const r:any[]=rows();delete r[0].judgment.right.preference_scope;expect(analyzeFlow([scene],{[scene.id]:[capture(),capture()]},{[scene.id]:r}).automatedPassed).toBe(false);});

 it('requires complete targeted regressions with no issues in either display order',()=>{
  const clean=analyzeFlow([scene],{[scene.id]:[capture(),capture()]},{[scene.id]:rows()});
  expect(analyzeTargetedRegressions(clean,[scene.id])[0]!.passed).toBe(true);
  expect(analyzeTargetedRegressions(clean,['missing'])[0]!.passed).toBe(false);
  const r:any[]=rows();r[0].judgment.right.required_content_or_boundary=[{turn:2,quote:'Exact answer',reason:'Failure omitted',severity:'minor'}];
  const flawed=analyzeFlow([scene],{[scene.id]:[capture(),capture()]},{[scene.id]:r});
  expect(analyzeTargetedRegressions(flawed,[scene.id])[0]).toMatchObject({complete:true,candidateIssueCount:1,passed:false});
  const incomplete=analyzeFlow([scene],{[scene.id]:[capture(),{error:'timeout'}]},{[scene.id]:[]});
  expect(analyzeTargetedRegressions(incomplete,[scene.id])[0]!.passed).toBe(false);
 });

});
