import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { startLabModel } from './fixtures/store-plugin-lab/model-server.mts';
import { AgentDefaultsSchema } from '../src/agent-config/schema.js';
import { ConfigSchema } from '../src/config/schema.js';
import { openXopcDatabase, closeXopcDatabase } from '../src/storage/sqlite/connection.js';
import { seedTestAgentCatalog } from '../src/agent-catalog/test-support.js';
import { AgentPluginStore } from '../src/extensions/agent-plugins/store.js';
import { prepareNativeMcpConfig } from '../src/agent/mcp/native-mcp.js';
import { pluginServerId } from '../src/extensions/agent-plugins/validation.js';
import { invokePreparedTool } from './lib/plugin-lab-runtime.mts';
const root = await mkdtemp(join(tmpdir(), 'xopc-plugin-app-'));
const evidence = resolve(process.env.XOPC_PLUGIN_APP_EVIDENCE || '/tmp/xopc-production-plugin-browser'); await mkdir(evidence, { recursive: true });
const listener = createServer().listen(0, '127.0.0.1'); await once(listener, 'listening');
const addr = listener.address(); assert(addr && typeof addr !== 'string'); const port = addr.port; await new Promise<void>(r => listener.close(() => r()));
const token = randomUUID(), base = `http://127.0.0.1:${port}`;
Object.assign(process.env, { XOPC_STATE_DIR: root, XOPC_CONFIG_PATH: join(root, 'xopc.json'), XOPC_WORKSPACE: root, PI_CODING_AGENT_DIR: join(root, 'pi'), XOPC_LOG_LEVEL: 'warn', XOPC_LOG_CONSOLE: 'false' });
const modelFixture = await startLabModel();
const config = ConfigSchema.parse({ gateway: { port, auth: { mode: 'token', token } } });
await writeFile(process.env.XOPC_CONFIG_PATH!, JSON.stringify(config));
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { 'plugin-lab': { baseUrl: modelFixture.baseUrl, api: 'openai-completions', apiKey: 'synthetic-not-a-real-key', models: [{ id: 'lab', name: 'Plugin Lab controlled model', input: ['text'], reasoning: false, contextWindow: 128000, maxTokens: 2048 }] } } }));
const modelRoute = { primary: 'plugin-lab/lab', fallbacks: [] };
openXopcDatabase(); seedTestAgentCatalog({ defaults: AgentDefaultsSchema.parse({ models: { chat: modelRoute, background: modelRoute, intents: Object.fromEntries(['fast', 'reasoning', 'coding', 'review', 'vision', 'understanding'].map(key => [key, modelRoute])) }, runtime: { maxTurns: 8, timeoutMs: 90000 } }), agents: [{ id: 'main', enabled: true, workspace: root, profile: { name: 'Main' } }, { id: 'other', enabled: true, workspace: root, profile: { name: 'Other' } }] }); closeXopcDatabase();
let logs = '';
const child = spawn(process.execPath, ['dist/src/cli/bin.js', 'gateway', '--port', String(port), '--no-hot-reload'], { cwd: resolve('.'), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', c => { logs += c; }); child.stderr.on('data', c => { logs += c; });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 300; i++) {
    if (child.exitCode !== null) throw new Error(`Gateway exited: ${child.exitCode}: ${logs.slice(-3000)}`);
    try { if ((await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch { /* Startup is still in progress. */ }
    await new Promise(r => setTimeout(r, 200));
  }
  assert(ready, logs.slice(-3000));
  const { chromium } = createRequire(import.meta.url)('playwright-core') as typeof import('playwright-core');
  browser = await chromium.launch({ headless: true, channel: process.env.XOPC_PLUGIN_SMOKE_BROWSER_CHANNEL || 'chrome' });
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1365, height: 1000 } });
  await context.addInitScript(({ origin, token }) => { if (location.origin === origin) { localStorage.setItem('xopc.token', token); localStorage.setItem('xopc.language', 'en'); } }, { origin: base, token });
  const page = await context.newPage(), pageErrors: string[] = [], submittedInputs: string[] = [];
  page.on('request', request => { if (request.method() === 'POST' && /\/inputs$/.test(new URL(request.url()).pathname)) submittedInputs.push(request.url()); });
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto(`${base}/#/capabilities/extensions?q=yuque`);
  page.setDefaultTimeout(120000);
  await page.getByText('Maybe later, keep using my current model', {exact:true}).click();
  await page.getByText('Skip for now', {exact:true}).click();
  await page.waitForURL(/chat/);
  const outcomes=[];
  for(const [name,title] of [['yuque','Yuque'],['feishu','Feishu'],['dingtalk','DingTalk'],['gmail','Gmail'],['openboost','OpenBoost']]){
    await page.goto(`${base}/#/capabilities/extensions?q=${name}`);
    await page.getByText(title,{exact:true}).click();
    await page.getByRole('button',{name:'Install',exact:true}).click();
    await page.getByRole('button',{name:'Authorize and install',exact:true}).click();
    await page.getByRole('button',{name:'Skip for now',exact:true}).click();
    await page.waitForURL(/capabilities\/extensions\/[^?]+/);
    await page.getByText('Plugin installed. Some features still need authorization.',{exact:true}).waitFor();
    const detail=page.url();
    await page.reload();
    await page.getByText('Authorization required',{exact:true}).first().waitFor();
    await page.getByRole('button',{name:'Connect account',exact:true}).click();
    if(name==='yuque'){
      const token=page.getByLabel('Access Token',{exact:false});await token.waitFor();assert.equal(await token.getAttribute('type'),'password');
    }else if(name==='feishu'){
      await page.getByRole('tab',{name:'手动填写',exact:true}).click();await page.getByLabel('App ID',{exact:false}).waitFor();await page.getByLabel('App Secret',{exact:false}).waitFor();
      await page.getByRole('tab',{name:'扫码连接',exact:true}).click();await page.getByRole('button',{name:'Connect account',exact:true}).click();
      await page.getByRole('img',{name:'Scan to authorize 飞书',exact:true}).waitFor();await page.screenshot({path:join(evidence,'feishu-official-qr.png')});
    }else if(name==='dingtalk'){
      await page.getByRole('button',{name:'Connect account',exact:true}).click();await page.getByRole('link',{name:'Open sign-in page',exact:true}).waitFor();
    }else if(name==='gmail'){
      await page.getByLabel('Google Desktop Client ID',{exact:false}).waitFor();await page.getByLabel('Google Desktop Client Secret',{exact:false}).waitFor();
    }else{
      await page.getByRole('button',{name:'Connect account',exact:true}).waitFor();
    }
    await page.screenshot({path:join(evidence,`${name}-account.png`)});
    await page.getByRole('button',{name:'Skip for now',exact:true}).click();
    await page.getByText('Plugin installed. Some features still need authorization.',{exact:true}).waitFor();assert.equal(page.url(),detail);
    await page.goto(`${base}/#/capabilities/extensions?q=${name}`);await page.getByText('Authorization required',{exact:true}).first().waitFor();
    outcomes.push({name,installedFromStore:true,skipAndDetails:true,authorizationUi:true,realChallenge:['feishu','dingtalk'].includes(name)});console.log(JSON.stringify(outcomes.at(-1)));
  }
  await page.setViewportSize({width:375,height:812});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(evidence,'mobile-store.png')});
  assert.deepEqual(pageErrors,[]);assert.deepEqual(submittedInputs,[]);
  await writeFile(join(evidence,'result.json'),JSON.stringify({ok:true,outcomes,productionAuthorization:'pending-user',mobile:true,noUnrequestedChatInput:true},null,2));console.log(JSON.stringify({ok:true,evidence}));
} catch (error) {
  if (browser) { let index = 0; for (const context of browser.contexts()) for (const page of context.pages()) { try { await page.screenshot({ path: join(evidence, `failure-${index}.png`) }); await writeFile(join(evidence, `failure-${index++}.html`), await page.content()); } catch {} } }
  await writeFile(join(evidence, 'gateway-model.json'), JSON.stringify(modelFixture.observed, null, 2));
  try { await writeFile(join(evidence, 'native-mcp.log'), await readFile(join(root, 'pi/mcp.log'))); } catch { /* Optional native diagnostic file. */ }
  throw error;
} finally {
  await writeFile(join(evidence, 'gateway.log'), logs.replaceAll(token, '[test-token]'));
  await browser?.close();
  child.kill('SIGTERM'); await Promise.race([once(child, 'exit'), new Promise(r => setTimeout(r, 5000))]); if (child.exitCode === null) child.kill('SIGKILL');
  await modelFixture.close();
  await rm(root, { recursive: true, force: true });
}
process.exit(0);
