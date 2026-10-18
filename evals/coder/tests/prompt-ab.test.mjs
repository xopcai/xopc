import {execFileSync} from 'node:child_process';
import {cpSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {describe,it,expect} from 'vitest';
import {parseProviderResponse} from '../scripts/prompt-ab-recorder.mjs';

it('normalizes actual provider usage, cache and attempted tool calls without double counting cumulative usage',()=>{
 const d=parseProviderResponse('data: '+JSON.stringify({id:'d1',model:'deepseek-flash',choices:[{delta:{tool_calls:[{index:0,function:{name:'read_file',arguments:'{}'}}]}}],usage:{prompt_tokens:100,completion_tokens:5,prompt_cache_hit_tokens:60}}),'deepseek');
 expect(d.usage).toEqual({input:40,output:5,cacheRead:60,cacheWrite:0,total:105});expect(d.responseIds).toEqual(['d1']);expect(d.toolCalls[0].name).toBe('read_file');
 const m=parseProviderResponse([{message:{id:'m1',model:'MiniMax-M2.7',usage:{input_tokens:10,cache_read_input_tokens:20}}},{usage:{output_tokens:4}},{usage:{output_tokens:7}}].map(e=>'data: '+JSON.stringify(e)).join('\n'),'minimax-cn');
 expect(m.usage.total).toBe(37);expect(m.usage.output).toBe(7);
 expect(parseProviderResponse('{"error":"failed"}','deepseek').usage).toBeUndefined();
});

it('calibrates every new deterministic grader, keeps subjective style pending, and rejects false or incomplete results',()=>{
 const root=mkdtempSync(join(tmpdir(),'prompt-grade-calibration-'));
 const suiteDir=resolve('suites/prompt-behavior');
 const suite=JSON.parse(readFileSync(join(suiteDir,'suite.yaml')));
 try {
  expect(suite.cases).toHaveLength(15);
  for(const c of suite.cases) {
   expect(c.budget).toEqual({timeoutMs:180000,maxModelRequests:12,maxTokens:30000});
   const dir=join(root,c.id);cpSync(join(suiteDir,'fixture'),dir,{recursive:true});
   const git=args=>execFileSync('git',args,{cwd:dir,stdio:'pipe'});
   git(['init','-q']);git(['add','.']);git(['-c','user.name=Eval','-c','user.email=eval@xopc.ai','commit','-qm','fixture']);
   mkdirSync(join(dir,'.xopc-eval-hidden'));cpSync(join(suiteDir,'hidden/check.mjs'),join(dir,'.xopc-eval-hidden/check.mjs'));
   cpSync(join(suiteDir,'suite.yaml'),join(dir,'.xopc-eval-hidden/suite.json'));
   const events=[];
   for(const [turnIndex,e] of c.scenario.expectations.entries()) {
    let text=e.language==='zh'?'这是中文确认，我叫Orion，专长是天文学。':'The result is 5, and the requested facts are ORBIT-47 and Orion. I cannot perform the unavailable operation.';
    if(e.minHan)text='这段中文说明用于校验明确的长度条件与语言要求，不代表已经完成自然语言正式语气的主观评审。'.repeat(4)+' ORBIT-47';
    if(e.bullets)text='- 金星\n- 火星\n- 木星';
    if(e.maxHan)text='已修改会话偏好。';
    events.push({type:'agent.event',payload:{kind:'harness.answer',turnIndex,finalText:text}});
    if(e.compacted)events.push({type:'agent.event',payload:{kind:'harness.compaction',result:{compacted:true}}});
    if(e.artifact==='code')writeFileSync(join(dir,'source.mjs'),'export function total(rows){return rows.reduce((s,r)=>s+r.cents,0); }');
    if(e.artifact?.startsWith('doc'))writeFileSync(join(dir,'report.md'),'# Release note\n\nThe office opens at 10:00 on Monday. The owner is Mira.\n'+(e.artifact==='doc-full'?'\nVisitors must book ahead.\n':''));
    if(e.artifact?.startsWith('doc'))events.push({type:'tool.finished',payload:{payload:{toolName:'read_file',status:'success'}}});
   }
   const trace=join(dir,'.xopc-eval-hidden/trace.json');writeFileSync(trace,JSON.stringify({events}));
   const run=()=>execFileSync('/bin/sh',['-c',c.graders[0].command],{cwd:dir,encoding:'utf8',stdio:'pipe'});
   const result=JSON.parse(run().split('DIMENSIONS_JSON=')[1]);
   expect(result.caseId).toBe(c.id);
   if(c.scenario.expectations.some(e=>e.tone))expect(result.manualReviewRequired).toBe(true);
   events.push({type:'model.response',payload:{source:'provider-recorder',availableTools:c.scenario.tools,toolCalls:[{name:'not_registered'}]}});
   writeFileSync(trace,JSON.stringify({events}));expect(run,c.id).toThrow();events.pop();
   events[0].payload.finalText='';writeFileSync(trace,JSON.stringify({events}));expect(run,c.id).toThrow();
  }
 }finally{rmSync(root,{recursive:true,force:true});}
},120000);

it('forwards chunked SDK requests without hop-by-hop transport headers',async()=>{
 const {createServer,request}=await import('node:http');
 const {createRecorder}=await import('../scripts/prompt-ab-recorder.mjs');
 const output=mkdtempSync(join(tmpdir(),'prompt-recorder-transport-'));
 let received;
 const upstream=createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  received={headers:req.headers,body:JSON.parse(Buffer.concat(chunks).toString())};
  res.writeHead(200,{'content-type':'text/event-stream'});
  res.end('data: '+JSON.stringify({id:'transport-calibration',model:'deepseek-flash',choices:[],usage:{prompt_tokens:1,completion_tokens:1}})+'\n\n');
 });
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const recorder=await createRecorder({output,models:[{ref:'deepseek/deepseek-flash',provider:'deepseek',id:'deepseek-flash',baseUrl:`http://127.0.0.1:${upstream.address().port}`}],keys:[]});
 const events=[];
 recorder.activate('deepseek/deepseek-flash',{runId:'transport-test',evalCase:{scenario:{tools:[]}}},e=>events.push(e),new AbortController().signal);
 try {
  const response=await new Promise((resolve,reject)=>{
   const r=request(recorder.baseUrl+'/deepseek/chat/completions',{method:'POST',headers:{'content-type':'application/json','transfer-encoding':'chunked'}},async res=>{let text='';for await(const part of res)text+=part;resolve({status:res.statusCode,text});});
   r.on('error',reject);r.write(JSON.stringify({model:'deepseek-flash',messages:[],tools:[],thinking:{type:'disabled'}}));r.end();
  });
  expect(response.status).toBe(200);expect(received.body.model).toBe('deepseek-flash');expect(received.headers['transfer-encoding']).toBeUndefined();
  expect(events.some(e=>e.type==='model.response')).toBe(true);
 }finally{recorder.deactivate('deepseek/deepseek-flash');await recorder.close();await new Promise(r=>upstream.close(r));rmSync(output,{recursive:true,force:true});}
});

