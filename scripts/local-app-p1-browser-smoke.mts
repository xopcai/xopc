/** Disposable real Gateway, SDK, browser and CLI connector acceptance. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, symlinkSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright-core') as typeof import('playwright-core');
const directory = mkdtempSync(join(tmpdir(), 'xopc-p1-browser-')), workspace = join(directory, 'workspace'); mkdirSync(workspace);
const listener = createServer(); await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = (listener.address() as { port: number }).port; await new Promise<void>(resolve => listener.close(() => resolve()));
const origin = `http://127.0.0.1:${port}`, token = 'disposable-p1-fixture', configPath = join(directory, 'xopc.json');
const root = process.cwd(), effects = join(directory, 'effects.jsonl'), bootstrap = join(directory, 'bootstrap.mts');
const writeStarted = join(directory, 'write-started'), writeRelease = join(directory, 'write-release');
const runtime = { type: 'cli', adapterId: 'p1-fixture', adapterVersion: '1', binaryVersion: '1.0.0' };
writeFileSync(configPath, JSON.stringify({ gateway: { bind: 'loopback', port, auth: { mode: 'token', token } }, browser: { enabled: false }, connectors: { instances: { 'p1-fixture': { runtime, xopcConnector: { managed: true, connectorId: 'p1-fixture', enabled: true, definition: { id: 'p1-fixture', version: '1.0.0', displayName: 'P1 acceptance connector', description: 'Disposable test process', category: 'custom', kind: 'cli', source: 'custom', capabilities: ['tools'], auth: { mode: 'cli' }, setup: {}, runtime } } } } } }));
writeFileSync(bootstrap, `
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { registerCliAdapter } from ${JSON.stringify(join(root,'src/connectors/cli/adapterRegistry.ts'))};
const adapter = { id: 'p1-fixture', version: '1', binaryVersion: '1.0.0', executable: 'node', distributions: {}, configEnvironment: 'P1_FIXTURE_CONFIG', curatedActions: { 'records.read': 'read', 'records.create': 'write' },
 schemaArgs: id => ['-e','console.log("{}")'],
 decodeSchema: id => ({id,description:id,scope:id==='records.read'?'read':'write',requiredScopes:[],revision:'1',inputSchema:{type:'object',additionalProperties:false,properties:{title:{type:'string'}},required:['title']}}),
 actionArgs: (action,input) => ['-e', ${JSON.stringify(`if(process.argv[1]==='records.create'){ const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(writeStarted)},'started');while(!fs.existsSync(${JSON.stringify(writeRelease)}))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20); } require('node:fs').appendFileSync(${JSON.stringify(effects)}, JSON.stringify({ action: process.argv[1], input: JSON.parse(process.argv[2]) })+String.fromCharCode(10)); console.log(JSON.stringify({ outcome:'success', data: JSON.parse(process.argv[2]) }));`)}, action.id, JSON.stringify(input)],
 decodeResult: output => { if(output.exitCode!==0) throw new Error(output.stderr); return JSON.parse(output.stdout); }, statusArgs:['-e','console.log("verified")'],
 decodeIdentity: output => {if(output.stdout.trim()!=='verified')throw new Error('Identity mismatch');return {key:'p1-owner',label:'P1 fixture account',scopes:[],identity:{kind:'user'}};},authorizationSteps:[]};
registerCliAdapter(adapter);
if(process.env.XOPC_P1_SEED==='1') {
 const { openXopcDatabase, closeXopcDatabase } = await import(${JSON.stringify(join(root,'src/storage/sqlite/index.ts'))}); openXopcDatabase();
 const { upsertConnectorInstallation } = await import(${JSON.stringify(join(root,'src/storage/sqlite/connector-repository.ts'))});
 upsertConnectorInstallation({id:'p1-fixture-local-owner',connectorId:'p1-fixture',principalId:'local-owner',enabled:true,allowedAgentIds:[],maxScope:'write',confirmationPolicy:'writes',selectedAccountIds:null});
 const { createCliAuthorization, updateCliAuthorization, commitCliIdentity } = await import(${JSON.stringify(join(root,'src/connectors/cli/store.ts'))});
 const attempt=createCliAuthorization('p1-fixture','p1-fixture');updateCliAuthorization(attempt.id,{phase:'verifying'});commitCliIdentity(attempt,adapter.decodeIdentity({stdout:'verified'}));
 const { cliExecutablePath }=await import(${JSON.stringify(join(root,'src/connectors/cli/installer.ts'))});const path=cliExecutablePath(adapter);mkdirSync(dirname(path),{recursive:true});copyFileSync(process.execPath,path);writeFileSync(path+'.sha256',createHash('sha256').update(readFileSync(path)).digest('hex'));closeXopcDatabase();
}
`);
const env = { PATH: process.env.PATH, XOPC_STATE_DIR: directory, XOPC_WORKSPACE: workspace, XOPC_CONFIG_PATH: configPath, XOPC_CONFIG: configPath,
 XOPC_UI_STATIC_ROOT: process.env.XOPC_SMOKE_UI_ROOT, XOPC_SKIP_CHANNELS:'1',XOPC_NO_RESPAWN:'1',XOPC_LOG_LEVEL:'fatal' };
let output = '', child: ReturnType<typeof spawn> | undefined, browser: Awaited<ReturnType<typeof chromium.launch>> | undefined, page: import('playwright-core').Page | undefined;
async function request(path: string, method = 'GET', body?: unknown) { const res = await fetch(origin+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});assert.ok(res.ok,`${path}: ${res.status} ${await res.clone().text()}`);return res.json(); }
try {
 await new Promise<void>((resolve,reject)=>{const seed=spawn(process.execPath,['--import','tsx',bootstrap],{env:{...env,XOPC_P1_SEED:'1'}});seed.stderr.on('data',d=>output+=d);seed.on('exit',code=>code===0?resolve():reject(new Error(output)));});
 child=spawn(process.execPath,['--import','tsx','--import',bootstrap,'src/cli/bin.ts','gateway','--port',String(port),'--bind','loopback','--no-hot-reload'],{env,stdio:['ignore','pipe','pipe']});child.stdout!.on('data',d=>output=(output+d).slice(-12000));child.stderr!.on('data',d=>output=(output+d).slice(-12000));
 let ready=false;for(let i=0;i<300;i++){try{ready=(await(await fetch(origin+'/api/health')).json()).ready===true;}catch{}if(ready||child.exitCode!==null)break;await new Promise(r=>setTimeout(r,150));}assert.ok(ready,output);
 const operations=(await request('/api/capabilities/operations')).capabilities;
 async function operate(id:string,input:unknown){const c=operations.find((c:any)=>c.id===id);return(await request(`/api/capabilities/operations/${id}/invocations`,'POST',{majorVersion:c.majorVersion,descriptorDigest:c.descriptorDigest,input,idempotencyKey:crypto.randomUUID()})).data;}
 const {app}=await request('/api/local-apps','POST',{name:'P1 acceptance fixture',idea:'Temporary resource boundary verification'});
 writeFileSync(join(app.workspaceRoot,'approved.txt'),'APPROVED FILE');
 writeFileSync(join(app.workspaceRoot,'private.txt'),'PRIVATE UNSELECTED FILE');
 await operate('xopc.projects.create_milestone',{projectId:app.projectId,title:'Browser live milestone'});
 const beforeProgress=(await operate('xopc.projects.get',{id:app.projectId})).project;
 await operate('xopc.projects.create_update',{projectId:app.projectId,expectedVersion:beforeProgress.version,summary:'Browser live progress',health:'on_track'});
 await operate('xopc.projects.create',{name:'Unapproved browser project'});
 const fileContext=await request(`/api/files/contexts/project/${app.projectId}`);
 const space=fileContext.space ?? fileContext;
 const children=await request(`/api/files/spaces/${space.id}/children`);
 const file=(children.items??children.entries??children.resources).find((v:any)=>v.name==='approved.txt'); assert.ok(file,JSON.stringify(children));
 const connectorOptions=(await request(`/api/extensions/${app.extensionId}/resource-options?kind=connectors`)).items;
 assert.equal(connectorOptions.length,2,JSON.stringify(connectorOptions));
 const read=connectorOptions.find((v:any)=>v.binding.scope==='read'), write=connectorOptions.find((v:any)=>v.binding.scope==='write');
 const catalog=(await request('/api/local-app-capabilities/catalog')).capabilities;
 const ids=['xopc.projects.get','xopc.projects.list','xopc.projects.list_milestones','xopc.projects.list_updates','xopc.projects.update','xopc.projects.create_update','xopc.tasks.create','xopc.tasks.update','xopc.tasks.list','xopc.files.read','xopc.files.propose_export','xopc.connectors.describe','xopc.connectors.read','xopc.connectors.propose_write','xopc.apps.get_request'];
 const manifestPath=join(app.workspaceRoot,'xopc.extension.json'),manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
 manifest.ui.capabilities=catalog.filter((v:any)=>ids.includes(v.id)).map(({id,majorVersion,descriptorDigest}:any)=>({id,majorVersion,descriptorDigest}));writeFileSync(manifestPath,JSON.stringify(manifest));
 writeFileSync(join(app.workspaceRoot,'ui','index.html'),'<!doctype html><html><head><meta charset="utf-8"><title>P1 acceptance</title></head><body><h1>P1 acceptance fixture</h1><button id="preview">Read project preview</button><button id="project">Project and task</button><button id="file">Read file</button><button id="import">Import attachment</button><button id="export">Export file</button><button id="read">Connector read</button><button id="write">Propose write</button><button id="again">Review same write</button><output></output><script type="module" src="./app.js"></script></body></html>');
 const source=`import {createExtensionClient} from ${JSON.stringify(join(root,'packages/extension-ui-sdk/src/index.ts'))};const client=createExtensionClient();await client.whenReady();
 const invoke=async(id,input,key)=>{const c=await client.capability.describe(id);return(await client.capability.call(id,{majorVersion:c.majorVersion,descriptorDigest:c.descriptorDigest,input,idempotencyKey:key??crypto.randomUUID()})).data;};
 const out=document.querySelector('output');let requestId;
 const run=(id,fn)=>document.querySelector('#'+id).onclick=async()=>{out.textContent='Working';try{out.textContent=JSON.stringify(await fn());}catch(e){out.textContent='Error: '+e.message;}};
 run('preview',async()=>{const list=await invoke('xopc.projects.list',{});if(list.items.length!==1||list.items[0].id!==${JSON.stringify(app.projectId)})throw new Error('Project scope mismatch');const milestone=await invoke('xopc.projects.list_milestones',{id:list.items[0].id});const progress=await invoke('xopc.projects.list_updates',{id:list.items[0].id});return {milestone:milestone.items[0].title,progress:progress.items[0].summary};});
 run('project',async()=>{const p=await invoke('xopc.projects.get',{id:${JSON.stringify(app.projectId)}});await invoke('xopc.projects.update',{id:p.project.id,expectedVersion:p.project.version,patch:{description:'Browser approved update'}});const t=await invoke('xopc.tasks.create',{title:'Browser captured task',activation:{mode:'capture',phase:'backlog'},contract:{objective:'Review',expectedOutputs:[],acceptanceCriteria:[],constraints:[],approvalRequired:[],assumptions:[],risks:[],outputDestinations:[]}});if(!t.ok)throw new Error(JSON.stringify(t));const task=t.model.task;await invoke('xopc.tasks.update',{taskId:task.id,expectedVersion:task.version,title:'Browser edited task'});return {status:'project-task-complete'};});
 run('file',()=>invoke('xopc.files.read',{id:${JSON.stringify(file.id)}}));
 run('import',()=>client.files.pickAttachment());
 run('export',async()=>{const r=await invoke('xopc.files.propose_export',{name:'reviewed.txt',content:'BROWSER EXPORT'});await client.requests.review(r.id);return {status:'export-review-open'};});
 run('read',()=>invoke('xopc.connectors.read',{toolRef:${JSON.stringify(read.binding.toolRef)},accountId:${JSON.stringify(read.binding.accountId)},arguments:{title:'Browser read'}}));
 run('write',async()=>{const r=await invoke('xopc.connectors.propose_write',{toolRef:${JSON.stringify(write.binding.toolRef)},accountId:${JSON.stringify(write.binding.accountId)},arguments:{title:'Browser approved write'}},'browser-write');requestId=r.id;await client.requests.review(r.id);return {status:'write-review-open',id:r.id};});
 run('again',async()=>{await client.requests.review(requestId);return{status:'repeat-review-open'};});`;
 await build({stdin:{contents:source,resolveDir:root,sourcefile:'p1-fixture.ts',loader:'ts'},bundle:true,format:'esm',platform:'browser',outfile:join(app.workspaceRoot,'ui','app.js'),logLevel:'silent'});
 browser=await chromium.launch({executablePath:process.env.XOPC_SMOKE_BROWSER??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});const context=await browser.newContext({acceptDownloads:true});assert.ok((await context.request.post(origin+'/api/browser-session',{headers:{Authorization:`Bearer ${token}`,Origin:origin}})).ok());
 page=await context.newPage();page.setDefaultTimeout(30000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);await page.getByRole('button',{name:/^(Maybe later, keep using my current model|暂时不用，继续使用现有模型)$/}).click({timeout:6000}).catch(()=>{});if(await page.locator('.xopc-onboarding-dialog').isVisible())await page.keyboard.press('Escape');
 await page.addLocatorHandler(page.getByRole('button',{name:/^(Maybe later, keep using my current model|暂时不用，继续使用现有模型)$/}),async b=>b.click());await page.addLocatorHandler(page.locator('.xopc-onboarding-dialog'),async()=>{await page!.keyboard.press('Escape');});
 await page.goto(`${origin}/#/local-apps/${app.id}`);
 await page.getByRole('button',{name:'Preview data',exact:true}).click();
 await page.getByRole('button',{name:'Real data · read only',exact:true}).click();
 const previewReview=page.getByRole('dialog',{name:'Choose data for this read-only preview'});
 const projectRead=previewReview.getByRole('group',{name:'Projects this app may read',exact:true});
 await projectRead.getByRole('button',{name:'Projects this app may read',exact:true}).click();
 await page.getByRole('button',{name:'Selected records or projects',exact:true}).click();
 await projectRead.getByRole('checkbox',{name:app.name,exact:true}).check();
 await previewReview.getByRole('button',{name:'Start read-only preview',exact:true}).click();
 const liveFrame=page.frameLocator('iframe[title$=" preview"]');
 await liveFrame.getByRole('button',{name:'Read project preview',exact:true}).click();
 await liveFrame.locator('output').filter({hasText:'Browser live milestone'}).waitFor();
 assert.ok((await liveFrame.locator('output').innerText()).includes('Browser live progress'));
 await liveFrame.getByRole('button',{name:'Project and task',exact:true}).click();
 await liveFrame.locator('output').filter({hasText:/^Error:/}).waitFor();
 await page.getByRole('button',{name:'Stop live preview',exact:true}).click();
 console.log('PASS: real project read-only preview uses selected scope, reads milestones/progress and blocks writes.');
 await page.getByRole('button',{name:/^(Add to sidebar|添加到左侧导航)$/}).click();await Promise.all([page.waitForResponse(r=>r.url().endsWith(`/api/local-apps/${app.id}/install`)&&r.ok()),page.getByRole('dialog').getByRole('button',{name:/^(Install|确认安装)$/}).click()]);
 await page.evaluate(()=>{location.hash='#/local-apps';});await page.waitForFunction(()=>document.querySelectorAll('iframe').length===0);await page.evaluate(id=>{location.hash='#/extensions/'+id;},app.extensionId);
 const dialog=page.getByRole('dialog');
 for(const label of ['Projects this app may read','Projects this app may update']){const group=dialog.getByRole('group',{name:label,exact:true});await group.getByRole('button',{name:label,exact:true}).click();await page.getByRole('button',{name:'Selected records or projects',exact:true}).click();await group.getByRole('checkbox',{name:app.name,exact:true}).check();}
 const taskWrite=dialog.getByRole('group',{name:'Tasks this app may capture or edit',exact:true});await taskWrite.getByRole('button',{name:'Tasks this app may capture or edit',exact:true}).click();await page.getByRole('button',{name:'Selected records or projects',exact:true}).click();await taskWrite.getByRole('checkbox',{name:/created by this app/}).check();
 await dialog.getByRole('checkbox',{name:/Allow reading these selected workspace files/}).check();await dialog.getByRole('checkbox',{name:'approved.txt · approved.txt',exact:true}).check();await dialog.getByRole('checkbox',{name:/Allow choosing a local attachment/}).check();await dialog.getByRole('checkbox',{name:/Allow export requests/}).check();
 for(const opt of connectorOptions)await dialog.getByRole('checkbox',{name:opt.title,exact:true}).check();
 await dialog.getByRole('button',{name:'Allow',exact:true}).click();const frame=page.frameLocator('iframe').first();
 const click=async(name:string,expect:string|RegExp)=>{await frame.getByRole('button',{name,exact:true}).click();await frame.locator('output').filter({hasText:new RegExp('^Error:|'+(typeof expect==='string'?expect:expect.source))}).waitFor();const text=await frame.locator('output').innerText();assert.ok(!text.startsWith('Error:'),text);return text;};
 await click('Project and task','project-task-complete');assert.equal((await operate('xopc.projects.get',{id:app.projectId})).project.description,'Browser approved update');console.log('PASS: actual scoped project update and captured task edit through SDK/Gateway.');
 const fileResult=await click('Read file','APPROVED FILE');assert.ok(!fileResult.includes(app.workspaceRoot));
 unlinkSync(join(app.workspaceRoot,'approved.txt'));symlinkSync(join(app.workspaceRoot,'private.txt'),join(app.workspaceRoot,'approved.txt'));
 await frame.getByRole('button',{name:'Read file',exact:true}).click();await frame.locator('output').filter({hasText:/^Error:/}).waitFor();
 assert.ok(!(await frame.locator('output').innerText()).includes('PRIVATE UNSELECTED FILE'));
 unlinkSync(join(app.workspaceRoot,'approved.txt'));writeFileSync(join(app.workspaceRoot,'approved.txt'),'APPROVED FILE');
 console.log('PASS: real file access rejects a selected file replaced by a symlink.');
 await frame.getByRole('button',{name:'Import attachment',exact:true}).click();const attachment=page.getByRole('dialog',{name:'Choose an attachment for this app'});await attachment.getByLabel('Choose attachment',{exact:true}).setInputFiles({name:'chosen.txt',mimeType:'text/plain',buffer:Buffer.from('CHOSEN ATTACHMENT')});await frame.locator('output').filter({hasText:Buffer.from('CHOSEN ATTACHMENT').toString('base64')}).waitFor();
 await click('Export file','export-review-open');const review=()=>page!.getByRole('dialog',{name:'Review app resource request'});const downloadPromise=page.waitForEvent('download');await review().getByRole('button',{name:'Approve and save file'}).click();const download=await downloadPromise;assert.equal(download.suggestedFilename(),'reviewed.txt');assert.equal(readFileSync((await download.path())!,'utf8'),'BROWSER EXPORT');assert.equal(existsSync(join(app.workspaceRoot,'reviewed.txt')),false);console.log('PASS: selected file read, explicit attachment import and host-reviewed browser export.');
 const readResult=await click('Connector read',/outcome|review_required|Browser read/);assert.ok(readResult.includes('Browser read'),readResult);const lines=()=>existsSync(effects)?readFileSync(effects,'utf8').trim().split('\n').map(s=>JSON.parse(s)):[];assert.equal(lines().length,1);
 await click('Propose write','write-review-open');await review().getByText('Browser approved write',{exact:false}).waitFor();assert.equal(lines().length,1,'No write before host approval');const staged=await review().locator('pre').last().innerText();assert.ok(staged.includes('Browser approved write'));
 const requestId=JSON.parse(await frame.locator('output').innerText()).id;
 const record=(await request(`/api/extensions/${app.extensionId}/resource-requests/${requestId}`)).request;
 await review().getByRole('button',{name:'Approve execution'}).click();
 for(let i=0;i<200&&!existsSync(writeStarted);i++)await new Promise(r=>setTimeout(r,25));assert.ok(existsSync(writeStarted),'CLI write must be in flight');
 const other=await browser.newContext();assert.ok((await other.request.post(origin+'/api/browser-session',{headers:{Authorization:`Bearer ${token}`,Origin:origin}})).ok());
 const reviewPath=origin+`/api/extensions/${app.extensionId}/resource-requests/${requestId}/review`;
 const rejected=await other.request.post(reviewPath,{data:{digest:record.digest,approve:false},headers:{Origin:origin}});
 assert.equal(rejected.status(),409);assert.equal((await rejected.json()).code,'REVISION_CONFLICT');
 const concurrent=await other.request.post(reviewPath,{data:{digest:record.digest,approve:true},headers:{Origin:origin}});
 assert.equal(concurrent.status(),409);assert.equal((await concurrent.json()).code,'IN_PROGRESS');
 assert.equal(lines().filter(v=>v.action==='records.create').length,0);
 writeFileSync(writeRelease,'release');await review().waitFor({state:'hidden'});
 const repeated=await other.request.post(reviewPath,{data:{digest:record.digest,approve:true},headers:{Origin:origin}});assert.ok(repeated.ok());assert.equal((await repeated.json()).status,'approved');await other.close();
 assert.equal(lines().filter(v=>v.action==='records.create').length,1);
 console.log('PASS: concurrent cross-browser approval is idempotent and an accepted decision cannot be replaced by rejection.');
 await click('Review same write','repeat-review-open');await review().getByRole('button',{name:'Approve execution'}).click();await review().waitFor({state:'hidden'});assert.equal(lines().filter(v=>v.action==='records.create').length,1);console.log('PASS: real CLI connector read, per-request write review and repeat-safe execution.');
 const grant=(await request(`/api/extensions/${app.extensionId}/ui-grant`)).grant;await request(`/api/extensions/${app.extensionId}/ui-grant`,'DELETE',{manifestDigest:grant.manifestDigest});await frame.getByRole('button',{name:'Connector read',exact:true}).click();await frame.locator('output').filter({hasText:/^Error:/}).waitFor();assert.equal(lines().length,2);console.log('PASS: revoked permissions stop later connector calls.');
 assert.deepEqual(errors,[]);console.log('PASS: P1 real Gateway + browser acceptance completed.');
} catch(error){if(page){console.error((await page.locator('body').innerText()).slice(-12000));await page.screenshot({path:'/tmp/xopc-p1-failure.png'}).catch(()=>{});}console.error(output);throw error;}
finally{await browser?.close();child?.kill('SIGTERM');if(child)await Promise.race([new Promise(r=>child!.once('exit',r)),new Promise(r=>setTimeout(r,5000))]);if(process.env.XOPC_SMOKE_KEEP==='1')console.log(directory);else rmSync(directory,{recursive:true,force:true});}
