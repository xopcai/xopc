// Exercises actual HTTP/realtime, QuickJS, SQLite recovery and runtime revocation with a local model.
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { RealtimeClient } from '../packages/realtime-client/src/index.ts';
import { REALTIME_PROTOCOL_VERSION } from '../packages/realtime-protocol/src/index.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const state = mkdtempSync(join(tmpdir(), 'xopc-pi-gateway-'));
const discoveryPilot = process.env.XOPC_TOOL_DISCOVERY_SMOKE === '1';
const mcpEntry = join(state, 'mcp.mjs');
const mcpInventory = join(state, 'inventory.json');
const mcpDisconnected = join(state, 'disconnected');
writeFileSync(mcpInventory, JSON.stringify(['lookup', 'remove', ...Array.from({length:20},(_,i)=>`record_${i}`)]));
writeFileSync(mcpEntry, `import {createInterface} from 'node:readline'; import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const inventory=${JSON.stringify(mcpInventory)};
createInterface({input:process.stdin}).on('line', line=>{
 const q=JSON.parse(line); if(q.id===undefined) return; let result;
 if(q.method==='initialize') result={protocolVersion:'2025-03-26',serverInfo:{name:'local-smoke',version:'1'},capabilities:{tools:{listChanged:true}}};
 else if(q.method==='tools/list') result={tools:JSON.parse(readFileSync(inventory)).map(name=>({name,description:'Documentation '+name,inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true},outputSchema:{type:'object',properties:{records:{type:'number'}},required:['records']}}))};
 else if(q.method==='tools/call') {
  if(q.params.name==='remove'){writeFileSync(inventory,JSON.stringify(['record_0'])); process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/tools/list_changed'})+'\\n');}
  if(q.params.name==='record_0'&&!existsSync(${JSON.stringify(mcpDisconnected)})){writeFileSync(${JSON.stringify(mcpDisconnected)},'disconnected');setTimeout(()=>process.exit(0),5);}
  result={content:[{type:'text',text:'MCP plain evidence'}],structuredContent:{records:7}};
 } else {process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,error:{code:-32601,message:'Method not found'}})+'\\n'); return;}
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\\n');
});`);
const workspace = join(state, 'workspace');
mkdirSync(workspace);
let fixture = join(workspace, 'pi-smoke.txt');
writeFileSync(fixture, 'PI_TOOL_RESULT_1_1_0');
let held = false;
let toolResultSeen = false;
let modelRequests = 0;
let modelFailure;
async function serveModel(req, res) {
  if (req.url !== '/v1/chat/completions') { res.writeHead(404).end(); return; }
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  modelRequests++;
  const messages = body.messages ?? [];
  const lastUser = messages.findLastIndex(m => m.role === 'user');
  const prompt = JSON.stringify(messages[lastUser]?.content ?? '');
  if (prompt.includes('PI_CANCEL')) {
    held = true;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(': waiting for abort\n\n');
    return;
  }
  const hasToolResult = messages.slice(lastUser + 1).some(m => m.role === 'tool');
  if (hasToolResult) toolResultSeen ||= JSON.stringify(messages).includes('PI_TOOL_RESULT_1_1_0');
  const scriptRun = ['PI_TOOL','PI_RECOVER','PI_RESET','PI_ACTIVE','PI_DISCOVER','PI_MCP','PI_REMOVE','PI_EMPTY','PI_DISCONNECT','PI_RECONNECTED'].some(marker=>prompt.includes(marker));
  if (prompt.includes('PI_RECOVER') && discoveryPilot) assert(body.tools?.some(t=>t.function?.name==='mcp__docs__lookup'), 'loaded MCP declaration lost on restart');
  if (prompt.includes('PI_EMPTY')) assert(!body.tools?.some(t=>t.function?.name==='mcp__docs__lookup'), 'removed MCP tool still declared');
  if (prompt.includes('PI_DISABLED')) {
    assert(!body.tools?.some(t=>t.function?.name==='codemode'), 'disabled tool still declared');
    if(discoveryPilot) assert(!body.tools?.some(t=>t.function?.name==='tool_search'||t.function?.name?.startsWith('mcp__')), 'disabled discovery still declared');
  }
  const tool = scriptRun && !hasToolResult && body.tools?.some(t=>t.function?.name==='codemode');
  await new Promise(resolve => setTimeout(resolve, 200));
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({id:'chatcmpl-smoke',object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:'smoke',choices:[{index:0,delta,finish_reason}]})}\n\n`);
  send({role:'assistant'});
  if (tool) {
    const code = prompt.includes('PI_DISCONNECT') || prompt.includes('PI_RECONNECTED') ? 'text(await tools.mcp__docs__record_0({}));'
      : prompt.includes('PI_MCP') ? 'text(await tools.mcp__docs__lookup({})); text("M".repeat(18000));'
      : prompt.includes('PI_REMOVE') ? 'await tools.mcp__docs__remove({});'
      : prompt.includes('PI_RECOVER') ? 'text(load("note")); text("PI_RECOVERED");'
      : prompt.includes('PI_RESET') ? 'text(load("note") ?? "PI_STORE_EMPTY");'
      : prompt.includes('PI_ACTIVE') ? 'while (true) {}'
      : `text(ALL_TOOLS.map(t=>t.name)); const note = await tools.read_file(${JSON.stringify({path:fixture})}); store("note", note); text(note);`;
    const search = prompt.includes('PI_DISCOVER') || prompt.includes('PI_EMPTY');
    send({tool_calls:[{index:0,id:'call_smoke',type:'function',function:{name:search?'tool_search':'codemode',arguments:JSON.stringify(search?{query:prompt.includes('PI_EMPTY')?'lookup':'lookup',limit:1}:{code})}}]});
    send({}, 'tool_calls');
  } else {
    send({content:prompt.includes('PI_RECOVER') ? 'PI_RECOVERED' : 'PI_TOOL_DONE'});
    send({}, 'stop');
  }
  res.end('data: [DONE]\n\n');
}
const model = createServer((req, res) => { void serveModel(req, res).catch(error => {
  modelFailure=error; res.writeHead(500).end('Local model fixture failed');
}); });
await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
const modelPort = model.address().port;
const portProbe = createServer();
await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
const port = portProbe.address().port;
await new Promise(resolve => portProbe.close(resolve));
const token = randomUUID();
const configPath = join(state, 'xopc.json');
writeFileSync(configPath, JSON.stringify({gateway:{mode:'local',bind:'loopback',port,auth:{mode:'token',token}},browser:{enabled:false},
 ...(discoveryPilot?{mcp:{servers:{docs:{command:process.execPath,args:[mcpEntry]}}}}:{})}));
writeFileSync(join(state, 'models.json'), JSON.stringify({providers:{'pi-smoke':{baseUrl:`http://127.0.0.1:${modelPort}/v1`,apiKey:'sk-smoke',api:'openai-completions',models:[{id:'smoke',name:'Local pi smoke',reasoning:false,input:['text'],contextWindow:128000,maxTokens:2000,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}}}));
const entry = process.env.XOPC_CODEMODE_SMOKE_ENTRY ?? join(root,'dist/src/cli/bin.js');
let logs = '';
let child;
let rt;
const events = [];
let connected = false;
const base = `http://127.0.0.1:${port}`;
async function request(path, data, method = 'POST') {
 const res = await fetch(base+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(data === undefined ? {} : {body:JSON.stringify(data)})});
 const body = await res.json();
 assert(res.ok, `${path}: ${res.status} ${JSON.stringify(body)}`);
 return body.payload ?? body;
}
async function until(predicate, label, limit = 60000) {
 const start=Date.now(); while(Date.now()-start<limit) { if(await predicate()) return; await new Promise(r=>setTimeout(r,100)); }
 throw new Error(`Timeout: ${label}`);
}
async function boot() {
 child=spawn(process.execPath,[entry,'gateway','--port',String(port),'--bind','loopback','--no-hot-reload'],{cwd:root,env:{...process.env,XOPC_CONFIG_PATH:configPath,XOPC_CONFIG:configPath,XOPC_STATE_DIR:state,XOPC_HOME:state,XOPC_WORKSPACE:workspace,XOPC_SKIP_CHANNELS:'1',XOPC_NO_RESPAWN:'1',XOPC_LOG_FILE:'false',XOPC_LOG_CONSOLE:'false'},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data', b=>logs+=b.toString()); child.stderr.on('data', b=>logs+=b.toString());
 await until(async()=> { try { const h=await fetch(base+'/api/health'); const j=await h.json(); return h.ok && j.ready === true; } catch {return false;} },'gateway ready');
 rt=new RealtimeClient({clientId:'pi-smoke',clientKind:'tui',getWebSocketUrl:()=>`ws://127.0.0.1:${port}/api/realtime/v1/ws`,issueTicket:async()=>request('/api/realtime/tickets',{clientId:'pi-smoke',clientKind:'tui',protocolVersion:REALTIME_PROTOCOL_VERSION}),createWebSocket:url=>new WebSocket(url),onStateChange:(s,error)=>{console.log('Realtime state',s,error ?? '');connected=s==='connected';},onEvent:e=>{ events.push(e); if(e.event==='run.started') rt.subscribe(`run:${e.data.runId}`,0); }});
 rt.subscribe('sessions'); rt.connect(); await until(()=>connected,'realtime ready');
}
async function stop() {
 rt?.disconnect(); connected=false;
 if(child && child.exitCode === null) { const exited=new Promise(resolve=>child.once('exit',resolve)); child.kill('SIGTERM'); await exited; }
}
try {
 await boot();
 console.log('Gateway ready');
 const unauth = await fetch(base+'/api/agents'); assert.equal(unauth.status,401);
 console.log('Authenticated');
 const agents=await request('/api/agents',undefined,'GET');
 const agent=(agents.agents ?? agents.items ?? agents)[0];
 const agentId=agent.id;
 await request(`/api/agents/${agentId}`,{runtime:{codemode:{enabled:true},...(discoveryPilot?{toolDiscovery:{enabled:true,mcpServer:'docs'}}:{})},
 ...(discoveryPilot?{tools:{'mcp:docs:lookup':{mode:'allow',readOnly:true},'mcp:docs:remove':{mode:'allow',readOnly:true},'mcp:docs:record_0':{mode:'allow',readOnly:true},'mcp:docs:record_19':{mode:'deny'}}}:{})},'PATCH');
 fixture=join(agent.workspace,'pi-smoke.txt');
 mkdirSync(agent.workspace,{recursive:true}); writeFileSync(fixture,'PI_TOOL_RESULT_1_1_0');
 const conversationId=randomUUID();
 const origin={type:'system',source:'cli'};
 await request(`/api/sessions/${conversationId}/inputs`,{kind:'start',clientMessageId:randomUUID(),creation:{agentId,projectId:null,execution:null,temporary:false,model:'pi-smoke/smoke',thinkingLevel:'off'},input:{content:'PI_TOOL read the fixture'},origin});
 console.log('Input accepted');
 await until(()=>events.some(e=>e.event==='run.completed' && e.data.conversationId===conversationId),'tool run completed');
 const first=events.find(e=>e.event==='run.completed' && e.data.conversationId===conversationId); assert.equal(first.data.status,'success');
 await until(()=>events.some(e=>e.topic===`run:${first.data.runId}` && e.event==='tool_end'),'replayed tool end');
 assert(toolResultSeen, 'SDK did not receive the script output');
 const childEvent=events.find(e=>e.event==='tool_end' && e.data?.payload?.toolName==='read_file');
 assert(childEvent?.data?.payload?.parentToolCallId, 'realtime nested parent missing');
 assert(typeof childEvent.data.payload.durationMs==='number', 'nested duration missing');
 let session=await request(`/api/sessions/${conversationId}`,undefined,'GET');
 let transcriptId=session.transcriptId ?? session.session?.transcriptId;
 console.log('Tool run verified', {toolResultSeen});
 let config=await request(`/api/sessions/${conversationId}/agent-config`,undefined,'GET');
 const append=async content=>request(`/api/sessions/${conversationId}/inputs`,{kind:'append',clientMessageId:randomUUID(),expectedTranscriptId:transcriptId,configVersion:config.configVersion ?? config.version ?? 0,delivery:'next',interrupt:false,input:{content},origin});
 if(discoveryPilot){
  let count=events.filter(e=>e.event==='run.completed').length;
  await append('PI_DISCOVER'); await until(()=>events.filter(e=>e.event==='run.completed').length>count,'discovery completed');
  assert(events.some(e=>e.event==='tool_end' && e.data?.payload?.toolName==='tool_search' && JSON.stringify(e.data).includes('Loaded 1 tool')),'deferred search did not load');
  count=events.filter(e=>e.event==='run.completed').length;
  await append('PI_MCP'); await until(()=>events.filter(e=>e.event==='run.completed').length>count,'MCP script completed');
  assert(events.some(e=>e.event==='tool_end' && e.data?.payload?.toolName==='mcp__docs__lookup' && e.data.payload.parentToolCallId),'MCP nested audit missing');
  const history=await request(`/api/sessions/${conversationId}`,undefined,'GET');
  const outputPath=/Full Codemode output: (\.xopc\/codemode-output\/[a-f0-9-]{36}\.txt)/.exec(JSON.stringify(history))?.[1];
  assert(outputPath,'retained output link missing');
  const space=await request(`/api/files/contexts/session/${conversationId}`,undefined,'GET');
  const resolved=await request('/api/files/resolve',{spaceId:space.space.id,path:outputPath});
  const response=await fetch(base+`/api/files/${encodeURIComponent(resolved.resource.id)}/content`,{headers:{Authorization:'Bearer '+token}});
  assert(response.ok,'authenticated output download failed'); assert((await response.text()).includes('M'.repeat(18000)),'full output was truncated');
  assert.equal((await fetch(base+`/api/files/${encodeURIComponent(resolved.resource.id)}/content`)).status,401,'output download bypassed authentication');
 }
 await append('PI_CANCEL');
 await until(()=>held,'held model request');
 const inputState=await request(`/api/sessions/${conversationId}/input-state`,undefined,'GET');
 const abortRunId=inputState.activeRunId;
 assert(abortRunId);
 await request('/api/agent/abort',{runId:abortRunId});
 await until(()=>events.some(e=>e.event==='run.completed' && e.data.runId===abortRunId),'cancel terminal');
 assert.equal(events.find(e=>e.event==='run.completed' && e.data.runId===abortRunId).data.status,'cancelled');
 await stop();
 await boot();
 config=await request(`/api/sessions/${conversationId}/agent-config`,undefined,'GET');
 const recoveryCount=events.filter(e=>e.event==='run.completed').length;
 await append('PI_RECOVER after restart');
 await until(()=>events.filter(e=>e.event==='run.completed').length>recoveryCount,'recovery completed');
 const final=events.findLast(e=>e.event==='run.completed' && e.data.conversationId===conversationId); assert.equal(final.data.status,'success');
 const history=await request(`/api/sessions/${conversationId}?include=transcriptRows`,undefined,'GET');
 assert(JSON.stringify(history).includes('PI_TOOL_RESULT_1_1_0'), 'SQLite tool transcript missing after restart');
 assert(JSON.stringify(history).includes('PI_RECOVERED'), 'recovered assistant missing');
 assert(JSON.stringify(history).includes('codemode-store'), 'store custom entry missing');
 assert(JSON.stringify(history.session.messages).includes('nestedCalls'), 'client history lost nested records');
 assert(events.some(e=>e.event==='tool_end' && e.data?.runId===final.data.runId && JSON.stringify(e.data).includes('PI_TOOL_RESULT_1_1_0')), 'store did not survive cold restart');
 assert(JSON.stringify(history).includes('nestedCalls'), 'nested call audit missing');
 if(discoveryPilot){
  let count=events.filter(e=>e.event==='run.completed').length;
  await append('PI_REMOVE'); await until(()=>events.filter(e=>e.event==='run.completed').length>count,'catalog change cancellation');
  assert.equal(events.findLast(e=>e.event==='run.completed').data.status,'cancelled');
  count=events.filter(e=>e.event==='run.completed').length;
  await append('PI_EMPTY'); await until(()=>events.filter(e=>e.event==='run.completed').length>count,'removed catalog search');
  assert(events.some(e=>e.event==='tool_end' && e.data?.payload?.toolName==='tool_search' && JSON.stringify(e.data).includes('No matching tools')),'removed catalog still searchable');
  count=events.filter(e=>e.event==='run.completed').length;
  await append('PI_DISCONNECT'); await until(()=>events.filter(e=>e.event==='run.completed').length>count,'disconnect cancellation');
  assert.equal(events.findLast(e=>e.event==='run.completed').data.status,'cancelled');
  count=events.filter(e=>e.event==='run.completed').length;
  await append('PI_RECONNECTED'); await until(()=>events.filter(e=>e.event==='run.completed').length>count,'reconnected script');
  assert.equal(events.findLast(e=>e.event==='run.completed').data.status,'success');
 }
 await request(`/api/sessions/${conversationId}/reset`,{});
 session=await request(`/api/sessions/${conversationId}`,undefined,'GET');
 transcriptId=session.transcriptId ?? session.session?.transcriptId;
 config=await request(`/api/sessions/${conversationId}/agent-config`,undefined,'GET');
 let completed=events.filter(e=>e.event==='run.completed').length;
 await append('PI_RESET');
 await until(()=>events.filter(e=>e.event==='run.completed').length>completed,'reset script completed');
 const fresh=await request(`/api/sessions/${conversationId}?include=transcriptRows`,undefined,'GET');
 assert(JSON.stringify(fresh).includes('PI_STORE_EMPTY'), 'reset leaked the previous store');
 completed=events.filter(e=>e.event==='run.completed').length;
 await append('PI_ACTIVE');
 await until(()=>events.some(e=>e.event==='tool_start' && e.data?.payload?.toolName==='codemode' && e.data?.runId!==first.data.runId && e.data?.runId!==final.data.runId && !events.some(done=>done.event==='run.completed' && done.data.runId===e.data.runId)),'active script');
 await request(`/api/agents/${agentId}`,{runtime:{codemode:{enabled:false}}},'PATCH');
 await until(()=>events.filter(e=>e.event==='run.completed').length>completed,'configuration cancelled script');
 assert.equal(events.findLast(e=>e.event==='run.completed').data.status,'cancelled');
 config=await request(`/api/sessions/${conversationId}/agent-config`,undefined,'GET');
 completed=events.filter(e=>e.event==='run.completed').length;
 await append('PI_DISABLED');
 await until(()=>events.filter(e=>e.event==='run.completed').length>completed,'disabled turn completed');
 if(modelFailure) throw modelFailure;
 console.log(JSON.stringify({passed:true,entry,checks:['authentication','REST input','realtime tool end','model tool result','cancel terminal','restart','SQLite recovery','codemode-store','nested calls','reset store isolation','disable cancels worker','disabled declaration',...(discoveryPilot?['deferred search','MCP structured output','authenticated full output','declaration restore','catalog revocation','disconnect','reconnect']:[])],modelRequests}));
} catch (error) { console.error(error); console.error(logs.slice(-9000)); process.exitCode=1; }
finally { await stop(); model.closeAllConnections(); await new Promise(resolve=>model.close(resolve)); rmSync(state,{recursive:true,force:true}); }