it('forwards with the actual runtime-installed HTTP dispatcher and automatic content length',()=>{
 const recorderPath=resolve('scripts/prompt-ab-recorder.mjs');
 const runtimePath=resolve('../../src/providers/index.ts');
 const script=`
 import {createServer,request} from 'node:http';
 import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
 await import(${JSON.stringify(runtimePath)});
 const {createRecorder}=await import(${JSON.stringify(recorderPath)});
 const upstream=createServer(async(req,res)=>{for await(const chunk of req){}res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'runtime-dispatcher-calibration',model:'deepseek-flash',choices:[],usage:{prompt_tokens:1,completion_tokens:1}}));});
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const output=mkdtempSync(join(tmpdir(),'prompt-runtime-transport-'));
 const recorder=await createRecorder({output,models:[{ref:'deepseek/deepseek-flash',provider:'deepseek',id:'deepseek-flash',baseUrl:'http://127.0.0.1:'+upstream.address().port}],keys:[]});
 recorder.activate('deepseek/deepseek-flash',{runId:'runtime-transport',evalCase:{scenario:{tools:[]}}},()=>{},new AbortController().signal);
 const body=JSON.stringify({model:'deepseek-flash',messages:[],tools:[],thinking:{type:'disabled'}});
 await new Promise((resolve,reject)=>{const q=request(recorder.baseUrl+'/deepseek/chat/completions',{method:'POST',headers:{'content-type':'application/json','content-length':Buffer.byteLength(body)}},async r=>{for await(const c of r){}if(r.statusCode!==200)reject(new Error('Forwarding status '+r.statusCode));else resolve();});q.end(body);});
 await recorder.close();await new Promise(r=>upstream.close(r));rmSync(output,{recursive:true,force:true});
 `;
 expect(()=>execFileSync(process.execPath,['--import','tsx','--input-type=module','-'],{input:script,stdio:'pipe',timeout:30000})).not.toThrow();
},35000);
