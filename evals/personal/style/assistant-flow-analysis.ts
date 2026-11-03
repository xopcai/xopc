/** Aggregate all predeclared scenes; display-order disagreement is never a tie. */
export const FLOW_DIMENSIONS = ['overinterpretation', 'unnecessary_question', 'repeated_closing', 'premature_resolution', 'required_content_or_boundary', 'didactic_expression', 'conversation_flow', 'preference_scope'] as const;
export interface FlowCase { id: string; split: string; category: string; userTurns: string[]; expectations: string }
type Capture = { error?: string; transcript?: Array<{role:string;content:string}>; turnObservations?: Array<{latencyMs?:number}> };
type Judgment = { error?:string; swapped:boolean; judgment?:Record<string,any> };
const p95 = (values:number[]):number|null => values.length ? ([...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1] ?? null) : null;
export function analyzeFlow(cases:FlowCase[], captures:Record<string,[Capture|undefined,Capture|undefined]>, judgments:Record<string,Judgment[]>) {
  const pairs=cases.map(scene=>{
    const capture=captures[scene.id]??[undefined,undefined];
    const rows=judgments[scene.id]??[];
    const forward=rows.find(r=>r.swapped===false), reverse=rows.find(r=>r.swapped===true);
    const captureComplete=capture.length===2&&capture.every(c=>c&&!c.error&&c.transcript?.length===scene.userTurns.length*2&&scene.userTurns.every((text,index)=>c.transcript?.[index*2]?.role==='user'&&c.transcript[index*2]?.content===text&&c.transcript[index*2+1]?.role==='assistant'&&!!c.transcript[index*2+1]?.content.trim()));
    const validRow=(row:Judgment|undefined)=>{
      if(!row?.judgment||row.error)return false;
      const j=row.judgment;
      if(!['left','right','tie'].includes(j.winner)||!['left','right','tie'].includes(j.naturalnessWinner))return false;
      return ['left','right'].every((side,sideIndex)=>{
        const condition=row.swapped?1-sideIndex:sideIndex;
        const replies=capture[condition]?.transcript?.filter(m=>m.role==='assistant')??[];
        return !!j[side]&&Object.keys(j[side]).sort().join() === [...FLOW_DIMENSIONS].sort().join()&&FLOW_DIMENSIONS.every(dim=>Array.isArray(j[side][dim])&&j[side][dim].every((issue:any)=>Number.isInteger(issue.turn)&&issue.turn>=1&&issue.turn<=replies.length&&typeof issue.quote==='string'&&issue.quote.trim().length>0&&replies[issue.turn-1]?.content.includes(issue.quote)&&['minor','major'].includes(issue.severity)&&typeof issue.reason==='string'&&issue.reason.trim().length>0));
      });
    };
    const complete=captureComplete&&rows.length===2&&validRow(forward)&&validRow(reverse);
    const choice=(key:string)=>{
      if(!complete)return 'unresolved';
      const first={left:'baseline',right:'candidate',tie:'tie'}[forward!.judgment![key] as string];
      const second={left:'candidate',right:'baseline',tie:'tie'}[reverse!.judgment![key] as string];
      return !first||!second?'unresolved':first===second?first:'discordant';
    };
    const violations=Object.fromEntries(FLOW_DIMENSIONS.map(dim=>[dim,[0,1].map(condition=>{
      const a=forward?.judgment?.[condition===0?'left':'right']?.[dim]??[];
      const b=reverse?.judgment?.[condition===0?'right':'left']?.[dim]??[];
      const turns=(r:any[])=>new Set<number>(r.map(x=>x.turn));const first=turns(a), second=turns(b);
      return {bothOrders:[...first].filter(t=>second.has(t)),eitherOrder:[...new Set([...first,...second])],majorEitherOrder:[...new Set([...a,...b].filter(x=>x.severity==='major').map(x=>x.turn))]};
    })]));
    return {caseId:scene.id,category:scene.category,split:scene.split,captureComplete,complete,overall:choice('winner'),naturalness:choice('naturalnessWinner'),violations,
      errors:[...capture.flatMap(c=>!c?['missing capture']:c.error?[c.error]:[]),...rows.flatMap(r=>r.error?[r.error]:[]),...(rows.length===2?[]:['missing or duplicate display order']),...(captureComplete&&rows.length===2&&(!validRow(forward)||!validRow(reverse))?['invalid blind judgment or quote evidence']:[])]};
  });
  const cohorts=Object.fromEntries(['development','validation'].map(split=>{
    const subset=pairs.filter(p=>p.split===split);
    const outcomes=(key:'overall'|'naturalness')=>Object.fromEntries(['baseline','candidate','tie','discordant','unresolved'].map(v=>[v,subset.filter(p=>p[key]===v).length]));
    const violationCounts=Object.fromEntries(FLOW_DIMENSIONS.map(dim=>[dim,{baseline:subset.reduce((n,p)=>n+(p.violations[dim]![0]?.eitherOrder.length??0),0),candidate:subset.reduce((n,p)=>n+(p.violations[dim]![1]?.eitherOrder.length??0),0)}]));
    const latencies=[0,1].map(condition=>cases.filter(c=>c.split===split).flatMap(c=>captures[c.id]?.[condition]?.turnObservations?.map(t=>t.latencyMs).filter((t):t is number=>typeof t==='number'&&Number.isFinite(t)&&t>=0)??[]));
    return [split,{expected:subset.length,complete:subset.filter(p=>p.complete).length,overall:outcomes('overall'),naturalness:outcomes('naturalness'),violationCounts,
      majorCandidateEitherOrder:subset.flatMap(p=>FLOW_DIMENSIONS.flatMap(dim=>p.violations[dim]![1]!.majorEitherOrder.map(turn=>({caseId:p.caseId,dimension:dim,turn})))),latency:{baselineP95Ms:p95(latencies[0]!),candidateP95Ms:p95(latencies[1]!),baselineSamples:latencies[0]!.length,candidateSamples:latencies[1]!.length,expectedSamples:cases.filter(c=>c.split===split).reduce((n,c)=>n+c.userTurns.length,0)}}];
  }));
  const validation=cohorts.validation!;
  const gates={allExpectedScenesCapturedAndJudged:pairs.length===cases.length&&pairs.every(p=>p.complete),
    validationOverallNetPositive:validation.overall.candidate!>validation.overall.baseline!,validationNaturalnessNetPositive:validation.naturalness.candidate!>validation.naturalness.baseline!,
    noCandidateMajorEitherOrder:pairs.every(p=>FLOW_DIMENSIONS.every(dim=>p.violations[dim]![1]!.majorEitherOrder.length===0)),
    validationViolationsNonincrease:Object.values(validation.violationCounts).every(v=>v.candidate<=v.baseline),
    validationLatencyComplete:validation.latency.baselineSamples===validation.latency.expectedSamples&&validation.latency.candidateSamples===validation.latency.expectedSamples,
    validationP95Within120Percent:validation.latency.baselineP95Ms!==null&&validation.latency.candidateP95Ms!==null&&validation.latency.candidateP95Ms<=validation.latency.baselineP95Ms*1.2};
  return {expected:cases.length,completed:pairs.filter(p=>p.complete).length,pairs,cohorts,gates,automatedPassed:Object.values(gates).every(Boolean)};
}

/** Mandatory exposed failure regressions supplement, never replace, validation gates. */
export function analyzeTargetedRegressions(analysis:ReturnType<typeof analyzeFlow>,caseIds:string[]) {
  return caseIds.map(caseId=>{
    const pair=analysis.pairs.find(p=>p.caseId===caseId);
    const candidateIssueCount=pair?FLOW_DIMENSIONS.reduce((n,dim)=>n+(pair.violations[dim]?.[1]?.eitherOrder.length??0),0):null;
    return {caseId,complete:pair?.complete??false,candidateIssueCount,passed:!!pair?.complete&&candidateIssueCount===0};
  });
}
