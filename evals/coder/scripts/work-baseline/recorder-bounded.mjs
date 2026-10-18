import {createServer} from 'node:http';
import {readFileSync,mkdirSync,appendFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {readCurrentCloudAccess} from './auth-relay.mjs';
import {TraceEmitter,redactSensitive} from '../../node_modules/@agent-evals/protocol/src/index.ts';

export function parseProviderResponse(text,provider) {
 const data=[];
 for(const line of text.split('\n'))if(line.startsWith('data: ')) {try{data.push(JSON.parse(line.slice(6)));}catch{}}
 if(!data.length){try{data.push(JSON.parse(text));}catch{}}
 const ids=new Set(),models=new Set(),calls=new Map();let usage;
 for(const e of data) {
  const msg=e.message??e;
  if(msg.id)ids.add(msg.id);if(msg.model)models.add(msg.model);
  if((provider==='deepseek'||provider==='xopc-cloud')&&e.usage) {
   const u=e.usage,cache=u.prompt_cache_hit_tokens??u.prompt_tokens_details?.cached_tokens??0;
   if(typeof u.prompt_tokens==='number'&&typeof u.completion_tokens==='number') {
    if(provider==='xopc-cloud') {
     const total=u.total_tokens;
     if(!Number.isSafeInteger(total)||total<u.prompt_tokens+u.completion_tokens)throw new Error('Invalid authoritative Cloud total_tokens');
     // Cloud streaming omits cache details. Count every token in the budget without claiming a measured cache split.
     usage={input:total-u.completion_tokens,output:u.completion_tokens,cacheRead:0,cacheWrite:0,total};
    } else usage={input:u.prompt_tokens-cache,output:u.completion_tokens,cacheRead:cache,cacheWrite:0,total:u.prompt_tokens+u.completion_tokens};
   }
  }
  if(provider!=='deepseek'&&provider!=='xopc-cloud') {
   const u=e.usage??e.message?.usage;
   if(u){usage??={input:0,output:0,cacheRead:0,cacheWrite:0,total:0};if(typeof u.input_tokens==='number')usage.input=u.input_tokens;if(typeof u.output_tokens==='number')usage.output=Math.max(usage.output,u.output_tokens);if(typeof u.cache_read_input_tokens==='number')usage.cacheRead=u.cache_read_input_tokens;if(typeof u.cache_creation_input_tokens==='number')usage.cacheWrite=u.cache_creation_input_tokens;usage.total=usage.input+usage.output+usage.cacheRead+usage.cacheWrite;}
   if(e.content_block?.type==='tool_use')calls.set(e.index,{name:e.content_block.name,input:e.content_block.input,arguments:''});
   if(e.delta?.type==='input_json_delta'&&calls.has(e.index))calls.get(e.index).arguments+=e.delta.partial_json??'';
  }
  for(const choice of e.choices??[])for(const c of choice.delta?.tool_calls??choice.message?.tool_calls??[]) {
   const prior=calls.get(c.index??c.id)??{name:'',arguments:''};prior.name+=c.function?.name??'';prior.arguments+=c.function?.arguments??'';calls.set(c.index??c.id,prior);
  }
 }
 return {responseIds:[...ids],responseModels:[...models],toolCalls:[...calls.values()],usage};
}

export async function createRecorder({output,models,keys,dryRun=false}) {
 const active=new Map();let requestSequence=0;
 const waiters=[];let leases=0,forwarded=0,maximumForwarded=0,queued=0;
 const acquire=()=>new Promise(resolve=>{const grant=()=>{leases++;resolve(()=>{leases--;waiters.shift()?.();});};if(leases<2)grant();else{queued++;waiters.push(grant);}});
 const ledger=(kind,callId,purpose)=>appendFileSync(join(output,'transport-inflight.jsonl'),JSON.stringify({kind,callId,purpose,at:new Date().toISOString(),monotonicNs:process.hrtime.bigint().toString(),inFlight:forwarded})+'\n');
 const scrub=text=>keys.reduce((s,k)=>k?s.replaceAll(k,'[REDACTED]'):s,text);
 const save=(path,value)=>writeFileSync(path,scrub(typeof value==='string'?value:JSON.stringify(redactSensitive(value),null,2)));
 const server=createServer(async(req,res)=>{
  let current,release,transportStartedAt,transportEndedAt,forwarding=false,forwardCallId,forwardPurpose;
  try {
   if(req.method==='GET'&&req.url.startsWith('/xopc-cloud/')) {
    if(req.url.split('?')[0]==='/xopc-cloud/models') {
     const discovery=JSON.parse(readFileSync(join(output,'..','model-discovery.json'),'utf8'));
     res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({object:'list',data:[discovery.liveModel]}));return;
    }
    const meta=models.find(m=>m.provider==='xopc-cloud');
    const auth=await readCurrentCloudAccess(keys);
    const response=await fetch(meta.baseUrl+req.url.slice('/xopc-cloud'.length),{headers:{authorization:'Bearer '+auth.access},signal:AbortSignal.timeout(30000)});
    const text=await response.text();res.writeHead(response.status,{'content-type':'application/json'});res.end(text);return;
   }
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const bytes=Buffer.concat(chunks),body=JSON.parse(bytes.toString('utf8'));
   const meta=models.find(m=>m.id===body.model&&req.url.startsWith('/'+m.provider+'/'));
   if(!meta)throw new Error('Unregistered model or recorder route');
   current=active.get(meta.ref);if(!current)throw new Error('No active frozen run for provider request');
   if(body.thinking&&body.thinking.type!=='disabled'||body.reasoning_effort&&body.thinking?.type!=='disabled'&&body.reasoning_effort!=='off')throw new Error('Thinking is not off');
   if(meta.provider==='xopc-cloud'&&body.thinking?.type!=='disabled')throw new Error('Cloud request did not explicitly disable reasoning');
   const n=++requestSequence,callId=`provider-${n}`,directory=join(output,'runs',current.request.runId);mkdirSync(directory,{recursive:true});
   const availableTools=(body.tools??[]).map(t=>t.function?.name??t.name);
   const scenario=current.request.evalCase.scenario;
   if(scenario&&JSON.stringify([...availableTools].sort())!==JSON.stringify([...scenario.tools].sort())){save(join(directory,`${callId}-rejected-request.json`),{callId,requestedModel:meta.ref,availableTools,body,reason:'frozen allowlist mismatch; not forwarded'});throw new Error('Actual registered tool set exceeds frozen allowlist: '+availableTools.join(','));}
   const prompt=body.messages?.filter(m=>['system','developer'].includes(m.role))??body.system??[];
   const queuedAt=Date.now();release=await acquire();
   const purpose=(body.messages??[]).some(m=>JSON.stringify(m.content).includes('You label chat sessions. Given the first user message'))?'session-title':'agent-or-other';
   forwardCallId=callId;forwardPurpose=purpose;
   const requestData={purpose,queueWaitMs:Date.now()-queuedAt,callId,requestedModel:meta.ref,body,availableTools,thinking:body.thinking??null,startedAt:new Date().toISOString()};
   save(join(directory,`${callId}-request.json`),requestData);save(join(directory,`${callId}-prompt.json`),prompt);
   await current.trace.emit('model.request',{source:'provider-recorder',...requestData,promptSha256:createHash('sha256').update(JSON.stringify(prompt)).digest('hex')});
   current.signal.throwIfAborted();
   const target=meta.baseUrl.replace(/\/$/,'')+req.url.slice(('/'+meta.provider).length);
   const h={...req.headers};
   if(meta.provider==='xopc-cloud'&&!dryRun){const auth=await readCurrentCloudAccess(keys);h.authorization='Bearer '+auth.access;appendFileSync(join(output,'auth-relay-audit.jsonl'),JSON.stringify({callId,at:new Date().toISOString(),expiresAt:auth.expiresAt,source:auth.source,personalConfigWrites:false,sessionWrites:false,credentialRenewalAuthorized:true})+'\n');}
   for(const name of ['host','content-length','connection','transfer-encoding','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','upgrade'])delete h[name];
   const started=Date.now();
   let response;transportStartedAt=new Date().toISOString();forwarding=true;forwarded++;maximumForwarded=Math.max(maximumForwarded,forwarded);ledger('start',callId,purpose);
   if(dryRun) {
    const id='synthetic-configuration-probe-'+n,text='Configuration probe only; no real model was called.';
    const chunks=['deepseek','xopc-cloud'].includes(meta.provider)
      ? [{id,model:meta.id,choices:[{index:0,delta:{role:'assistant',content:text},finish_reason:null}]},{id,model:meta.id,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}]
      : [{type:'message_start',message:{id,type:'message',role:'assistant',model:meta.id,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:1,output_tokens:0}}},{type:'content_block_start',index:0,content_block:{type:'text',text:''}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:1}},{type:'message_stop'}];
    response=new Response(chunks.map(c=>(c.type?'event: '+c.type+'\n':'')+'data: '+JSON.stringify(c)+'\n\n').join('')+(['deepseek','xopc-cloud'].includes(meta.provider)?'data: [DONE]\n\n':''),{status:200,headers:{'content-type':'text/event-stream'}});
   } else response=await fetch(target,{method:'POST',headers:h,body:bytes,signal:current.signal});
   const text=await response.text();transportEndedAt=new Date().toISOString();forwarded--;forwarding=false;ledger('end',callId,purpose);save(join(directory,`${callId}-response.txt`),text);
   const parsed=parseProviderResponse(text,meta.provider);
   const responseHeaders={requestId:response.headers.get('x-xopc-request-id')??response.headers.get('request-id')??response.headers.get('x-request-id'),contentType:response.headers.get('content-type')};
   const estimatedCost=parsed.usage?Object.entries({input:'input',output:'output',cacheRead:'cacheRead',cacheWrite:'cacheWrite'}).reduce((sum,[k,c])=>sum+(parsed.usage[k]??0)*(meta.cost?.[c]??0)/1e6,0):null;
   await current.trace.emit(parsed.usage?'model.response':'agent.event',{source:'provider-recorder',kind:parsed.usage?'provider.response':'provider.error',callId,requestedModel:meta.ref,httpStatus:response.status,...parsed,availableTools,responseHeaders,purpose,transportStartedAt,transportEndedAt,queueWaitMs:requestData.queueWaitMs,durationMs:Date.now()-started,catalogEstimatedCost:estimatedCost});
   res.writeHead(response.status,{'content-type':response.headers.get('content-type')??'application/json'});res.end(text);
  }catch(error){
   if(current){await current.trace.emit('agent.event',{kind:'provider.transport_error',error:scrub(String(error.message)),cause:scrub(String(error.cause?.message??'')),causeCode:error.cause?.code??null}).catch(()=>{});}
   if(!res.headersSent)res.writeHead(502,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:scrub(String(error.message)),type:'evaluation_transport_error'}}));
  }finally{if(forwarding){forwarded--;ledger('failed-end',forwardCallId,forwardPurpose);}release?.();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {baseUrl:`http://127.0.0.1:${server.address().port}`,activate(ref,request,sink,signal){if(active.has(ref))throw new Error('Concurrent runs for same model are forbidden');if(active.size>=2)throw new Error('Run concurrency exceeds 2');active.set(ref,{request,trace:new TraceEmitter(request.runId,sink),signal});},deactivate(ref){active.delete(ref);},close:async()=>{await new Promise(resolve=>server.close(resolve));writeFileSync(join(output,'transport-concurrency.json'),JSON.stringify({limit:2,maximumForwarded,queuedRequests:queued,remaining:forwarded,complete:forwarded===0,scope:'All actual upstream requests, including session-title calls.'},null,2)+'\n');}};
}
