/** Real-time Web recording, crash recovery and real-provider processing in isolated storage. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const directory = process.env.XOPC_NOTE_REALTIME_STATE ?? await mkdtemp(join(tmpdir(),'xopc-note-realtime-'));
const outputs = resolve(process.env.XOPC_NOTE_REALTIME_OUTPUT ?? '/tmp/xopc-note-realtime'); await mkdir(outputs,{recursive:true});
process.env.XOPC_LOG_LEVEL='fatal';process.env.XOPC_STATE_DIR=directory;process.env.XOPC_WORKSPACE=join(directory,'workspace');
process.env.XOPC_CONFIG_PATH=join(directory,'xopc.json');process.env.XOPC_CONFIG=process.env.XOPC_CONFIG_PATH;
await writeFile(process.env.XOPC_CONFIG_PATH,'{}');
const { openXopcDatabase,closeXopcDatabase }=await import('../src/storage/sqlite/index.js');openXopcDatabase({path:join(directory,'xopc.db')});
const {seedTestAgentCatalog}=await import('../src/agent-catalog/test-support.js');seedTestAgentCatalog();
const {NotesService,NotesStore}=await import('../src/notes/index.js');const notes=new NotesService(new NotesStore());await notes.initialize();
const {ProjectService}=await import('../src/projects/index.js');const projects=new ProjectService();
const {DiscussionService}=await import('../src/discussions/service.js');const discussions=new DiscussionService(notes,projects);
const {registerNotesRoutes}=await import('../src/gateway/hono/routes/notes.js');
const {registerDiscussionRoutes}=await import('../src/gateway/hono/routes/discussions.js');
const {setGatewayPrincipal}=await import('../src/gateway/security/gateway-principal.js');
const {getDiscussionCapture}=await import('../src/discussions/repository.js');
const requests:Array<{method:string;path:string;status?:number}>=[];const checks:string[]=[];const errors:string[]=[];
const app=new Hono();
app.use('*',async(c,next)=>{if(!c.req.header('cookie')?.includes('journey=owner'))return c.json({error:'Unauthorized'},401);setGatewayPrincipal(c,{kind:'owner',principalId:'journey-owner',scopes:['workspace.read','workspace.write','tasks.write']});const row={method:c.req.method,path:c.req.path,status:0};requests.push(row);await next();row.status=c.res.status;});
const pass=async(_c:unknown,next:()=>Promise<void>)=>next();
const deps={service:{notesServiceInstance:notes,discussions,projects,currentConfig:{}},strictRateLimitMiddleware:pass,chatRateLimitMiddleware:pass};
registerNotesRoutes(app,deps as never);registerDiscussionRoutes(app,deps as never);
app.get('/api/automations/feedback',c=>c.json({items:[]}));app.get('/api/projects',c=>c.json({items:[],total:0}));
app.get('/api/discussions/:id/actions',c=>c.json([]));
const durationMs=Number(process.env.XOPC_NOTE_REALTIME_DURATION_MS??7_200_000);
assert.ok(durationMs>=60_000&&durationMs<=7_200_000);
assert.equal(process.env.XOPC_NOTE_LIVE,'1','Real supplier processing requires XOPC_NOTE_LIVE=1');
assert.ok(process.env.DASHSCOPE_API_KEY&&process.env.DEEPSEEK_API_KEY);
const reportPath=join(outputs,'report.json');
const resume=process.env.XOPC_NOTE_REALTIME_RESUME==='1';
const previous=resume?JSON.parse(await readFile(reportPath,'utf8')):undefined;
const report:any={startedAt:new Date().toISOString(),directory,durationMs,syntheticMicrophone:true,realTime:true,realProviders:true,checks,requests,errors,progress:[],snapshots:[],...previous,passed:false,phase:'preparing'};
if(previous){assert.equal(previous.directory,directory);checks.push(...previous.checks);report.checks=checks;report.previousErrors=previous.errors;report.errors=errors;requests.push(...previous.requests);report.requests=requests;report.resumes=[...(previous.resumes??[]),new Date().toISOString()];}
const save=async()=>writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
const sleep=(ms:number)=>new Promise(done=>setTimeout(done,ms));
let api:ReturnType<typeof serve>|undefined,server:any,browser:any,context:any,page:any,fixture='',worker:any,recordingBusy=false;
const root=resolve('web');const require=createRequire(join(root,'package.json'));
const {AgentCatalogRepository}=await import('../src/agent-catalog/repository.js');const catalog=new AgentCatalogRepository();const settings=catalog.getSettings();catalog.updateDefaults({...settings.defaults,models:{...settings.defaults.models,chat:{primary:'deepseek/deepseek-flash',fallbacks:[]}}},settings.revision);
const {ConfigSchema}=await import('../src/config/schema.js');const config=ConfigSchema.parse({tools:{media:{audio:{enabled:true,provider:'alibaba',providers:{alibaba:{model:'qwen-audio-3.1-asr-flash'}},fallback:{enabled:false,order:[]}}}}});
const {DiscussionSealer}=await import('../src/discussions/sealer.js');const {DiscussionOrganizer}=await import('../src/discussions/organizer.js');const {DiscussionOrganizerWorker}=await import('../src/discussions/organizer-worker.js');const {processingProgress}=await import('../src/discussions/processing.js');
const rawFetch=globalThis.fetch;report.supplierCalls??=[];
globalThis.fetch=async(input,init)=>{const url=new URL(typeof input==='string'||input instanceof URL?String(input):input.url);const provider=url.hostname==='dashscope.aliyuncs.com'?'alibaba':url.hostname==='api.deepseek.com'?'deepseek':undefined;const row=provider?{provider,startedAt:Date.now(),status:0}:undefined;if(row)report.supplierCalls.push(row);const response=await rawFetch(input,init);if(row)row.status=response.status;return response;};
let id='',noteId='',draftId='';
const current=()=>getDiscussionCapture(id)!;
const draft=()=>page.evaluate(async(id:string)=>(await (window as any).journeyDrafts()).find((row:any)=>row.id===id),draftId);
async function snapshot(label:string,count?:number){const d=await draft();assert.ok(d);const file=join(directory,`${label}.bin`);const handle=await open(file,'w');const hash=createHash('sha256');let bytes=0;try{for(let i=0;i<(count??d.chunkCount);i++){const base64=await page.evaluate(async({id,index}:{id:string;index:number})=>(window as any).journeyChunk(id,index),{id:draftId,index:i});const part=Buffer.from(base64,'base64');await handle.write(part);hash.update(part);bytes+=part.length;}}finally{await handle.close();}const item={label,draft:d,chunks:count??d.chunkCount,bytes,sha256:hash.digest('hex'),file,at:new Date().toISOString()};report.snapshots.push(item);await save();return item;}
async function verifyPrefix(before:any,label:string){const after=await snapshot(label,before.chunks);assert.equal(after.sha256,before.sha256);assert.equal(after.bytes,before.bytes);assert.equal(after.draft.serverDiscussionId,id);assert.equal(current().noteId,noteId);assert.equal(discussions.list().total,1);checks.push(label);}
async function openBrowser(){context=await chromium.launchPersistentContext(join(directory,'profile'),{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,permissions:['microphone'],viewport:{width:1280,height:900},args:['--enable-automation','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-fake-audio-capture=${join(directory,'microphone.wav')}`,'--autoplay-policy=no-user-gesture-required']});browser=context.browser();await context.addCookies([{name:'journey',value:'owner',url:server.resolvedUrls.local[0],httpOnly:true}]);page=await context.newPage();page.setDefaultTimeout(30_000);page.on('pageerror',(error:Error)=>errors.push(error.message));await page.goto(server.resolvedUrls.local[0]+fixture.split('/').at(-1)+'/index.html#/notes');}
async function continueThroughList(){await page.getByRole('button',{name:/未完成的录音/}).click();await page.getByRole('dialog',{name:'未完成的录音',exact:true}).getByRole('button',{name:'继续录制',exact:true}).click();await page.getByRole('button',{name:'标重点',exact:true}).waitFor();await context.setOffline(true);await sleep(5500);assert.equal((await draft()).serverDiscussionId,id);}
async function recordUntil(target:number){report.phase='offline_recording';while(true){const d=await draft();assert.ok(d);const row={at:new Date().toISOString(),durationMs:d.durationMs,chunks:d.chunkCount,state:d.state,savedThroughMs:d.mediaCoverage?.verifiedThroughMs,epochs:d.epochs?.length};report.progress.push(row);await save();console.log(JSON.stringify(row));if(d.durationMs>=target)return;if(d.state!=='recording')throw Error(`Recording stopped before target ${target}: ${JSON.stringify(d)}`);assert.ok(Date.now()-d.updatedAt<20_000,'Original storage stopped progressing');await sleep(Math.min(30_000,Math.max(1000,target-d.durationMs)));}}
try{
 api=serve({fetch:app.fetch,hostname:'127.0.0.1',port:0});await new Promise<void>(done=>api!.once('listening',done));const apiPort=(api.address() as {port:number}).port;
 worker=setInterval(()=>{if(recordingBusy)return;recordingBusy=true;void discussions.processRecordingJob().catch(error=>errors.push(String(error))).finally(()=>{recordingBusy=false;});},1000);
 execFileSync('say',['-v','Samantha','-r','150','-o',join(directory,'speech.aiff'),'Synthetic recording acceptance. Keep the original audio safe. Alice will verify recovery tomorrow. Bob will review the action items on Friday.']);
 execFileSync('ffmpeg',['-v','error','-y','-i',join(directory,'speech.aiff'),'-ar','48000','-ac','1','-c:a','pcm_s16le',join(directory,'microphone.wav')]);
 const {createServer}=await import(require.resolve('vite'));const {default:react}=await import(require.resolve('@vitejs/plugin-react'));const {default:tailwind}=await import(require.resolve('@tailwindcss/vite'));
 fixture=await mkdtemp(join(root,'.note-realtime-'));
 await writeFile(join(fixture,'index.html'),'<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./main.tsx"></script></html>');
 await writeFile(join(fixture,'main.tsx'),`
import React from 'react';import{createRoot}from'react-dom/client';import{createHashRouter,RouterProvider,Outlet}from'react-router-dom';import{SWRConfig}from'swr';import'/src/styles/globals.css';
import{NotesPage}from'/src/features/notes/notes-page';import{GlobalDiscussionCaptureHost}from'/src/features/discussions/global-discussion-capture';import{useGatewayStore}from'/src/stores/gateway-store';import{useLocaleStore}from'/src/stores/locale-store';import{usePageHeaderStore}from'/src/stores/page-header-store';
import{listDiscussionDrafts,getDiscussionDraftChunk}from'/src/features/discussions/discussion-draft-store';
window.journeyDrafts=listDiscussionDrafts;
window.journeyChunk=async(id,index)=>{const chunk=await getDiscussionDraftChunk(id,index);if(!chunk)throw Error('Missing audio chunk '+index);const bytes=new Uint8Array(await chunk.blob.arrayBuffer());let result='';for(let offset=0;offset<bytes.length;offset+=8192)result+=String.fromCharCode(...bytes.subarray(offset,offset+8192));return btoa(result)};
useLocaleStore.setState({language:'zh'});useGatewayStore.setState({conversationId:'journey'});
function Layout(){const h=usePageHeaderStore();return <div className="flex h-dvh flex-col bg-surface-base text-fg"><header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-edge px-4">{h.startExtra}<div className="min-w-0 flex-1">{h.main}</div>{h.end}</header><main className="flex min-h-0 flex-1 flex-col"><Outlet/></main><GlobalDiscussionCaptureHost/></div>}
const router=createHashRouter([{element:<Layout/>,children:[{path:'/notes',element:<NotesPage/>},{path:'/notes/:noteId',element:<NotesPage/>}]}]);if(!location.hash)location.hash='/notes';createRoot(document.getElementById('root')).render(<SWRConfig value={{dedupingInterval:0,errorRetryCount:0}}><RouterProvider router={router}/></SWRConfig>);
`);
 server=await createServer({root,configFile:false,resolve:{alias:{'@':join(root,'src')}},cacheDir:join(fixture,'cache'),plugins:[react(),tailwind()],server:{host:'127.0.0.1',port:Number(process.env.XOPC_NOTE_REALTIME_VITE_PORT??previous?.vitePort??0),strictPort:resume,hmr:false,proxy:{'/api':{target:`http://127.0.0.1:${apiPort}`,changeOrigin:true}}}});await server.listen();report.vitePort=new URL(server.resolvedUrls.local[0]).port;await save();
 await openBrowser();
 if(!resume){
 await page.getByRole('button',{name:'开始录音',exact:true}).click();const consent=page.getByRole('button',{name:'确认并开始',exact:true});await consent.or(page.getByRole('button',{name:'标重点',exact:true})).first().waitFor();if(await consent.isVisible())await consent.click();await page.getByRole('button',{name:'标重点',exact:true}).waitFor();await sleep(5500);
 const initial=await page.evaluate(async()=>(await (window as any).journeyDrafts()).find((row:any)=>row.state==='recording'));assert.ok(initial?.serverDiscussionId);draftId=initial.id;id=initial.serverDiscussionId;noteId=current().noteId;Object.assign(report,{draftId,discussionId:id,noteId,captureStartedAt:Date.now()});await notes.updateNote(noteId,{markdown:'Preserve my two-hour acceptance notes'});await page.getByRole('button',{name:'标重点',exact:true}).click();await context.setOffline(true);
 await recordUntil(Math.floor(durationMs/2));const refresh=await snapshot('before-refresh');await page.reload().catch((error:Error)=>assert.match(error.message,/ERR_INTERNET_DISCONNECTED/));await context.setOffline(false);await page.reload();await continueThroughList();await verifyPrefix(refresh,'after-refresh');
 await recordUntil(durationMs-30_000);const killed=await snapshot('before-kill');const cdp=await browser.newBrowserCDPSession();const processes=await cdp.send('SystemInfo.getProcessInfo');const pid=processes.processInfo.find((row:any)=>row.type==='browser')!.id;process.kill(pid,'SIGKILL');await Promise.race([context.close().catch(()=>{}),sleep(5000)]);context=undefined;await openBrowser();await continueThroughList();await verifyPrefix(killed,'after-kill');
 await recordUntil(durationMs-1000);await context.setOffline(true);const finish=page.getByRole('button',{name:'完成',exact:true});if(await finish.isVisible())await finish.click();await page.getByText('录音已在本机保存，可以离开当前页面。',{exact:true}).waitFor();report.phase='local_saved';const final=await snapshot('final-original');report.recordedDurationMs=final.draft.durationMs;report.recordingFinishedAt=Date.now();assert.ok(final.draft.durationMs>=durationMs-5000);assert.equal(final.draft.epochs.length,3);await save();await context.setOffline(false);
 }else{id=report.discussionId;noteId=report.noteId;draftId=report.draftId;assert.ok(id&&noteId&&draftId);}
 if(!current().audioAttachmentId){
 await page.evaluate(()=>window.dispatchEvent(new Event('open-recording-recoveries')));await page.getByRole('dialog',{name:'未完成的录音',exact:true}).getByRole('button',{name:'恢复',exact:true}).click();
 const originalDeadline=Date.now()+300_000;while(!current().audioAttachmentId&&Date.now()<originalDeadline)await sleep(1000);assert.ok(current().audioAttachmentId,'Original attachment must be confirmed');}
 report.original={attachmentId:current().audioAttachmentId,sha256:current().audioSha256,durationMs:current().durationMs,bytes:current().audioSizeBytes};checks.push('Original recovered, resumed and uploaded in the same Note');await save();
 if(resume&&current().status==='needs_attention')await discussions.retry(id);
 report.phase='real_transcription';const sealer=new DiscussionSealer({notes,getConfig:()=>config});const organizer=new DiscussionOrganizerWorker(new DiscussionOrganizer({notes,projects,getConfig:()=>config}));
 const monitor=setInterval(()=>{report.processing=processingProgress(id);report.status=current().status;void save();console.log(JSON.stringify({phase:report.phase,status:report.status,processing:report.processing}));},30_000);
 try{const deadline=Date.now()+3*60*60_000;while(current().status!=='completed'&&Date.now()<deadline){if(current().status==='needs_attention')throw Error(`Processing failed: ${current().failureMessage}`);await sealer.tick();if(current().status==='organizing'){report.phase='real_note_generation';await organizer.tick();}await sleep(1000);}assert.equal(current().status,'completed');}finally{clearInterval(monitor);await sealer.stop();await organizer.stop();}
 const detail=(await discussions.get(id))!;assert.ok(detail.discussion.canonicalTranscript?.length);assert.ok(detail.organization?.organization?.summary);assert.equal((await notes.getNote(noteId))?.markdown,'Preserve my two-hour acceptance notes');assert.equal(discussions.list().total,1);checks.push('Real transcription and note generation complete without recreating Note or losing manual notes');report.transcriptCharacters=detail.discussion.canonicalTranscript!.length;report.summaryCharacters=detail.organization!.organization!.summary.length;
 await page.goto(server.resolvedUrls.local[0]+fixture.split('/').at(-1)+'/index.html#/notes/'+encodeURIComponent(noteId));await page.locator('audio').waitFor();await page.locator('audio').evaluate((el:HTMLAudioElement)=>el.play());await page.waitForFunction(()=>document.querySelector('audio')!.currentTime>.1);await page.locator('audio').evaluate((el:HTMLAudioElement)=>{el.pause();el.currentTime=el.duration-2;return el.play();});await page.waitForFunction(()=>{const el=document.querySelector('audio')!;return !el.paused&&el.currentTime>el.duration-2;});await page.screenshot({path:join(outputs,'completed-note.png')});checks.push('Recovered original plays from the Note');assert.deepEqual(errors,[]);report.status=current().status;report.processing=processingProgress(id);report.checks=[...new Set(checks)];report.passed=true;delete report.failure;report.phase='completed';
}catch(error){report.failure=error instanceof Error?error.stack:String(error);report.phase='failed';process.exitCode=1;await page?.screenshot({path:join(outputs,'failure.png')}).catch(()=>{});}
finally{globalThis.fetch=rawFetch;clearInterval(worker);await context?.close();await server?.close();if(fixture)await rm(fixture,{recursive:true,force:true});if(api)await new Promise<void>(done=>api!.close(()=>done()));closeXopcDatabase();await save();console.log(JSON.stringify({passed:report.passed,reportPath,failure:report.failure}));}
