// Explicitly invoked live acceptance: real Store plugin, Gateway, model and Feishu account.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {RealtimeClient} from '../packages/realtime-client/src/index.js';
import {REALTIME_PROTOCOL_VERSION} from '../packages/realtime-protocol/src/index.js';
const cfg=JSON.parse(await readFile(join(homedir(),'.xopc/xopc.json'),'utf8'));
const base=`http://127.0.0.1:${cfg.gateway.port??18790}`;
const evidence=resolve(process.env.XOPC_FEISHU_EVIDENCE??'/tmp/xopc-feishu-live-e2e');await mkdir(evidence,{recursive:true});
const previous=process.argv.includes('--verify-existing')?JSON.parse(await readFile(join(evidence,'result.json'),'utf8')):null;
const conversationId=previous?.conversationId??randomUUID(),title=previous?.title??`XOPC E2E ${new Date().toISOString().replace(/[:.]/g,'-')}`;
const report:any=previous??{startedAt:new Date().toISOString(),conversationId,title,liveWrites:process.argv.includes('--allow-live-write'),runs:[],passed:false};
report.passed=false;
const save=()=>writeFile(join(evidence,'result.json'),JSON.stringify(report,null,2)+'\n');
async function api(path:string,body?:unknown,method?:string){const r=await fetch(base+path,{method:method??(body===undefined?'GET':'POST'),headers:{Authorization:`Bearer ${cfg.gateway.auth.token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});const d:any=await r.json();assert(r.ok,`${path}: HTTP ${r.status}`);return d.payload??d;}
let connected=false;let finished:any;let currentRun:string|undefined;
const clientId=`feishu-live-${randomUUID()}`;
const realtime=new RealtimeClient({clientId,clientKind:'tui',getWebSocketUrl:()=>base.replace(/^http/,'ws')+'/api/realtime/v1/ws',issueTicket:()=>api('/api/realtime/tickets',{clientId,clientKind:'tui',protocolVersion:REALTIME_PROTOCOL_VERSION}),createWebSocket:url=>new WebSocket(url),onStateChange:state=>{connected=state==='connected';},onEvent:event=>{if(event.data?.conversationId!==conversationId)return;if(event.event==='run.started'){currentRun=event.data.runId;realtime.subscribe(`run:${currentRun}`,0);}if(event.event==='run.completed')finished=event.data;}});
async function until(check:()=>Promise<boolean>|boolean,label:string,timeout=240000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,500));}throw Error(`Timeout: ${label}`);}
const contract='只验证已安装 feishu 插件，通过 MCP cli_run（必要时用 exec/searchTools 发现）。禁止用 bash、普通 exec shell、HTTP 或读取本机配置/凭据绕过插件。遵循 lark-shared 和对应领域技能，业务调用必须显式 --as user。验收指定的命令必须按原 argv 执行，不添加 --jq、--dry-run 或其他输出转换参数，以保留原始验证结果。若使用 codemode，必须直接 return 工具的原始返回值，不能裁剪、计算或重写工具结果字段；最终回答仍只报告成功与否及数量。只允许读取，不创建、修改或发送任何数据。不输出姓名、手机号、邮箱、Token、用户ID、日程标题或日程内容，只输出成功与否及返回数量。遇到真实错误如实报告，不得用 bot 身份绕过。';
async function turn(content:string,start=false){finished=undefined;currentRun=undefined;const session=start?null:(await api(`/api/sessions/${conversationId}`)).session;const command=start?{kind:'start',clientMessageId:randomUUID(),creation:report.creation,input:{content:contract+'\n'+content},origin:{type:'system',source:'cli'}}:{kind:'append',clientMessageId:randomUUID(),expectedTranscriptId:session.transcriptId,configVersion:(await api(`/api/sessions/${conversationId}/agent-config`)).configVersion,delivery:'next',input:{content:contract+'\n'+content},origin:{type:'system',source:'cli'}};await api(`/api/sessions/${conversationId}/inputs`,command);await until(()=>!!finished,'real Agent completion');report.runs.push({runId:currentRun,status:finished.status});await save();assert.equal(finished.status,'success','Agent run must complete successfully');console.log(JSON.stringify({conversationId,runId:currentRun,status:finished.status}));}
try {
 await save();
 const detail=await api('/api/extensions/agent-plugins/feishu-addab7f5d026');assert.equal(detail.authorizationStatus,'connected');report.pluginVersion=detail.version;
 const defaults=await api('/api/global-defaults'),agents=await api('/api/agents');const model=defaults.defaults.models.chat.primary,models=await api('/api/models');const entry=models.models.find((v:any)=>v.id===model);assert(entry,'Configured real model unavailable');const agentId=agents.defaultAgentId??agents.default??'main';report.creation={agentId,projectId:null,execution:null,temporary:false,model,thinkingLevel:entry.thinking.initialValue};report.model=model;
 if(!previous){realtime.subscribe('sessions');realtime.connect();await until(()=>connected,'realtime',20000);
 await turn('请真实调用飞书 contact +get-user --as user，读取当前登录用户来验证连接。只回复读取成功或真实错误，不输出个人资料。不要只检查 auth status。',true);
 await turn('继续用同一个飞书插件真实调用 calendar +agenda --as user，读取今天的日程验证跨轮次工具调用。只回复读取是否成功和日程数量，不输出标题、参会人或内容。不进行任何写入。');
 }
 if(previous&&process.argv.includes('--documents')){realtime.subscribe('sessions');realtime.connect();await until(()=>connected,'realtime document read',20000);await turn('通过同一个飞书插件执行 drive +search --query "" --page-size 5 --as user。只读第一页，只执行这一条业务命令。若使用 codemode 必须直接 return 工具原始返回值，不做字段变换；最终回复只说明成功与否和数量，不输出文档内容。');await turn('通过同一个飞书插件执行 wiki spaces list --page-size 5 --as user。只读第一页，只执行这一条业务命令。若使用 codemode 必须直接 return 工具原始返回值，不做字段变换；最终回复只说明成功与否和数量，不输出空间名称。');}
 if(previous&&process.argv.includes('--recheck-user')){realtime.subscribe('sessions');realtime.connect();await until(()=>connected,'realtime user recheck',20000);await turn('请重新真实调用 contact +get-user --as user，严格只用这四个参数，不添加 --jq、--help 或其他参数。根据原始工具结果判断读取成功与否，不输出个人资料。');}
 const session=await api(`/api/sessions/${conversationId}?include=transcriptRows`);const messages=session.messages??session.session?.messages??[];
 const calls=messages.filter((m:any)=>m.role==='assistant').flatMap((m:any)=>Array.isArray(m.content)?m.content.filter((v:any)=>v.type==='toolCall'):[]);
 const nested=messages.filter((m:any)=>m.role==='toolResult').flatMap((m:any)=>m.nestedCalls?.calls??[]);
 const business=[...calls,...nested].filter((v:any)=>v.name.includes('plugin_feishu')&&v.name.endsWith('cli_run')&&Array.isArray(v.arguments?.argv)&&!v.arguments.argv.some((arg:string)=>['--help','--jq','--dry-run'].includes(arg)));
 report.businessCalls=business.map((v:any)=>({name:v.name,argv:v.arguments?.argv,nestedStatus:v.status}));
 const self=business.findLast((v:any)=>v.arguments?.argv?.slice(0,2).join(' ')==='contact +get-user');
 const agenda=business.findLast((v:any)=>v.arguments?.argv?.slice(0,2).join(' ')==='calendar +agenda');
 assert(self&&agenda,'Both real business calls must be present');
 const resultFor=(v:any)=>messages.find((m:any)=>m.role==='toolResult'&&(m.tool_call_id===v.id||m.toolCallId===v.id||m.nestedCalls?.calls?.some((n:any)=>n.id===v.id)));
 const payloads=(m:any)=>{const found:any[]=[];function visit(v:any,depth=0){if(depth>12||v==null)return;if(typeof v==='string'){try{visit(JSON.parse(v),depth+1);}catch{}return;}if(Array.isArray(v)){v.forEach(x=>visit(x,depth+1));return;}if(typeof v==='object'){if(typeof v.ok==='boolean'){found.push(v);return;}for(const [k,x]of Object.entries(v))if(!['data','_notice','details'].includes(k))visit(x,depth+1);}}visit(m?.content);return found;};
 const selfPayload=payloads(resultFor(self)).find((p:any)=>p.ok===true&&p.identity==='user');
 assert(selfPayload,'User read must have an actual successful user-identity result');
 const calendarPayload=payloads(resultFor(agenda)).find((p:any)=>p.ok===true&&p.identity==='user');
 report.checks={authorizationConnected:true,agentUserReadSucceeded:true,multiTurnPluginCalls:true,calendarReadSucceeded:!!calendarPayload};
 for(const prefix of ['drive +search','wiki spaces list']){const call=business.findLast((v:any)=>v.arguments?.argv?.slice(0,prefix.split(' ').length).join(' ')===prefix);if(call)report.checks[prefix]=payloads(resultFor(call)).some((p:any)=>p.ok===true&&p.identity==='user');}
 if(process.argv.includes('--documents')||process.argv.includes('--require-documents')){assert.equal(report.checks['drive +search'],true,'Agent document search must succeed');assert.equal(report.checks['wiki spaces list'],true,'Agent wiki listing must succeed');}
 report.status=calendarPayload?'passed':'partial';report.passed=!!calendarPayload;
 report.results=undefined;report.answers=undefined;report.completedAt=new Date().toISOString();await save();
 console.log(JSON.stringify({evidence,conversationId,checks:report.checks,status:report.status}));

}finally{realtime.disconnect();await save();}
