// Exercises production components with synthetic audio and an isolated fake gateway.
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const webRequire=createRequire(new URL('../web/package.json',import.meta.url));
const {createServer}=await import(webRequire.resolve('vite'));
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const root=fileURLToPath(new URL('../web',import.meta.url));
process.chdir(root);
const dir=await mkdtemp(root+'/.voice-smoke-');
let browser,server;
try {
await writeFile(dir+'/index.html','<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="./main.jsx"></script></body></html>');
await writeFile(dir+'/main.jsx',`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';
import{VoiceCallProvider}from'/src/features/voice/realtime/voice-call-provider';import{useVoiceCall}from'/src/features/voice/realtime/voice-call-context';import{useRealtimeVoice}from'/src/features/voice/realtime/use-realtime-voice';import{VoiceSettingsPanel}from'/src/features/settings/voice-settings';import{useGatewayStore}from'/src/stores/gateway-store';import{useLocaleStore}from'/src/stores/locale-store';import{messages}from'/src/i18n/messages';import'/src/styles/globals.css';
useGatewayStore.setState({token:'synthetic-test'});useLocaleStore.setState({language:'zh'});
function Harness(){const call=useVoiceCall();const[page,setPage]=useState(false);const[draft,setDraft]=useState('原草稿');const[count,setCount]=useState(0);const voice=useRealtimeVoice({disabled:false,chat:messages('zh').chat,onTranscript:text=>setDraft(v=>v+' '+text)});return <main style={{padding:24,maxWidth:900}}><button onClick={()=>call.open({sessionKey:'same-chat',name:'Ada'})}>测试通话</button><button onClick={()=>setPage(!page)}>切换页面</button>{page?<VoiceSettingsPanel/>:<><textarea aria-label="草稿" value={draft} onChange={e=>setDraft(e.target.value)}/><button onClick={voice.startVoiceInput}>听写测试</button><button onClick={voice.confirmVoiceInput}>完成听写</button><button onClick={voice.cancelVoiceInput}>取消听写</button><button onClick={()=>setCount(v=>v+1)}>发送</button><p data-count>{count}</p><p data-phase>{voice.phase}</p></>}</main>}
createRoot(document.getElementById('root')).render(<MemoryRouter><VoiceCallProvider><Harness/></VoiceCallProvider></MemoryRouter>);`);
server=await createServer({configFile:root+'/vite.config.ts',root,server:{port:3017,strictPort:true,open:false}});await server.listen();
browser=await chromium.launch({executablePath:process.env.XOPC_VOICE_SMOKE_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
const context=await browser.newContext({permissions:['microphone'],viewport:{width:1024,height:900}});const page=await context.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
const controls=[],connections=[],answers=[];let current,session;
const route={engine:'agent',stt:{provider:'alibaba',model:'test',managed:false},tts:{provider:'alibaba',model:'test',managed:false}};
await page.route('**/api/**',async r=>{const path=new URL(r.request().url()).pathname;let payload={};
if(path==='/api/voice/realtime/sessions'){const req=r.request().postDataJSON();session={sessionId:randomUUID(),ticket:'test',protocolVersion:2,purpose:req.purpose,inputMode:'server_vad',bargeIn:true,inputFormat:{encoding:'pcm_s16le',sampleRate:16000,channels:1},limits:{maxSessionMs:600000,maxBinaryFrameBytes:65536,idleTimeoutMs:60000},websocketPath:'/api/voice/realtime/v2/ws',route:req.purpose==='dictation'?{engine:'dictation',stt:route.stt}:route};payload=session;connections.push(req)}
if(path==='/api/config')payload={config:{voice:{realtime:{enabled:true,defaultEngine:'agent',tts:{provider:'alibaba'},omni:{provider:'alibaba',model:'qwen3-omni-flash-realtime',voice:'Cherry',instructions:'Concise'}}},stt:{enabled:true,provider:'alibaba'}}};
if(path==='/api/voice/models')payload={models:{stt:{},tts:{},ttsVoices:{}}};
if(path.endsWith('/providers')||path.endsWith('/stt-providers'))payload={providers:[]};
if(path.endsWith('/tts-voices'))payload={voices:[]};
if(path==='/api/voice/realtime/status')payload={enabled:true,defaultEngine:'agent',stt:route.stt,tts:route.tts,omni:{provider:'alibaba',model:'test',managed:false}};
if(path.startsWith('/api/clarify/'))answers.push(r.request().postDataJSON());
if(path.includes('/approvals'))payload={approvals:[]};
if(path.includes('/transcriptions/refine'))payload={text:'识别文本。'};
await r.fulfill({json:{ok:true,payload}})});
await page.routeWebSocket('**/api/voice/realtime/v2/ws',ws=>{let seq=0;const own=session;current={ws,emit:(type,payload)=>ws.send(JSON.stringify({protocolVersion:2,eventId:randomUUID(),seq:++seq,type,sentAt:Date.now(),sessionId:own.sessionId,payload}))};const conn=current;
ws.onMessage(raw=>{if(typeof raw!=='string')return;const msg=JSON.parse(raw);controls.push(msg);if(msg.type==='session.start')conn.emit('session.ready',{purpose:own.purpose,inputMode:'server_vad',inputFormat:own.inputFormat,route:own.route,heartbeatIntervalMs:15000});if(msg.type==='input.commit')ws.close({code:1000,reason:'input_committed'});if(msg.type==='session.stop')ws.close({code:1000,reason:'user_finished'});});});
await page.goto('http://localhost:3017/'+dir.split('/').at(-1)+'/index.html');
await page.getByRole('button',{name:'测试通话',exact:true}).click();await page.getByText('我在听',{exact:true}).waitFor();
if(connections.length!==1||connections[0].engine!==undefined)throw Error('Call did not use one-click server default');
current.emit('input.speech_stopped',{utteranceId:'u1'});current.emit('response.created',{responseId:'r1'});current.emit('response.text.delta',{responseId:'r1',delta:'你好，**今天**想聊什么？'});current.emit('response.audio.started',{responseId:'r1',format:{encoding:'pcm_s16le',sampleRate:24000,channels:1}});
// Send one second of synthetic PCM through the real decoder and Web Audio player.
const pcm=Buffer.alloc(48000);for(let i=0;i<24000;i++)pcm.writeInt16LE(Math.round(Math.sin(i/24000*440*Math.PI*2)*2000),i*2);
const frame=Buffer.alloc(14+pcm.length);frame.writeUInt32BE(0x584f5032,0);frame.writeUInt32BE(1,4);frame.writeUInt32BE(2,8);frame.write('r1',12);pcm.copy(frame,14);current.ws.send(frame);
await page.getByRole('button',{name:'停止回复',exact:true}).click();if(!controls.some(c=>c.type==='session.metric'&&c.payload.metric==='speech_end_to_audio_received'))throw Error('PCM did not reach the player');
if(!controls.some(c=>c.type==='response.cancel')||controls.some(c=>c.type==='input.commit'))throw Error('Stop submitted input');
current.emit('response.created',{responseId:'r2'});current.emit('response.activity',{responseId:'r2',toolCallId:'tool1',toolName:'clarify',status:'running'});current.emit('response.clarification',{responseId:'r2',requestId:'question1',question:'请选择路线',choices:['路线 A','路线 B']});
await page.getByText('请选择路线',{exact:true}).waitFor();if(answers.length)throw Error('Clarification submitted without a click');await page.getByRole('button',{name:'路线 A',exact:true}).click();await page.waitForFunction(()=>!document.body.textContent.includes('请选择路线'));if(answers.length!==1||answers[0].answer!=='路线 A')throw Error('Clarification did not use existing endpoint');current.emit('response.activity',{responseId:'r2',toolCallId:'tool1',toolName:'clarify',status:'completed'});current.emit('response.done',{responseId:'r2',audio:false,finishReason:'text_only'});
await page.getByRole('button',{name:'关闭麦克风',exact:true}).click();if(!controls.some(c=>c.type==='input.mute'&&c.payload.muted))throw Error('Mute not sent');
await page.getByRole('button',{name:'收起通话',exact:true}).click();await page.getByRole('button',{name:'切换页面',exact:true}).click();await page.getByRole('button',{name:'语音服务',exact:true}).click();await page.getByText('默认通话方案',{exact:true}).waitFor();
if(connections.length!==1||controls.some(c=>c.type==='session.stop'))throw Error('Navigation ended call');
await page.screenshot({path:'/tmp/xopc-voice-production-settings.png',fullPage:true});
await page.locator('[role="region"][aria-label="语音通话"] button').first().click();await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/xopc-voice-production-mobile.png',fullPage:true});
const dialog=page.getByRole('dialog');const box=await dialog.boundingBox();if(!box||box.x<0||box.x+box.width>391)throw Error('Call overflows mobile');
await page.getByRole('button',{name:'挂断',exact:true}).click();await page.getByRole('button',{name:'切换页面',exact:true}).click();await page.getByRole('button',{name:'听写测试',exact:true}).click();await page.locator('[data-phase]').filter({hasText:'recording'}).waitFor();current.emit('input.transcript.final',{utteranceId:'dict1',revision:1,text:'识别文本'});await page.getByRole('button',{name:'取消听写',exact:true}).click();if(await page.getByRole('textbox',{name:'草稿'}).inputValue()!=='原草稿')throw Error('Cancel changed draft');
await page.getByRole('button',{name:'听写测试',exact:true}).click();await page.locator('[data-phase]').filter({hasText:'recording'}).waitFor();current.emit('input.transcript.final',{utteranceId:'dict2',revision:1,text:'识别文本'});await page.getByRole('button',{name:'完成听写',exact:true}).click();await page.waitForFunction(()=>document.querySelector('textarea').value.includes('识别文本。'));if(await page.locator('[data-count]').textContent()!=='0')throw Error('Dictation submitted a message');
if(errors.length)throw Error(errors.join('\n'));console.log(JSON.stringify({passed:true,connections:connections.length,controls:controls.map(c=>c.type),checks:'real React settings/call, fake Chrome microphone + PCM playback, one-click, stop, mute, navigation, mobile layout, explicit clarification, dictation cancel/finish/refine'}));
} finally {await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true});}
