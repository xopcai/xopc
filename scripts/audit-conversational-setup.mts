import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { gradeAudited } from './conversational-setup-evaluation/audit.js';
import { scenarios, type Arm } from './conversational-setup-evaluation/cases.js';

const directory = resolve(process.argv[2]);
const summary = JSON.parse(readFileSync(join(directory, 'summary.json'), 'utf8'));
const rows = readdirSync(directory).filter(name=>/^[DH]\d+-\d+-(baseline|manual|skill|inline)\.json$/.test(name))
  .map(name=>({ ...JSON.parse(readFileSync(join(directory,name),'utf8')), path:join(directory,name) }))
  .filter(row=>summary.manifest.caseIds.includes(row.caseId)&&summary.manifest.arms.includes(row.arm));
const samples = rows.map(row=>{
  const scenario=scenarios.find(s=>s.id===row.caseId)!;
  const checks=row.checks?gradeAudited(scenario,row):{};
  if(row.checks) checks.globalDefaultsPreserved=row.checks.globalDefaultsPreserved;
  return {caseId:row.caseId,arm:row.arm as Arm,repeat:row.repeat,rawPassed:row.passed,
    passed:Boolean(row.outcome?.ok)&&Boolean(row.checks)&&Object.values(checks).every(Boolean),checks,
    changedChecks:Object.keys(checks).filter(key=>key in row.checks&&checks[key]!==row.checks[key]),
    elapsedMs:row.elapsedMs,inputTokens:row.input+row.cacheRead,requests:row.requests,attempts:row.attempts,
    path:row.path,reply:row.reply,calls:row.calls.map((call:any)=>({name:call.name,args:call.args,ok:call.ok}))};
});
const median=(values:number[])=>values.length?[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)]:0;
const groups=Object.fromEntries((summary.manifest.arms as Arm[]).map(arm=>{const group=samples.filter(row=>row.arm===arm);return [arm,{total:group.length,passed:group.filter(row=>row.passed).length,
  rawPassed:group.filter(row=>row.rawPassed).length,failedChecks:group.reduce((count,row)=>count+Object.values(row.checks).filter(value=>!value).length,0),
  medianInputTokens:median(group.map(row=>row.inputTokens)),medianMs:median(group.map(row=>row.elapsedMs)),requests:group.reduce((sum,row)=>sum+row.requests,0)}];}));
const arms=summary.manifest.arms as Arm[];
const paired=Object.fromEntries(arms.flatMap((left,i)=>arms.slice(i+1).map(right=>{
  let wins=0,losses=0,ties=0;
  for(const row of samples.filter(row=>row.arm===left)) {const other=samples.find(value=>value.caseId===row.caseId&&value.repeat===row.repeat&&value.arm===right);if(!other)continue;
    if(row.passed&&!other.passed)wins++;else if(!row.passed&&other.passed)losses++;else ties++;
  }return [`${left}:${right}`,{wins,losses,ties}];
})));
const ranking=summary.status==='completed'?Object.entries(groups).sort(([,a],[,b])=>b.passed-a.passed||a.failedChecks-b.failedChecks||a.medianInputTokens-b.medianInputTokens).map(([arm])=>arm):[];
const result={status:summary.status,manifest:summary.manifest,correction:'Explicit negation and quoted reply instructions are not completion claims. Navigation targets checked against app.tsx/settings-page.tsx. Raw outcomes and all persisted-state/tool-error assertions preserved.',groups,paired,ranking,samples};
writeFileSync(join(directory,'audited-summary.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({status:result.status,groups,ranking,changedSamples:samples.filter(row=>row.changedChecks.length).map(row=>({caseId:row.caseId,arm:row.arm,changedChecks:row.changedChecks}))}));
