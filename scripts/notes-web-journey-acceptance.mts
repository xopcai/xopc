/** Full production Notes pages and capture host; isolated real routes/SQLite/media, controlled AI output. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const directory = await mkdtemp(join(tmpdir(),'xopc-notes-journey-'));
const outputs = resolve(process.env.XOPC_NOTE_JOURNEY_OUTPUT ?? '/tmp/xopc-notes-journey'); await mkdir(outputs,{recursive:true});
process.env.XOPC_STATE_DIR=directory;process.env.XOPC_WORKSPACE=join(directory,'workspace');
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
const {replaceTranscriptSegments,refreshCanonicalTranscript}=await import('../src/discussions/revisions.js');
const {getDiscussionCapture,updateDiscussionCapture,createDiscussionOrganization,completeDiscussionOrganization}=await import('../src/discussions/repository.js');
const {getSqliteDatabase}=await import('../src/storage/sqlite/transaction.js');
const requests:Array<{method:string;path:string;status?:number}>=[];const checks:string[]=[];const errors:string[]=[];
const app=new Hono();
app.use('*',async(c,next)=>{if(!c.req.header('cookie')?.includes('journey=owner'))return c.json({error:'Unauthorized'},401);setGatewayPrincipal(c,{kind:'owner',principalId:'journey-owner',scopes:['workspace.read','workspace.write','tasks.write']});const row={method:c.req.method,path:c.req.path,status:0};requests.push(row);await next();row.status=c.res.status;});
const pass=async(_c:unknown,next:()=>Promise<void>)=>next();
const deps={service:{notesServiceInstance:notes,discussions,projects,currentConfig:{}},strictRateLimitMiddleware:pass,chatRateLimitMiddleware:pass};
registerNotesRoutes(app,deps as never);registerDiscussionRoutes(app,deps as never);
app.get('/api/automations/feedback',c=>c.json({items:[]}));app.get('/api/projects',c=>c.json({items:[],total:0}));
app.get('/api/discussions/:id/actions',c=>c.json([]));
let api:ReturnType<typeof serve>|undefined,server:any,browser:any,page:any,fixture='';let holdOriginal=false;let workerBusy=false;let worker:any;
const root=resolve('web');const require=createRequire(join(root,'package.json'));
const recordings:Array<{noteId:string;discussionId:string;durationMs?:number;sha256?:string;audioAttachmentId?:string}>=[];
const report={passed:false,recordings,syntheticMicrophone:true,controlledAI:true,realNotesRoutes:true,realDiscussionRoutes:true,realMediaRecorder:true,sqlite:join(directory,'xopc.db'),checks,requests,errors};
try{
 api=serve({fetch:app.fetch,hostname:'127.0.0.1',port:0});await new Promise<void>(done=>api!.once('listening',done));const apiPort=(api.address() as {port:number}).port;
 worker=setInterval(()=>{if(workerBusy)return;workerBusy=true;void(async()=>{
  if(!holdOriginal)await discussions.processRecordingJob();
  for(const row of discussions.list().items){const capture=getDiscussionCapture(row.id)!;if(!capture.audioAttachmentId||!['stopping','sealing','organizing'].includes(capture.status))continue;
   // AI provider boundary only; original decoding, storage, note identity and evidence routes stay real.
   const duration=capture.durationMs??8000;const split=Math.min(4000,Math.floor(duration/2));
   replaceTranscriptSegments(capture.id,[{text:'先把离线录音和恢复做好，保证原音完整保存。',startedAtMs:0,endedAtMs:split},{text:'下周交付恢复入口，失败后沿用同一条笔记重试。',startedAtMs:split,endedAtMs:duration}]);refreshCanonicalTranscript(capture.id);
   const updated=getDiscussionCapture(capture.id)!;const org=createDiscussionOrganization({discussionId:capture.id,inputTranscriptSha256:updated.canonicalTranscriptSha256!,promptVersion:'journey',modelRef:'controlled/fixture',transcriptRevision:updated.transcriptRevision});
   completeDiscussionOrganization(org.id,{title:'录音体验验收',summary:'先保证原音完整保存，再完善恢复与回顾体验。',summaryEvidenceSegmentIds:[0],keyPoints:['原音安全保存后，可以离开页面。'],decisions:[],actionItems:[],risks:[],openQuestions:[],chapters:[]});
   updateDiscussionCapture(capture.id,{status:'completed'});await notes.updateNote(capture.noteId,{title:'录音体验验收'});
  }
 })().catch(error=>errors.push('Worker: '+String(error))).finally(()=>{workerBusy=false;});},500);
 execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=12','-c:a','pcm_s16le',join(directory,'microphone.wav')]);
 const {createServer}=await import(require.resolve('vite'));const {default:react}=await import(require.resolve('@vitejs/plugin-react'));const {default:tailwind}=await import(require.resolve('@tailwindcss/vite'));
 fixture=await mkdtemp(join(root,'.notes-journey-'));
 await writeFile(join(fixture,'index.html'),'<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./main.tsx"></script></html>');
 await writeFile(join(fixture,'main.tsx'),`
import React from 'react';import{createRoot}from'react-dom/client';import{createHashRouter,RouterProvider,Outlet}from'react-router-dom';import{SWRConfig}from'swr';import'/src/styles/globals.css';
import{NotesPage}from'/src/features/notes/notes-page';import{GlobalDiscussionCaptureHost}from'/src/features/discussions/global-discussion-capture';import{useGatewayStore}from'/src/stores/gateway-store';import{useLocaleStore}from'/src/stores/locale-store';import{usePageHeaderStore}from'/src/stores/page-header-store';
import{listDiscussionDrafts,getDiscussionDraftChunk}from'/src/features/discussions/discussion-draft-store';
window.journeyDrafts=listDiscussionDrafts;
window.journeyPrefix=async(id,count)=>{const parts=[];for(let i=0;i<count;i++)parts.push((await getDiscussionDraftChunk(id,i)).blob);const bytes=await new Blob(parts).arrayBuffer();return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('')};
useLocaleStore.setState({language:'zh'});useGatewayStore.setState({conversationId:'journey'});
function Layout(){const h=usePageHeaderStore();return <div className="flex h-dvh flex-col bg-surface-base text-fg"><header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-edge px-4">{h.startExtra}<div className="min-w-0 flex-1">{h.main}</div>{h.end}</header><main className="flex min-h-0 flex-1 flex-col"><Outlet/></main><GlobalDiscussionCaptureHost/></div>}
const router=createHashRouter([{element:<Layout/>,children:[{path:'/notes',element:<NotesPage/>},{path:'/notes/:noteId',element:<NotesPage/>}]}]);if(!location.hash)location.hash='/notes';createRoot(document.getElementById('root')).render(<SWRConfig value={{dedupingInterval:0,errorRetryCount:0}}><RouterProvider router={router}/></SWRConfig>);
`);
 server=await createServer({root,configFile:false,resolve:{alias:{'@':join(root,'src')}},cacheDir:join(fixture,'cache'),plugins:[react(),tailwind()],server:{host:'127.0.0.1',port:0,hmr:false,proxy:{'/api':{target:`http://127.0.0.1:${apiPort}`,changeOrigin:true}}}});await server.listen();
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-fake-audio-capture=${join(directory,'microphone.wav')}`,'--autoplay-policy=no-user-gesture-required']});
 const context=await browser.newContext({permissions:['microphone'],viewport:{width:1280,height:900}});await context.addCookies([{name:'journey',value:'owner',url:server.resolvedUrls.local[0],httpOnly:true}]);
 page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',(error:Error)=>errors.push(error.message));page.on('console',(message:any)=>{if(message.text().includes('Duplicate extension names'))errors.push(message.text());});
 await page.goto(server.resolvedUrls.local[0]+fixture.split('/').at(-1)+'/index.html');
 await page.getByRole('button',{name:/新建空白笔记/}).first().click();await page.waitForURL(/#\/notes\//);
 await page.screenshot({path:join(outputs,'01-new-note.png')});checks.push('New blank note through production NotesPage and authenticated Notes route');
 // Save a real title and content through the editor.
 const blankId=new URL(page.url()).hash.split('/notes/')[1].split('?')[0];
 await page.getByPlaceholder('无标题',{exact:true}).fill('验收：原音与后续行动');
 await page.locator('[contenteditable="true"]').first().fill('先保住原音，再整理成可回顾的笔记。');
 const savedDeadline=Date.now()+10000;while(Date.now()<savedDeadline){const saved=await notes.getNote(blankId);if(saved?.title==='验收：原音与后续行动'&&saved.markdown.includes('先保住原音'))break;await page.waitForTimeout(100);}
 const savedBlank=await notes.getNote(blankId);assert.equal(savedBlank?.title,'验收：原音与后续行动');assert.match(savedBlank?.markdown??'',/先保住原音/);checks.push('Title and body autosave durably through real note update route');
 await page.goto(server.resolvedUrls.local[0]+fixture.split('/').at(-1)+'/index.html#/notes');
 await page.screenshot({path:join(outputs,'02-notes-home.png')});

 // Use the normal recording entry (including its discoverability in the current UI).
 const direct=page.getByRole('button',{name:'开始录音',exact:true});
 if(await direct.count())await direct.click();else{await page.getByRole('button',{name:/用 Agent 整理想法/}).click();await page.getByRole('button',{name:'录制讨论',exact:true}).click();}
 const consent=page.getByRole('button',{name:'确认并开始',exact:true});await consent.or(page.getByRole('button',{name:'标重点',exact:true})).first().waitFor();if(await consent.isVisible())await consent.click();

 await page.getByRole('button',{name:'标重点',exact:true}).waitFor();await page.waitForTimeout(5500);await page.getByRole('button',{name:'标重点',exact:true}).click();
 await page.screenshot({path:join(outputs,'03-recording.png')});
 await page.getByRole('button',{name:'暂停',exact:true}).click();await page.getByRole('button',{name:'继续',exact:true}).click();await page.waitForTimeout(2000);
 if(process.env.XOPC_NOTE_JOURNEY_RECOVERY==='1'){
  const draft=await page.evaluate(async()=>{const rows=await window.journeyDrafts();return rows.find(row=>row.state==='recording');});assert.ok(draft?.serverDiscussionId);
  const prefix=await page.evaluate(d=>window.journeyPrefix(d.id,d.chunkCount),draft);
  await context.setOffline(true);
  await page.reload().catch((error:Error)=>assert.match(error.message,/ERR_INTERNET_DISCONNECTED/));
  await context.setOffline(false);await page.reload();
  await page.getByRole('button',{name:/未完成的录音/}).click();
  await page.getByRole('dialog',{name:'未完成的录音',exact:true}).getByRole('button',{name:'继续录制',exact:true}).click();
  await page.getByRole('button',{name:'标重点',exact:true}).waitFor();await page.waitForTimeout(5500);
  const continued=await page.evaluate(async id=>(await window.journeyDrafts()).find(row=>row.id===id),draft.id);
  assert.equal(continued.serverDiscussionId,draft.serverDiscussionId);assert.ok(continued.epochs.length===2);
  assert.equal(await page.evaluate(d=>window.journeyPrefix(d.id,d.chunkCount),draft),prefix);
  assert.equal((getSqliteDatabase().prepare('SELECT COUNT(*) n FROM discussion_captures').get() as {n:number}).n,1);
  checks.push('Production recovery list resumes a refreshed recording in the same Note with unchanged committed original prefix');
  await page.screenshot({path:join(outputs,'03b-refreshed-continuation.png')});
 }
 holdOriginal=true;await page.getByRole('button',{name:'完成',exact:true}).click();await page.getByText('录音已在本机保存，可以离开当前页面。',{exact:true}).waitFor();checks.push('Real microphone capture, highlight, pause/resume and local save barrier');
 await page.screenshot({path:join(outputs,'04-saved.png')});
 await page.getByRole('button',{name:'打开笔记',exact:true}).click();assert.equal(await page.locator('[data-recording-window]').getAttribute('data-recording-window'),'compact');holdOriginal=false;
 await page.getByRole('heading',{name:'录音体验验收',exact:true}).waitFor();await page.locator('[data-recording-window]').waitFor({state:'detached'});await page.screenshot({path:join(outputs,'05-overview.png')});
 const noteId=new URL(page.url()).hash.split('/notes/')[1].split('?')[0];const capture=discussions.list().items.find(row=>row.noteId===noteId)!;assert.ok(capture.audioAttachmentId);
 await page.getByRole('button',{name:'原文',exact:true}).click();await page.getByText('先把离线录音和恢复做好，保证原音完整保存。',{exact:true}).waitFor();
 const audio=page.locator('audio');await page.waitForFunction(()=>document.querySelector('audio')!.readyState>=1);await audio.evaluate((el:HTMLAudioElement)=>el.play());await page.waitForFunction(()=>document.querySelector('audio')!.currentTime>.15);
 const identity=await audio.evaluate((el:HTMLAudioElement)=>{el.dataset.journey='same';el.pause();return el.currentTime;});await page.getByRole('button',{name:'概览',exact:true}).click();assert.equal(await audio.getAttribute('data-journey'),'same');assert.ok(await audio.evaluate((el:HTMLAudioElement,position:number)=>Math.abs(el.currentTime-position)<.3,identity));
 assert.equal(await page.locator('[data-recording-window]').count(),0);checks.push('Confirmed original plays; switching transcript/overview retains audio element and position');
 await page.getByRole('button',{name:'查看原话',exact:true}).click();const source=page.getByRole('complementary',{name:'原话证据',exact:true});await source.waitFor();await source.getByText('先把离线录音和恢复做好，保证原音完整保存。',{exact:true}).waitFor();
 await source.getByRole('button',{name:/^播放原话 /}).first().click();await page.waitForFunction(()=>{const el=document.querySelector('audio')!;return !el.paused&&el.currentTime>.1&&el.currentTime<4;});await source.getByRole('button',{name:'关闭',exact:true}).click();await audio.evaluate((el:HTMLAudioElement)=>el.pause());checks.push('Summary evidence resolves original words and plays the corresponding real source interval');

 const counts=getSqliteDatabase().prepare('SELECT COUNT(*) n FROM discussion_captures').get() as {n:number};assert.equal(counts.n,1);checks.push('One recording retains exactly one Discussion and Note');
 for(const width of [390,320]){await page.setViewportSize({width,height:844});assert.equal(await page.locator('header').first().getByRole('button').count(),1);await page.screenshot({path:join(outputs,`06-note-${width}.png`),animations:'disabled'});assert.equal(await page.locator('body').evaluate((el:HTMLElement)=>el.scrollWidth>innerWidth),false);}
 // Repeat the core path at phone width, including offline capture and an explicit sync retry.
 await page.setViewportSize({width:390,height:844});await page.goto(server.resolvedUrls.local[0]+fixture.split('/').at(-1)+'/index.html#/notes');
 const mobileCreated=page.waitForResponse((response:any)=>response.url().endsWith('/api/discussions')&&response.request().method()==='POST'&&response.status()===201);
 await page.getByRole('button',{name:'开始录音',exact:true}).click();await mobileCreated;await page.getByRole('button',{name:'标重点',exact:true}).waitFor();
 await context.setOffline(true);await page.waitForTimeout(5500);await page.getByRole('button',{name:'缩小录音窗',exact:true}).click();await page.getByRole('button',{name:'标重点',exact:true}).click();
 assert.equal(await page.locator('[data-recording-window] [role=alert]').count(),0);await page.screenshot({path:join(outputs,'07-mobile-offline-recording.png'),animations:'disabled'});
 const float=page.locator('[data-recording-window]');const grip=await page.getByRole('button',{name:'移动录音窗',exact:true}).boundingBox();await page.mouse.move(grip.x+15,grip.y+15);await page.mouse.down();await page.mouse.move(36,130,{steps:8});await page.mouse.up();
 assert.equal(await float.evaluate((el:HTMLElement)=>el.scrollWidth>el.clientWidth),false);
 await page.getByRole('button',{name:'暂停',exact:true}).click();await page.getByRole('button',{name:'继续',exact:true}).click();await page.waitForTimeout(1200);await page.getByRole('button',{name:'完成',exact:true}).click();
 await page.getByRole('button',{name:'重试同步',exact:true}).waitFor();assert.match(await float.innerText(),/录音已在本机保存，可以离开/);await page.screenshot({path:join(outputs,'08-mobile-offline-saved.png')});
 await context.setOffline(false);await page.getByRole('button',{name:'重试同步',exact:true}).click();await page.getByText('原音已同步，可以离开当前页面。',{exact:true}).waitFor();
 await page.getByRole('button',{name:'打开笔记',exact:true}).click();await float.waitFor({state:'detached'});await page.getByRole('heading',{name:'录音体验验收',exact:true}).waitFor();
 const mobileNoteId=new URL(page.url()).hash.split('/notes/')[1].split('?')[0];assert.notEqual(mobileNoteId,noteId);assert.equal(discussions.list().total,2);
 await page.getByRole('button',{name:'搜索此 Note',exact:true}).click();await page.getByRole('textbox',{name:'搜索此 Note',exact:true}).fill('恢复入口');await page.getByRole('heading',{name:/搜索结果/}).waitFor();await page.getByRole('button',{name:'关闭搜索',exact:true}).click();
 await page.getByRole('button',{name:'标记',exact:true}).click();await page.getByRole('button',{name:/^回听 /}).first().waitFor();
 await page.reload();await page.getByRole('heading',{name:'录音体验验收',exact:true}).waitFor();assert.equal(discussions.list().total,2);checks.push('Phone-width offline capture, compact controls, drag, local save, sync retry, search and reload retain each Note identity');
 for(const row of discussions.list().items){const capture=getDiscussionCapture(row.id)!;assert.ok(capture.audioAttachmentId);assert.ok(capture.durationMs&&capture.durationMs>5000);recordings.push({noteId:capture.noteId,discussionId:capture.id,durationMs:capture.durationMs,sha256:capture.audioSha256,audioAttachmentId:capture.audioAttachmentId});}
 assert.deepEqual(errors,[]);report.passed=true;
} catch(error){if(page){await page.screenshot({path:join(outputs,'failure.png')});console.error('UI:',await page.locator('body').innerText());}throw error;
} finally {clearInterval(worker);await browser?.close();await server?.close();await new Promise<void>(done=>{if(!api)return done();api.close(()=>done());api.closeAllConnections();});while(workerBusy)await new Promise(done=>setTimeout(done,20));closeXopcDatabase();if(fixture)await rm(fixture,{recursive:true,force:true});await writeFile(join(outputs,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,outputs,checks:checks.length}));}
