import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp,writeFile,rm,mkdir } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { chromium } from 'playwright-core';
const root = resolve('web');const require = createRequire(join(root,'package.json'));
const { createServer } = await import(require.resolve('vite'));
const { default: react } = await import(require.resolve('@vitejs/plugin-react'));
const { default: tailwind } = await import(require.resolve('@tailwindcss/vite'));
const fixture = await mkdtemp(join(root,'.recording-outcome-'));
const output = '/tmp/xopc-recording-outcome';await mkdir(output,{ recursive: true });
let server,browser;
try {
  await writeFile(join(fixture,'index.html'),'<html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./main.tsx"></script></html>');
  await writeFile(join(fixture,'main.tsx'),`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import '/src/styles/globals.css';import {RecordingFloatingPanel} from '/src/features/discussions/recording-floating-panel';import {RecordingOutcomeCard} from '/src/features/discussions/recording-outcome-card';
const base={localSave:'unknown',sync:'pending',serverStatus:'stopping',failureStage:'',jobState:'',retryScheduled:false,audioAvailable:false,audioDeleted:false,textAvailable:true,noteAvailable:false,analysisStale:false};
const states=[{localSave:'saving'},{localSave:'complete',sync:'offline'},{localSave:'complete',sync:'verifying'},{audioAvailable:true,serverStatus:'sealing'},{audioAvailable:true,serverStatus:'needs_attention',failureStage:'organization',noteAvailable:true},{audioAvailable:true,serverStatus:'completed',noteAvailable:true}];
function App(){const[index,setIndex]=useState(0);const[compact,setCompact]=useState(false);return <main className="min-h-screen bg-surface-base p-5 text-fg"><h1>语音笔记</h1>{states.map((_,i)=><button key={i} data-state={i} className="m-2 p-3" onClick={()=>setIndex(i)}>{i+1}</button>)}<RecordingFloatingPanel compact={compact} onCompactChange={setCompact} language="zh" title="录音已结束" subtitle="42:18"><div className="p-3"><RecordingOutcomeCard input={{...base,...states[index]}} compact={compact} zh onRetry={mode=>document.body.dataset.retry=mode}><button className="min-h-10 px-2">打开笔记</button><button className="min-h-10 px-2">稍后查看</button></RecordingOutcomeCard></div></RecordingFloatingPanel></main>};createRoot(document.getElementById('root')).render(<App/>);
`);
  server = await createServer({ root,configFile: false,resolve: { alias: { '@': join(root,'src') } },cacheDir: join(fixture,'vite-cache'),server: { host: '127.0.0.1',port: 0,hmr: false },plugins: [react(),tailwind()] });
  await server.listen();browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless: true });
  const page = await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(() => sessionStorage.clear());
  page.setDefaultTimeout(10000);
  for (const width of [1280,390,320]) {
    await page.setViewportSize({width,height:800});await page.goto(server.resolvedUrls.local[0]+fixture.split('/').at(-1)+'/index.html');
    const panel=page.locator('[data-recording-window]');await panel.waitFor();
    for (let i=0;i<6;i++) {
      await page.locator('[data-state="'+i+'"]').evaluate(button=>button.click());
      const box=await panel.boundingBox();assert.ok(box.x>=0 && box.x+box.width<=width+1 && box.y>=0 && box.y+box.height<=801);
      assert.equal(await panel.evaluate(el=>el.scrollWidth>el.clientWidth),false);
      if (i===0) assert.doesNotMatch(await panel.innerText(),/可以离开/);
      if (i===1) { assert.match(await panel.innerText(),/本机保存，可以离开/);await page.getByRole('button',{name:'重试同步',exact:true}).click();assert.equal(await page.locator('body').getAttribute('data-retry'),'sync'); }
      if (i===4) { await page.getByRole('button',{name:'重试生成笔记',exact:true}).click();assert.equal(await page.locator('body').getAttribute('data-retry'),'pipeline'); }
      if (i===1 || i===4 || i===5) await panel.screenshot({path:join(output,width+'-'+i+'.png')});
    }
    await page.getByRole('button',{name:'缩小录音窗',exact:true}).click();assert.match(await panel.innerText(),/可以离开/);
    const handle=await page.getByRole('button',{name:'移动录音窗',exact:true}).boundingBox();await page.mouse.move(handle.x+15,handle.y+15);await page.mouse.down();await page.mouse.move(30,50,{steps:8});await page.mouse.up();
    const box=await panel.boundingBox();assert.ok(box.x>=0 && box.x+box.width<=width+1);
    await panel.screenshot({path:join(output,width+'-compact.png')});
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({viewports:[1280,390,320],states:6,passed:true,screenshots:output}));
} finally {await browser?.close();await server?.close();await rm(fixture,{recursive:true,force:true});}
