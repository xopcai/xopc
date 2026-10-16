import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp,writeFile,rm,mkdir } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { chromium } from 'playwright-core';
const root=resolve('web');const require=createRequire(join(root,'package.json'));
const {createServer}=await import(require.resolve('vite'));
const {default:react}=await import(require.resolve('@vitejs/plugin-react'));
const {default:tailwind}=await import(require.resolve('@tailwindcss/vite'));
const fixture=await mkdtemp(join(root,'.notes-product-'));const outputs='/tmp/xopc-notes-product';await mkdir(outputs,{recursive:true});
const segments=[{sequence:0,status:'confirmed',startedAtMs:0,endedAtMs:4000,displayText:'先把离线录音和恢复做好，原音安全保存之后，用户才可以放心整理和回顾。'},{sequence:1,status:'confirmed',startedAtMs:4000,endedAtMs:8000,displayText:'下周先交付 Web 的恢复入口，失败后沿用同一条笔记重试，不重复创建。'}];
const audioFixture=Buffer.alloc(44+128000);audioFixture.write('RIFF',0);audioFixture.writeUInt32LE(audioFixture.length-8,4);audioFixture.write('WAVEfmt ',8);audioFixture.writeUInt32LE(16,16);audioFixture.writeUInt16LE(1,20);audioFixture.writeUInt16LE(1,22);audioFixture.writeUInt32LE(8000,24);audioFixture.writeUInt32LE(16000,28);audioFixture.writeUInt16LE(2,32);audioFixture.writeUInt16LE(16,34);audioFixture.write('data',36);audioFixture.writeUInt32LE(128000,40);
let processing=false;
const detail=()=>({note:{id:'note',title:'产品讨论：让每次录音都值得回顾',createdAt:1,updatedAt:1,kind:'voice',status:'inbox',attachments:[]},discussion:{id:'capture',noteId:'note',clientRequestId:'preview',status:processing?'sealing':'completed',audioAttachmentId:'audio',durationMs:8000,canonicalTranscript:segments.map(s=>s.displayText).join('\n'),transcriptRevision:1,updatedAt:1},transcript:{discussionId:'capture',revision:1,text:segments.map(s=>s.displayText).join('\n'),segments,stats:{confirmed:2,failed:0}},...(processing?{processing:{attemptCount:1,maxAttempts:3,nextAttemptAt:Date.now()+10000,completedChunks:1}}:{organization:{revision:1,transcriptRevision:1,status:'completed',organization:{summary:'让用户放心录下完整内容，结束后快速找到原话，并把重要信息变成后续行动。优先保证原音安全保存和异常恢复，再完善原文与结论的联动。',keyPoints:['录音过程中持续保存原音，离线时也可以继续。','恢复录音沿用同一条笔记，重试不创建重复内容。'],decisions:[],actionItems:[],risks:[],openQuestions:[],chapters:[]}}})});
const review=()=>({version:'v1',query:'',offset:0,total:0,hasMore:false,hits:[],chapters:[{id:'chapter',kind:'chapter',title:'录音可靠性与恢复',text:'讨论离线保存、异常中断和重启恢复。',startedAtMs:0,endedAtMs:8000,segments:[],playback:[],highlightCount:2,actionCount:1,provisional:processing,stale:false}],coverage:{durationMs:8000,audioAvailable:true,processedMs:processing?4000:8000,continuousThroughMs:processing?4000:8000,analysisRanges:processing?[]:[{startedAtMs:0,endedAtMs:8000}],complete:!processing}});
let server,browser,page;
const errors=[];const mutations=[];
try{
 await writeFile(join(fixture,'index.html'),'<html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./main.tsx"></script></html>');
 await writeFile(join(fixture,'main.tsx'),`
import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import'/src/styles/globals.css';import{DiscussionNoteSections}from'/src/features/discussions/discussion-note-sections';import{useGatewayStore}from'/src/stores/gateway-store';import{useLocaleStore}from'/src/stores/locale-store';
useGatewayStore.setState({conversationId:'preview'});useLocaleStore.setState({language:'zh'});createRoot(document.getElementById('root')).render(<MemoryRouter><main className="h-dvh bg-surface-base p-3 sm:p-7"><div className="mx-auto flex h-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-surface-panel"><DiscussionNoteSections noteId="note" onPersonalNotes={()=>document.body.dataset.personal='open'}/></div></main></MemoryRouter>);
`);
 server=await createServer({root,configFile:false,resolve:{alias:{'@':join(root,'src')}},cacheDir:join(fixture,'vite-cache'),server:{host:'127.0.0.1',port:0,hmr:false},plugins:[react(),tailwind()]});await server.listen();browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 page=await browser.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));page.on('console',msg=>{if(msg.type()==='error')console.error(msg.text());});page.on('requestfailed',request=>{if(request.failure()?.errorText!=='net::ERR_ABORTED')console.error('Request failed:',request.url(),request.failure());});
 await page.route(url=>url.pathname.startsWith('/api/'),async route=>{const path=new URL(route.request().url()).pathname;if(route.request().method()==='POST')mutations.push({path,body:route.request().postDataJSON()});if(path.endsWith('/audio'))return route.fulfill({status:200,contentType:'audio/wav',body:audioFixture});const value=path.includes('/by-note/')?detail():path.endsWith('/review')?review():path.endsWith('/actions')||path.endsWith('/annotations')?[]:detail();return route.fulfill({json:value});});
 for(const width of [1280,768,390,320])for(const partial of [false,true]){
  processing=partial;await page.setViewportSize({width,height:900});await page.goto(server.resolvedUrls.local[0]+fixture.split('/').at(-1)+'/index.html');await page.getByRole('heading',{name:'产品讨论：让每次录音都值得回顾'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'重新整理纪要',exact:true}).count(),0);assert.equal(await page.getByRole('link',{name:'MD',exact:true}).count(),0);assert.equal(await page.getByRole('textbox',{name:'搜索此 Note',exact:true}).count(),0);
  await page.waitForFunction(()=>document.querySelector('audio')?.readyState>=1);
  await page.screenshot({path:join(outputs,width+(partial?'-processing':'-ready')+'.png')});
  assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth>window.innerWidth),false);
  const player=page.locator('audio');const identity=await player.evaluate(el=>{el.dataset.identity='retained';return true;});assert.ok(identity);
  await page.getByRole('button',{name:'原文',exact:true}).click();assert.equal(await player.getAttribute('data-identity'),'retained');await page.getByText(segments[0].displayText,{exact:true}).waitFor();
  await page.getByRole('button',{name:'概览',exact:true}).click();await page.getByRole('button',{name:'搜索此 Note',exact:true}).click();await page.getByRole('textbox',{name:'搜索此 Note',exact:true}).waitFor();await page.getByRole('button',{name:'关闭搜索',exact:true}).click();
  const more=page.getByRole('button',{name:'更多笔记操作',exact:true});await more.click();await page.getByRole('link',{name:'MD',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'重新整理纪要',exact:true}).isEnabled(),!partial);await page.keyboard.press('Escape');assert.equal(await more.getAttribute('aria-expanded'),'false');await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='更多笔记操作');
  const outcome=page.locator('[data-recording-outcome] details');assert.equal(await outcome.getAttribute('open'),null);await outcome.locator('summary').click();assert.match(await outcome.innerText(),/可以离开当前页面/);await outcome.locator('summary').click();
 }
 // Check the same controls in dark mode, reduced motion and a short landscape viewport.
 await page.emulateMedia({reducedMotion:'reduce'});
 for(const viewport of [{width:390,height:844},{width:844,height:390}]){
  await page.setViewportSize(viewport);await page.evaluate(()=>document.documentElement.classList.add('dark'));
  assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth>window.innerWidth),false);
  const more=page.getByRole('button',{name:'更多笔记操作',exact:true});await more.click();
  const tools=page.getByRole('dialog',{name:'笔记工具'});await tools.waitFor();await page.waitForFunction(()=>{const element=document.querySelector('[role=dialog][aria-label="笔记工具"]');if(!element)return false;const box=element.getBoundingClientRect();return box.y>=0&&box.y+box.height<=window.innerHeight+1;});const box=await tools.boundingBox();assert.ok(box.y>=0&&box.y+box.height<=viewport.height+1);
  await page.keyboard.press('Escape');await page.screenshot({path:join(outputs,viewport.width+'-dark.png')});
 }
 processing=false;await page.setViewportSize({width:390,height:844});await page.reload();
 await page.getByRole('button',{name:'更多笔记操作',exact:true}).click();
 await page.getByRole('button',{name:'纪要模板',exact:true}).click();
 await page.getByRole('button',{name:'项目例会',exact:true}).click();
 await page.getByRole('button',{name:'重新整理纪要',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('button[aria-label="更多笔记操作"]')?.getAttribute('aria-expanded')==='false');
 assert.ok(mutations.some(request=>request.path.endsWith('/organize')&&request.body.template==='project'));
 // Error states keep their recovery action visible even when details are collapsed.
 processing=false;await page.route('**/api/discussions/by-note/note',route=>route.fulfill({json:{...detail(),discussion:{...detail().discussion,status:'needs_attention',failureStage:'organization'}}}));await page.reload();await page.getByRole('button',{name:'重试生成笔记',exact:true}).waitFor();
 assert.equal(await page.locator('[data-recording-outcome] details').getAttribute('open'),null);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,viewports:[1280,768,390,320],states:['ready','processing','failed'],darkMode:true,reducedMotion:true,landscape:true,screenshots:outputs}));
}catch(error){if(page){console.error('Browser errors:',errors);console.error('Page:',await page.locator('body').innerText());await page.screenshot({path:join(outputs,'failure.png')});}throw error;}finally{await browser?.close();await server?.close();await rm(fixture,{recursive:true,force:true});}
