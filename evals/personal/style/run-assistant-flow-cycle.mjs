/** Run a prepared cycle once; failed conditions remain separate and are never replaced. */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {join,resolve} from 'node:path';
const root=process.cwd(),cycle=process.argv[2]&&resolve(process.argv[2]);
if(!cycle)throw Error('Pass prepared cycle directory');
const reg=JSON.parse(readFileSync(join(cycle,'registration.json'),'utf8'));
for(const name of ['baseline-run','candidate-run','judging','launcher-progress.json'])if(existsSync(join(cycle,name)))throw Error('Refusing existing run; original failures must remain unchanged');
const outcomes=[];
const deadline=Date.now()+reg.budget.totalWallMs;
for(const [id,cwd] of [['baseline',reg.conditions[0].path],['candidate',reg.conditions[1].path],['judge',reg.conditions[1].path]]){
 const remainingMs=deadline-Date.now();
 if(remainingMs<=0){outcomes.push({id,exit:null,error:'Cycle wall budget exhausted before job'});break;}
 const output=join(cycle,id==='judge'?'judging':id+'-run');
 const child=spawn(process.execPath,['--import','tsx','evals/control/cli.ts','run','--plan',join(cycle,id+'-plan.json'),'--output',output,'--index',join(root,'.xopc-evals/control/index.db')],{cwd,stdio:'inherit'});
 const timer=setTimeout(()=>child.kill('SIGTERM'),remainingMs);
 const exit=await new Promise((done,fail)=>{child.once('error',fail);child.once('exit',done);});clearTimeout(timer);outcomes.push({id,exit,remainingBudgetMs:Math.max(0,deadline-Date.now())});
 writeFileSync(join(cycle,'launcher-progress.json'),JSON.stringify(outcomes,null,2)+'\n');
}
console.log(JSON.stringify({outcomes,reportCommand:'pnpm exec tsx evals/personal/style/report-assistant-flow.mts '+cycle}));
if(outcomes.some(o=>o.exit!==0))process.exitCode=1;
