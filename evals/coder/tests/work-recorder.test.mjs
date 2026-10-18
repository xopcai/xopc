import {createServer} from 'node:http';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {expect,it} from 'vitest';
import {createRecorder,parseProviderResponse} from '../scripts/work-baseline/recorder-bounded.mjs';
it('counts authoritative Cloud total rather than incomplete prompt plus completion',()=>{
 const r=parseProviderResponse(JSON.stringify({id:'response-test',model:'openai-codex/gpt-5.6-sol',usage:{prompt_tokens:10,completion_tokens:2,total_tokens:37}}),'xopc-cloud');expect(r.usage).toEqual({input:35,output:2,cacheRead:0,cacheWrite:0,total:37});
 expect(()=>parseProviderResponse(JSON.stringify({usage:{prompt_tokens:10,completion_tokens:2,total_tokens:11}}),'xopc-cloud')).toThrow();
});
it('caps all actual upstream requests at two and rejects missing Cloud off before forwarding',async()=>{
 const output=mkdtempSync(join(tmpdir(),'work-recorder-'));let live=0,peak=0,count=0;
 const upstream=createServer(async(req,res)=>{for await(const _ of req){}live++;peak=Math.max(peak,live);count++;await new Promise(r=>setTimeout(r,15));res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'synthetic-'+count,model:'fake',usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));live--});await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const models=[{ref:'deepseek/fake',provider:'deepseek',id:'fake',baseUrl:`http://127.0.0.1:${upstream.address().port}`},{ref:'xopc-cloud/sol',provider:'xopc-cloud',id:'sol',baseUrl:'http://127.0.0.1:1'}];
 const recorder=await createRecorder({output,models,keys:[]});
 try{recorder.activate('deepseek/fake',{runId:'synthetic',evalCase:{}},()=>{},new AbortController().signal);
 const responses=await Promise.all(Array.from({length:12},()=>fetch(recorder.baseUrl+'/deepseek/chat/completions',{method:'POST',body:JSON.stringify({model:'fake',messages:[],thinking:{type:'disabled'}})})));expect(responses.every(r=>r.ok)).toBe(true);expect(count).toBe(12);expect(peak).toBe(2);
 recorder.activate('xopc-cloud/sol',{runId:'synthetic-cloud',evalCase:{}},()=>{},new AbortController().signal);const bad=await fetch(recorder.baseUrl+'/xopc-cloud/chat/completions',{method:'POST',body:JSON.stringify({model:'sol',messages:[]})});expect(bad.status).toBe(502);expect(await bad.text()).toContain('explicitly disable reasoning');expect(count).toBe(12);
 }finally{await recorder.close();await new Promise(r=>upstream.close(r));rmSync(output,{recursive:true,force:true})}
});
