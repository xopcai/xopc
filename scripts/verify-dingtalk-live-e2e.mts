// Explicitly invoked live acceptance: real Store plugin, Gateway, model and DingTalk account.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {RealtimeClient} from '../packages/realtime-client/src/index.js';
import {loadConfig} from '../src/config/loader.js';
import {openXopcDatabase,closeXopcDatabase} from '../src/storage/sqlite/connection.js';
import {prepareNativeMcpConfig} from '../src/agent/mcp/native-mcp.js';
import {invokePreparedTool} from './lib/plugin-lab-runtime.mts';
import {REALTIME_PROTOCOL_VERSION} from '../packages/realtime-protocol/src/index.js';
const cfg=JSON.parse(await readFile(join(homedir(),'.xopc/xopc.json'),'utf8'));
const base=`http://127.0.0.1:${cfg.gateway.port??18790}`;
const evidence=resolve(process.env.XOPC_DINGTALK_EVIDENCE??'/tmp/xopc-dingtalk-live-e2e');await mkdir(evidence,{recursive:true});
const previous=process.argv.includes('--verify-existing')?JSON.parse(await readFile(join(evidence,'result.json'),'utf8')):null;
const conversationId=previous?.conversationId??randomUUID(),title=previous?.title??`XOPC E2E ${new Date().toISOString().replace(/[:.]/g,'-')}`;
const report:any=previous??{startedAt:new Date().toISOString(),conversationId,organization:'qmdemo',title,liveWrites:process.argv.includes('--allow-live-write'),runs:[],passed:false};
report.passed=false;
const save=()=>writeFile(join(evidence,'result.json'),JSON.stringify(report,null,2)+'\n');
async function api(path:string,body?:unknown,method?:string){const r=await fetch(base+path,{method:method??(body===undefined?'GET':'POST'),headers:{Authorization:`Bearer ${cfg.gateway.auth.token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});const d:any=await r.json();assert(r.ok,`${path}: HTTP ${r.status}`);return d.payload??d;}
let connected=false;let finished:any;let currentRun:string|undefined;
const clientId=`dingtalk-live-${randomUUID()}`;
const realtime=new RealtimeClient({clientId,clientKind:'tui',getWebSocketUrl:()=>base.replace(/^http/,'ws')+'/api/realtime/v1/ws',issueTicket:()=>api('/api/realtime/tickets',{clientId,clientKind:'tui',protocolVersion:REALTIME_PROTOCOL_VERSION}),createWebSocket:url=>new WebSocket(url),onStateChange:state=>{connected=state==='connected';},onEvent:event=>{if(event.data?.conversationId!==conversationId)return;if(event.event==='run.started'){currentRun=event.data.runId;realtime.subscribe(`run:${currentRun}`,0);}if(event.event==='run.completed')finished=event.data;}});
async function until(check:()=>Promise<boolean>|boolean,label:string,timeout=240000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,500));}throw Error(`Timeout: ${label}`);}
const contract='只验证已安装 dingtalk 插件，通过 MCP cli_run（必要时用 exec/searchTools 发现）。禁止用 bash、普通 exec shell、HTTP 或读取本机配置/凭据绕过插件。插件已绑定 qmdemo，禁止切换企业或 profile。遵循 dingtalk-contact/dingtalk-todo 技能，输出简洁中文，不输出手机号、邮箱、Token 或用户 ID。遇到真实错误如实报告。';
async function turn(content:string,start=false){finished=undefined;currentRun=undefined;const session=start?null:(await api(`/api/sessions/${conversationId}`)).session;const command=start?{kind:'start',clientMessageId:randomUUID(),creation:report.creation,input:{content:contract+'\n'+content},origin:{type:'system',source:'cli'}}:{kind:'append',clientMessageId:randomUUID(),expectedTranscriptId:session.transcriptId,configVersion:(await api(`/api/sessions/${conversationId}/agent-config`)).configVersion,delivery:'next',input:{content:contract+'\n'+content},origin:{type:'system',source:'cli'}};await api(`/api/sessions/${conversationId}/inputs`,command);await until(()=>!!finished,'real Agent completion');report.runs.push({runId:currentRun,status:finished.status});await save();assert.equal(finished.status,'success','Agent run must complete successfully');console.log(JSON.stringify({conversationId,runId:currentRun,status:finished.status}));}
try{
 await save();
 const detail=await api('/api/extensions/agent-plugins/dingtalk-9e0f6d4da0e8');assert.equal(detail.authorizationStatus,'connected');report.pluginVersion=detail.version;
 const defaults=await api('/api/global-defaults'),agents=await api('/api/agents');const model=defaults.defaults.models.chat.primary,models=await api('/api/models');const entry=models.models.find((v:any)=>v.id===model);assert(entry,'Configured real model unavailable');const agentId=agents.defaultAgentId??agents.default??'main';report.creation={agentId,projectId:null,execution:null,temporary:false,model,thinkingLevel:entry.thinking.initialValue};report.model=model;
 if(!previous){realtime.subscribe('sessions');realtime.connect();await until(()=>connected,'realtime',20000);
 await turn('请真实调用钉钉 contact user get-self --format json，验证当前账号可读，并说明这次插件读取是否成功。不要只检查 auth status。',true);
 if(report.liveWrites)await turn(`用户已授权本次 qmdemo 完整链路测试。请只给当前账号本人创建一条测试待办，标题严格为 ${title}，优先级 20，不设置其他执行人，不发消息。按技能先确认本人，再创建并用 task get 回读；将标题更新为 ${title}-updated 后回读确认；最后标记完成并再次回读确认。不删除，不操作其他待办。每一步都必须实际调用已安装的插件，不得模拟；若需要 Runtime confirmation，当前用户已明确授权这条测试待办的创建、改名和完成。最终简洁列出结果及这条测试待办的 taskId。`);
 }else if(process.argv.includes('--restart-read')){
  realtime.subscribe('sessions');realtime.connect();await until(()=>connected,'realtime after restart',20000);
  await turn(`Gateway 刚刚重启。请用已安装插件读取本次测试待办 taskId=${report.taskId}，命令 todo task get --task-id ${report.taskId} --format json。确认标题仍为 ${title}-updated 且已完成。只读取，不创建或修改。`);
  report.gatewayRestartRead=true;
 }
 const session=await api(`/api/sessions/${conversationId}?include=transcriptRows`);const messages=session.messages??session.session?.messages??[];
 const calls=messages.filter((m:any)=>m.role==='assistant').flatMap((m:any)=>Array.isArray(m.content)?m.content.filter((v:any)=>v.type==='toolCall'):[]);
 const nested=messages.filter((m:any)=>m.role==='toolResult').flatMap((m:any)=>m.nestedCalls?.calls??[]);
 const business=[...calls,...nested].filter((v:any)=>v.name.includes('plugin_dingtalk')&&v.name.endsWith('cli_run'));
 report.businessCommands=business.map((v:any)=>v.arguments?.argv?.slice(0,3));
 assert(report.businessCommands.some((v:any)=>v?.join(' ')==='contact user get-self'),'Agent must really read via installed plugin');
 const self=business.find((v:any)=>v.arguments?.argv?.slice(0,3).join(' ')==='contact user get-self');
 const selfResult=messages.find((m:any)=>m.role==='toolResult'&&(m.tool_call_id===self.id||m.toolCallId===self.id||m.nestedCalls?.calls?.some((n:any)=>n.id===self.id)));
 assert(selfResult&&!selfResult.isError,'Current-user tool result must succeed');
 const successfulPayload=(value:any,depth=0):boolean=>{if(depth>12||value==null)return false;if(typeof value==='string'){try{return successfulPayload(JSON.parse(value),depth+1);}catch{return false;}}if(typeof value!=='object')return false;if(value.success===true)return true;return Object.entries(value).some(([key,nested])=>!['data','details'].includes(key)&&successfulPayload(nested,depth+1));};
 assert(successfulPayload(selfResult.content),'Current-user read must return a successful business payload');
 report.userReadToolResultVerified=true;
 if(report.liveWrites){
  for(const verb of ['create','get','update'])assert(report.businessCommands.some((v:any)=>v?.join(' ')===`todo task ${verb}`),`Missing real Agent operation: ${verb}`);
  assert(business.some((v:any)=>v.arguments?.argv?.slice(0,3).join(' ')==='todo task done'||v.arguments?.argv?.slice(0,3).join(' ')==='todo task update'&&v.arguments.argv.includes('--done')&&v.arguments.argv[v.arguments.argv.indexOf('--done')+1]==='true'),'Missing actual completion operation');
  const get=business.find((v:any)=>v.arguments?.argv?.slice(0,3).join(' ')==='todo task get'&&v.arguments.argv.includes('--task-id')),argv=get.arguments.argv;
  const taskId=argv[argv.indexOf('--task-id')+1];assert(taskId&&taskId!=='todo','Task ID must come from Agent call');report.taskId=taskId;
  openXopcDatabase();try{const runtime=loadConfig(),native=await prepareNativeMcpConfig(runtime,homedir()+'/.xopc/workspace',agentId),server=native.servers.find(v=>v.name.includes('dingtalk'));assert(server);
   await invokePreparedTool({...native,servers:[server]},homedir()+'/.xopc/workspace',server.name,'qmdemo',{toolDescription:'Run the managed official',arguments:{argv:['auth','status','--format','json']}});
   report.organizationVerifiedThroughPlugin=true;
   await invokePreparedTool({...native,servers:[server]},homedir()+'/.xopc/workspace',server.name,'bound to the account',{toolDescription:'Run the managed official',arguments:{argv:['contact','user','get-self','--profile','xopc-e2e-disallowed-profile']}});
   report.crossOrganizationOverrideRejected=true;
   const result=await invokePreparedTool({...native,servers:[server]},homedir()+'/.xopc/workspace',server.name,title+'-updated',{toolDescription:'Run the managed official',arguments:{argv:['todo','task','get','--task-id',taskId,'--format','json']}});
   const resultMessage=JSON.parse(result);let payload:any;for(const item of resultMessage.content??[])if(item.type==='text'){try{payload=JSON.parse(item.text);}catch{}}
   report.readbackKeys=Object.keys(payload??{});assert(payload?.success!==false,'DingTalk readback must succeed');const data=payload?.result??payload?.data??payload;const task=data?.todoDetailModel??data;
   report.readbackTaskKeys=Object.keys(task??{});report.independentReadback={updatedTitle:JSON.stringify(task).includes(title+'-updated'),completed:task?.done===true||task?.status===true||task?.isDone===true||task?.todoTask?.done===true};
   assert(report.independentReadback.updatedTitle,'Updated title must be read from real DingTalk');assert(report.independentReadback.completed,'Completion must be read from real DingTalk');
  }finally{closeXopcDatabase();}
 }
 report.completedAt=new Date().toISOString();report.passed=true;await save();console.log(JSON.stringify({evidence,conversationId,agentRunsCompleted:report.runs.length,independentBusinessReadback:report.independentReadback,passed:true}));
}finally{realtime.disconnect();await save();}
