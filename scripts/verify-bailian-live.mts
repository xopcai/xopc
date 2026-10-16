/** Explicit paid E2E probe using an existing local Gateway and saved credentials. */
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const config = JSON.parse(await readFile(process.env.XOPC_CONFIG_PATH ?? join(homedir(), '.xopc/xopc.json'), 'utf8'));
const base = `http://127.0.0.1:${config.gateway.port}`;
const headers = { Authorization: `Bearer ${config.gateway.auth.token}` };
const directory = await mkdtemp(join(tmpdir(), 'xopc-bailian-live-'));
const report: Record<string, unknown> = { startedAt: new Date().toISOString(), directory, tests: [] };
const tests = report.tests as Array<Record<string, unknown>>;
const clean = (value: unknown) => String(value).replaceAll(config.gateway.auth.token, '[redacted]').replace(/sk-[\w-]+/g, '[redacted]');
const request = async (path: string, body?: unknown, timeoutMs = 30_000) => {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(timeoutMs) });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(`${path}: HTTP ${response.status}: ${clean(JSON.stringify(data.error ?? data))}`);
  return data.payload ?? data;
};
const run = async (name: string, operation: () => Promise<unknown>) => {
  const at = Date.now();
  try { const detail = await operation(); tests.push({ name, passed: true, durationMs: Date.now()-at, detail }); }
  catch (error) { tests.push({name, passed:false,durationMs:Date.now()-at,error:clean(error instanceof Error?error.message:error)}); }
  await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(tests.at(-1)));
};
const flags=new Set(process.argv.slice(2));
const only=process.argv.find(arg=>arg.startsWith('--only='))?.split('=')[1];
const plan = await request('/api/models/setup/qwen-token-plan-cn');
report.uses = plan.uses.map((use:{id:string;current?:string;recommended?:string}) => ({id:use.id,current:use.current,recommended:use.recommended}));
let audio: Buffer | undefined;
let audioMime='audio/mpeg';
let audioExtension='mp3';
if(!only || only==='voice')await run('gateway.tts', async () => {
  if(config.messages?.tts?.provider !== 'qwen-token-plan-cn') throw new Error('Saved TTS provider is not the subscription; refusing cross-provider probe');
  const response=await fetch(base+'/api/voice/speech',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({text:'这是百炼订阅端到端测试。验证数字：四七二九。',language:'zh'}),signal:AbortSignal.timeout(90_000)});
  if(!response.ok)throw new Error(`HTTP ${response.status}: ${clean(await response.text())}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length<1000 || !response.headers.get('content-type')?.startsWith('audio/'))throw new Error('Missing playable audio');
  audioMime=response.headers.get('content-type')!.split(';')[0]; audioExtension=audioMime.includes('wav')?'wav':'mp3';
  audio=bytes;await writeFile(join(directory,`speech.${audioExtension}`),bytes);
  return {bytes:bytes.length,contentType:response.headers.get('content-type'),provider:config.messages.tts.provider};
});
if(!only || only==='voice')await run('gateway.stt',async()=>{
  if(!audio)throw new Error('Speech fixture unavailable because TTS failed');
  if(config.tools?.media?.audio?.provider !== 'qwen-token-plan-cn')throw new Error('Saved STT provider is not the subscription');
  const form=new FormData();form.set('audio',new Blob([new Uint8Array(audio)],{type:audioMime}),`speech.${audioExtension}`);form.set('language','zh');
  const response=await fetch(base+'/api/voice/transcriptions',{method:'POST',headers,body:form,signal:AbortSignal.timeout(90_000)});const data=await response.json();
  if(!response.ok || data.ok===false)throw new Error(`HTTP ${response.status}: ${clean(JSON.stringify(data.error??data))}`);
  const result=data.payload??data; if(!String(result.text??'').trim())throw new Error('Empty transcript');
  const normalized=String(result.text).replace(/[四七二九]/g,char=>({'四':'4','七':'7','二':'2','九':'9'}[char]!));
  if(!normalized.includes('4729'))throw new Error('Transcription did not preserve the test digits');
  return result;
});
if(flags.has('--image') || only==='image')await run('gateway.image',async()=>{
  const result=await request('/api/image-generation/providers/qwen-token-plan-cn/test',{modelId:'qwen-image-3.0-pro',prompt:'A simple solid blue circle centered on a plain white background. No text.'},180_000);
  const item=result.images?.[0];if(!item?.dataUrl)throw new Error('No generated image');
  const bytes=Buffer.from(item.dataUrl.split(',')[1],'base64');await writeFile(join(directory,'generated.png'),bytes);
  return {provider:result.providerId,model:result.modelId,bytes:bytes.length,mime:item.mimeType};
});
const probeChat=async(name:string,content:string,attachments?:unknown[],modelRef='qwen-token-plan-cn/qwen3.8-flash')=>run(name,async()=>{
  const catalog=await request('/api/models');
  const metadata=catalog.models?.find((model:{id:string})=>model.id===modelRef);
  const thinking=metadata?.thinking?.options?.includes('low')?'low':metadata?.thinking?.initialValue??'low';
  const conversationId=crypto.randomUUID();const clientMessageId=crypto.randomUUID();
  try{
    await request(`/api/sessions/${conversationId}/inputs`,{kind:'start',clientMessageId,creation:{agentId:'main',projectId:null,execution:null,temporary:true,model:modelRef,thinkingLevel:thinking},input:{content,...(attachments?{attachments}:{})},origin:{type:'system',source:'cli'}});
    const deadline=Date.now()+90_000;
    let lastState:unknown;
    while(Date.now()<deadline){
      await new Promise(resolve=>setTimeout(resolve,1000));
      const history=await request(`/api/sessions/${conversationId}/messages?limit=20`).catch(()=>undefined);
      const rows=history?.messages??[];
      const raw=await request(`/api/sessions/${conversationId}?include=transcriptRows`);
      const failed=(raw.session?.transcriptRows??[]).findLast((row:{role?:string;errorMessage?:string})=>row.role==='assistant'&&row.errorMessage);
      if(failed)throw new Error(clean(failed.errorMessage));
      const assistant=rows.findLast((row:{role?:string})=>row.role==='assistant');
      const text=typeof assistant?.content==='string'?assistant.content:assistant?.content?.filter((block:{type:string})=>block.type==='text').map((block:{text:string})=>block.text).join('');
      if(text?.trim()){
        const expected=name==='gateway.chat'?'BAILIAN_E2E_OK':name==='gateway.reasoning'?'BAILIAN_REASONING_OK':undefined;
        if(expected&&!text.includes(expected))throw new Error('Response did not contain the expected test marker');
        if(name==='gateway.vision'&&!/red|红/i.test(text))throw new Error('Vision response did not identify the red square');
        return {conversationId,text,provider:assistant.provider??'qwen-token-plan-cn',model:assistant.model??modelRef};
      }
      lastState=await request(`/api/sessions/${conversationId}/input-state`);
      if(JSON.stringify(lastState).includes('provider_usage_scope_denied'))throw new Error('Interactive chat was rejected by scope guard');
    }
    throw new Error(`Chat timed out: ${clean(JSON.stringify(lastState))}`);
  }finally{await fetch(base+`/api/sessions/${conversationId}`,{method:'DELETE',headers,signal:AbortSignal.timeout(10000)}).catch(()=>{});}
});
if(flags.has('--chat'))await probeChat('gateway.chat','这是一次端到端配置测试。不要调用任何工具，也不要保存记忆。请只回复：BAILIAN_E2E_OK');
if(only==='chat-image')await run('gateway.chat-image-tool',async()=>{
  const conversationId=crypto.randomUUID();
  try{
    await request(`/api/sessions/${conversationId}/inputs`,{kind:'start',clientMessageId:crypto.randomUUID(),creation:{agentId:'main',projectId:null,execution:null,temporary:true,model:'qwen-token-plan-cn/qwen3.8-flash',thinkingLevel:'low'},input:{content:'这是生图端到端测试。请用 image_generate 工具画一张可爱的小猫在跳舞，比例为1:1，只生成一张。使用当前配置的模型，不要更换服务，不要保存记忆。'},origin:{type:'system',source:'cli'}});
    const deadline=Date.now()+180_000;
    while(Date.now()<deadline){
      await new Promise(resolve=>setTimeout(resolve,1000));
      const history=await request(`/api/sessions/${conversationId}?include=transcriptRows`);
      const failed=(history.session?.transcriptRows??[]).findLast((row:any)=>row.role==='assistant'&&row.errorMessage);
      if(failed)throw new Error(clean(failed.errorMessage));
      const results=(history.session?.transcriptRows??[]).filter((row:any)=>row.role==='toolResult'&&row.toolName==='image_generate');
      const failure=results.find((row:any)=>row.details?.error);
      if(failure)throw new Error(clean(JSON.stringify(failure.content)));
      const success=results.find((row:any)=>row.details?.media?.length);
      if(!success)continue;
      if(success.details.provider!=='qwen-token-plan-cn')throw new Error('Unexpected cross-provider image generation');
      const media=success.details.media[0];
      const response=await fetch(base+`/api/media/read?uri=${encodeURIComponent(media.uri)}&conversationId=${conversationId}`,{headers,signal:AbortSignal.timeout(30_000)});
      if(!response.ok)throw new Error(`Generated attachment read HTTP ${response.status}`);
      const bytes=Buffer.from(await response.arrayBuffer());
      if(bytes.length<1000||!response.headers.get('content-type')?.startsWith('image/'))throw new Error('Missing image attachment');
      await writeFile(join(directory,'dancing-cat.png'),bytes);
      return{provider:success.details.provider,model:success.details.model,toolSuccess:true,attachmentRead:true,bytes:bytes.length,attempts:success.details.attempts};
    }
    throw new Error('Chat image tool timed out');
  }finally{await fetch(base+`/api/sessions/${conversationId}`,{method:'DELETE',headers,signal:AbortSignal.timeout(10000)}).catch(()=>{});}
});
if(only==='reasoning')await probeChat('gateway.reasoning','这是复杂任务模型端到端测试。不要调用工具，不要保存记忆。请只回复：BAILIAN_REASONING_OK',undefined,plan.taskModels?.reasoning??'qwen-token-plan-cn/qwen3.8-max');
if(flags.has('--vision')){
 // A deterministic PNG generated locally; no external image service is involved.
 const {default:sharp}=await import('sharp');
 const image=await sharp({create:{width:128,height:128,channels:3,background:{r:240,g:20,b:20}}}).png().toBuffer();
 await writeFile(join(directory,'vision-input.png'),image);
 await probeChat('gateway.vision','这是一次看图测试。请只回答图片主要是什么颜色，不要调用工具。',[{type:'image',mimeType:'image/png',data:image.toString('base64'),name:'red-square.png'}]);
}
if(only==='omni')await run('runtime.subscription-omni',async()=>{
 const fixture=process.argv.find(arg=>arg.startsWith('--pcm='))?.slice(6);if(!fixture)throw new Error('Use --pcm=PCM16_16KHZ_FILE');
 const {createOmniVoiceEngine}=await import('../src/voice/realtime/omniEngine.js');
 const {withModelUsageOrigin}=await import('../src/providers/model-usage.js');
 const {resolveProviderApiKeyForAgentSync}=await import('../src/auth/sync-provider-auth.js');
 const apiKey=resolveProviderApiKeyForAgentSync('qwen-token-plan-cn');if(!apiKey)throw new Error('Saved subscription credential unavailable');
 const pcm=await readFile(fixture);const transcripts:unknown[]=[];const chunks:Buffer[]=[];
 let done=false;let failure:Error|undefined;const played=new Map<string,number>();
 const engine=createOmniVoiceEngine({callId:crypto.randomUUID(),silenceDurationMs:1200,bargeIn:false,
  route:{route:{provider:'qwen-token-plan-cn',model:'qwen-audio-3.0-realtime-plus',managed:false},url:'wss://token-plan.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen-audio-3.0-realtime-plus',apiKey,voice:'longanqian',instructions:'请用中文简短回复用户，只说测试成功。'},
  send:(type,payload)=>{if(type==='session.error')failure=new Error(JSON.stringify(payload));if(type==='response.done')done=true;},
  sendAudio:(responseId,bytes)=>{chunks.push(Buffer.from(bytes));played.set(responseId,(played.get(responseId)??0)+bytes.length);engine.acknowledge(responseId,Math.floor(played.get(responseId)!/48));},
  record:async row=>{transcripts.push(row);},onClose:async reason=>{if(!done)failure=new Error('Voice closed: '+reason);},
 });
 try{
  await withModelUsageOrigin('interactive',()=>engine.start());
  const input=Buffer.concat([pcm,Buffer.alloc(64000)]);
  for(let offset=0;offset<input.length&&!failure;offset+=640){const frame=Buffer.alloc(640);input.copy(frame,0,offset,Math.min(offset+640,input.length));engine.appendAudio(frame);await new Promise(resolve=>setTimeout(resolve,20));}
  const deadline=Date.now()+60000;while(!done&&!failure&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100));
  if(failure)throw failure;if(!done||!chunks.length)throw new Error('No complete audible native reply');
  const output=Buffer.concat(chunks);await writeFile(join(directory,'omni-reply.pcm'),output);
  return{provider:'qwen-token-plan-cn',model:'qwen-audio-3.0-realtime-plus',audioBytes:output.length,transcripts,savedNaturalProvider:config.voice?.realtime?.omni?.provider,configurationChanged:false};
 }finally{await engine.close();}
});
if(only==='policy')await run('runtime.background-scope',async()=>{
 const {withModelUsageOrigin,assertProviderUsage,getModelUsageOrigin}=await import('../src/providers/model-usage.js');
 for(const provider of ['qwen-token-plan-cn','xiaomi-token-plan-cn','kimi-coding','volcengine-plan','stepfun-plan']) {
  assertProviderUsage(provider);
  withModelUsageOrigin('background',()=>withModelUsageOrigin('interactive',()=>{assertProviderUsage(provider);if(getModelUsageOrigin()!=='background')throw new Error('Call origin attribution changed');}));
 }
 return{providerBackgroundAllowed:true,networkRequests:0};
});
if(only==='browser')await run('browser.saved-configuration',async()=>{
 const {default:playwright}=await import('playwright-core');
 let browser;try{browser=await playwright.chromium.launch({headless:true});}catch{browser=await playwright.chromium.launch({headless:true,channel:'chrome'});}
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  await page.addInitScript(credential=>{localStorage.setItem('xopc.token',credential);localStorage.setItem('xopc.language','zh');},config.gateway.auth.token);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(clean(error.message)));
  await page.goto(process.env.XOPC_WEB_E2E_URL??'http://localhost:3000/#/settings/capabilities/models',{waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'模型用途',exact:true}).waitFor({timeout:30000});
  const panel=page.locator('section').filter({has:page.getByRole('heading',{name:'模型用途',exact:true})});
  const text=await panel.innerText();
  for(const model of ['qwen3.8-flash','qwen-image-3.0-pro','qwen-audio-3.0-tts-plus','qwen-audio-3.0-asr-flash'])if(!text.toLowerCase().replace(/[^a-z0-9]/g,'').includes(model.replace(/[^a-z0-9]/g,'')))throw new Error(`Saved use not visible: ${model}`);
  await panel.screenshot({path:join(directory,'model-uses.png')});
  await page.request.delete(new URL('/api/browser-session',page.url()).toString());
  if(errors.length)throw new Error(errors.join('; '));
  return{savedChat:true,savedImage:true,savedSpeech:true,savedTranscription:true,realGateway:true,configurationChanged:false};
 }finally{await browser.close();}
});
report.finishedAt=new Date().toISOString();await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({report:join(directory,'report.json'),passed:tests.filter(test=>test.passed).length,total:tests.length}));
process.exitCode=tests.some(test=>!test.passed)?1:0;
