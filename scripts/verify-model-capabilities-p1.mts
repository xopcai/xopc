import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import playwright from 'playwright-core';

import { AgentDefaultsSchema } from '../src/agent-config/index.js';
import { ConfigSchema } from '../src/config/schema.js';
import { applyProviderSetup, previewProviderSetup, type SetupSnapshot } from '../src/providers/setup/engine.js';
import { getProviderSetupProfile } from '../src/providers/setup/profiles.js';
import { applySetupVoice, readSetupVoiceState } from '../src/providers/setup/voice.js';

const directory = await mkdtemp(join(tmpdir(), 'xopc-capabilities-p1-'));
const root = resolve(import.meta.dirname, '..');
const require = createRequire(join(root, 'web/package.json'));
const { default: react } = await import(require.resolve('@vitejs/plugin-react'));
const providers = ['qwen-token-plan-cn', 'xopc-cloud', 'xiaomi-token-plan-cn'];
let config = ConfigSchema.parse({});
let defaults = AgentDefaultsSchema.parse({ models: { chat: { primary: 'xopc-cloud/auto', fallbacks: [] } } });
const snapshot = (provider: string): SetupSnapshot => ({
  configured: provider !== 'qwen-token-plan-cn' || connected, configuredProviders: new Set(providers), defaults, profile: getProviderSetupProfile(provider),
  models: [{ ref: `${provider}/fast`, name: `${provider} Fast`, vision: true, recommended: true }, { ref: `${provider}/reasoning`, name: `${provider} Reasoning`, reasoning: true }],
  images: provider === 'qwen-token-plan-cn' ? [{ ref: `${provider}/qwen-image-3.0-pro`, name: 'Qwen Image 3.0 Pro' }] : [],
  voice: readSetupVoiceState(provider, config),
});
const files = [join(root, 'web/.capabilities-p1-verify.html'), join(root, 'web/.capabilities-p1-verify.tsx')];
let server: Awaited<ReturnType<typeof createServer>> | undefined;
let browser: Awaited<ReturnType<typeof playwright.chromium.launch>> | undefined;
const writes: Array<{ provider: string; selected: string[] }> = [];
let connected = false;
let visionNeedsRepair = false;
let holdApply = false;
let releaseApply: (() => void) | undefined;
const configWrites: unknown[] = [];
try {
  await writeFile(files[0], '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/.capabilities-p1-verify.tsx"></script></body></html>');
  await writeFile(files[1], `import React from 'react';import{createRoot}from'react-dom/client';import{HashRouter,Routes,Route}from'react-router-dom';import{CapabilitiesSettingsPanel}from'@/features/settings/models-hub/capabilities-settings-panel';import{CapabilitySettingsSheet}from'@/features/settings/models-hub/capability-settings-sheet';import{useGatewayStore}from'@/stores/gateway-store';import{useLocaleStore}from'@/stores/locale-store';import'@/styles/globals.css';useGatewayStore.setState({conversationId:'p1-fixture'});useLocaleStore.setState({language:'zh'});createRoot(document.getElementById('root')!).render(<HashRouter><Routes><Route path="/settings/capabilities/:capability" element={<CapabilitiesSettingsPanel/>}/></Routes><CapabilitySettingsSheet/></HashRouter>);`);
  server = await createServer({ root: join(root, 'web'), configFile: false, plugins: [react(), tailwindcss()], resolve: { alias: { '@': join(root, 'web/src') } }, define: { __XOPC_WEB_VERSION__: '"test"', __XOPC_WEB_COMMIT__: '"test"', __XOPC_WEB_BUILD_TIME__: '"test"' }, cacheDir: join(directory, 'vite-cache'), server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/*'] } } });
  await server.listen();
  try { browser = await playwright.chromium.launch({ headless: true }); } catch { browser = await playwright.chromium.launch({ headless: true, channel: 'chrome' }); }
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(12_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/\/api\//, async route => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith('/api/')) { await route.continue(); return; }
    const match = /^\/api\/models\/setup\/([^/]+)(?:\/(preview|apply))?$/.exec(path);
    let body: unknown = { ok: true, payload: {} };
    if (match) {
      const request = route.request().method() === 'POST' ? route.request().postDataJSON() : {};
      if (match[2] === 'apply') {
        if (holdApply) await new Promise<void>(resolve => { releaseApply = resolve; });
        const result = applyProviderSetup(snapshot(match[1]), request, request.revision);
        defaults = result.defaults; config = applySetupVoice(config, result.voiceAssignments);
        if (request.selected?.includes('vision')) visionNeedsRepair = false;
        writes.push({ provider: match[1], selected: request.selected });
      }
      body = { payload: previewProviderSetup(snapshot(match[1]), match[2] === 'preview' ? request : {}) };
    } else if (path === '/api/config' && route.request().method() === 'PATCH') { configWrites.push(route.request().postDataJSON()); connected = true; body = { ok:true }; }
    else if (path === '/api/providers/meta') body = { payload: { providers: providers.filter(id => id !== 'xopc-cloud').map(id => ({id, name:id, category:'common', supportsOAuth:false,supportsApiKey:true,configured:id !== 'qwen-token-plan-cn' || connected,setupProfile:getProviderSetupProfile(id)})) } };
    else if (path === '/api/models/catalog') body = {ok:true,payload:{sources:{},references:[],sync:{refreshing:false}}};
    else if (path === '/api/capabilities/readiness') body = { ok: true, payload: { capabilities: { vision: visionNeedsRepair ? { status: 'unavailable', selectionSource: 'explicit-config', rejected: [{ provider: 'xopc-cloud', model: 'removed' }] } : { status: 'ready', selectionSource: 'explicit-config', primary: { provider: 'qwen-token-plan-cn', model: 'fast' } } } } };
    else if (path === '/api/models-json') body = { payload: { config: {providers:{}} } };
    else if (path === '/api/voice/models') body = { payload: { models:{stt:{},tts:{},ttsVoices:{}} } };
    else if (path === '/api/image-generation/default') body = {payload:{model:null}};
    else if (path === '/api/image-generation/custom-providers') body = {payload:{providers:[]}};
    else if (path === '/api/config') body = { payload: { config: { ...config, stt: config.tools.media?.audio, tts: config.messages?.tts } } };
    else if (path === '/api/global-defaults') body = { payload: { defaults, builtinTools: [] } };
    else if (path === '/api/voice/providers' || path === '/api/voice/stt-providers') body = { payload: { providers: ['qwen-token-plan-cn','xopc-cloud'].map(id => ({id, fields:[], diagnostics:{requiresApiKey:false}})) } };
    else if (path === '/api/image-generation/catalog') body = { payload: { providers: [] } };
    else if (path === '/api/models') body = { payload: { models: [] } };
    await route.fulfill({ json: body });
  });
  const url = `${server.resolvedUrls!.local[0]}.capabilities-p1-verify.html`;
  await page.goto(`${url}#/settings/capabilities/models`);
  await page.getByRole('heading', { name:'能力总览',exact:true }).waitFor();
  assert.equal(await page.locator('[data-capability]:visible').count(),7);
  assert.equal(await page.getByRole('link',{name:/^配置 /}).count(),0);
  const before = structuredClone(defaults);
  const origin = page.url();
  const asr = page.locator('[data-capability="transcription"]');
  await asr.getByRole('button',{name:'连接 录音与听写',exact:true}).click();
  const modal = page.getByRole('dialog').first();
  await modal.getByRole('button').filter({hasText:/阿里云百炼订阅/}).click();
  await page.getByLabel('订阅 API Key').fill('fixture-not-a-real-key');
  assert.equal(await page.getByRole('dialog').count(),1);
  await modal.getByRole('button',{name:'连接并使用',exact:true}).click();
  await modal.getByRole('heading',{name:'阿里云百炼订阅 · 北京',exact:true}).waitFor({state:'hidden'});
  assert.equal(page.url(),origin);
  assert.deepEqual(defaults,before);
  assert.deepEqual(writes,[{provider:'qwen-token-plan-cn',selected:['transcription']}]);
  assert.equal(configWrites.length,1);
  await modal.getByRole('button',{name:'完成',exact:true}).click();
  await page.locator('[data-capability=vision]').getByRole('button',{name:'设置',exact:true}).click();
  holdApply = true;
  await modal.getByRole('button',{name:'选择 看图',exact:true}).click();
  await page.getByRole('searchbox').fill('qwen-token-plan-cn Fast');
  await page.getByRole('button',{name:'qwen-token-plan-cn Fast',exact:true}).click();
  await page.waitForFunction(() => document.querySelector('fieldset[disabled]') !== null);
  assert.ok(await modal.getByRole('button',{name:'完成',exact:true}).isDisabled());
  for(let attempt=0;!releaseApply&&attempt<100;attempt++) await new Promise(resolve=>setTimeout(resolve,10));
  holdApply=false;assert.ok(releaseApply);releaseApply();
  await page.getByRole('status').filter({hasText:'已切换'}).waitFor();
  assert.deepEqual(defaults.models.background,before.models.background);
  assert.deepEqual(defaults.models.chat,before.models.chat);
  assert.equal(page.url(),origin);
  await modal.getByRole('button',{name:'完成',exact:true}).click();
  await page.screenshot({path:join(directory,'overview-desktop.png'),fullPage:true});
  const backgroundPicker = page.getByRole('button',{name:'选择 自动与后台任务',exact:true});
  if (await backgroundPicker.count()) {
    await backgroundPicker.click();
    assert.ok(!(await page.getByRole('dialog').innerText()).includes('qwen-token-plan-cn'));
    assert.ok(!(await page.getByRole('dialog').innerText()).includes('xiaomi-token-plan-cn'));
    await page.keyboard.press('Escape');
  } else assert.ok(await page.getByRole('button',{name:'连接 自动与后台任务',exact:true}).isVisible());
  await page.goto(`${url}#/settings/capabilities/voice?voiceTab=service&use=transcription`);
  await page.waitForURL('**/voice?voiceTab=service&use=transcription');
  await page.getByRole('link',{name:'返回录音与听写',exact:true}).click();
  await page.waitForURL('**use=transcription');
  await page.getByRole('link',{name:'返回能力总览',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:join(directory,'overview-mobile.png'),fullPage:true});
  await page.evaluate(()=>document.documentElement.classList.add('dark'));
  await page.screenshot({path:join(directory,'overview-dark.png'),fullPage:true});
  await page.goto(`${url}#/settings/capabilities/models?view=services&use=transcription&from=voice&returnTo=%2Fchat%2Flegacy-recording`);
  await page.getByRole('heading', { name: '接入服务 · 录音与听写', exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: '返回对话', exact: true }).getAttribute('href'), '#/chat/legacy-recording');
  await page.getByRole('link', { name: '返回录音与听写', exact: true }).click();
  const legacyReturn = new URL(page.url().split('#')[1], 'https://fixture.local');
  assert.equal(legacyReturn.searchParams.get('use'), 'transcription');
  assert.equal(legacyReturn.searchParams.get('from'), 'voice');
  assert.equal(legacyReturn.searchParams.get('returnTo'), '/chat/legacy-recording');
  assert.equal(legacyReturn.searchParams.get('view'), null);
  await page.goto(`${url}#/settings/capabilities/models?view=services`);
  await page.getByRole('heading', { name: '连接的服务', exact: true }).waitFor();
  const serviceOrigin = page.url();
  const serviceWriteCount = writes.length;
  const backgroundBeforeService = structuredClone(defaults.models.background);
  const serviceLabels = ['对话与任务', '看图', '生成图片', '录音与听写', '文字转语音', '实时语音对话', '自动与后台任务'];
  for (const label of serviceLabels) {
    const entry = page.getByRole('button', { name: label, exact: true });
    await entry.scrollIntoViewIfNeeded();
    const scrollState = await entry.evaluateHandle(element => {
      const positions: Array<{ element: HTMLElement; top: number }> = [];
      for (let parent = element.parentElement; parent; parent = parent.parentElement) positions.push({ element: parent, top: parent.scrollTop });
      return positions;
    });
    await entry.click();
    await modal.getByRole('heading', { name: label, exact: true }).first().waitFor();
    assert.equal(page.url(), serviceOrigin);
    assert.equal(await modal.getByRole('tab', { name: '管理服务', exact: true }).getAttribute('aria-selected'), 'true');
    if (label === '录音与听写') {
      await modal.getByRole('button', { name: /阿里云百炼订阅 · 北京/ }).click();
      await modal.getByRole('button', { name: '更换', exact: true }).click();
      const keyDraft = modal.locator('#provider-setup-key');
      await keyDraft.fill('fixture-unsaved-service-key');
      await modal.getByRole('button', { name: '完成', exact: true }).click();
      await page.waitForFunction(label => document.activeElement?.textContent?.trim() === label, label);
      await entry.click();
      assert.equal(await keyDraft.inputValue(), 'fixture-unsaved-service-key');
      await modal.getByRole('button', { name: '保留原 Key', exact: true }).click();
      assert.equal(page.url(), serviceOrigin);
    }
    if (label === '对话与任务') {
      await modal.getByRole('button', { name: /阿里云百炼订阅 · 北京/ }).click();
      await modal.getByRole('button', { name: '使用此模型', exact: true }).click();
      await modal.getByRole('heading', { name: '阿里云百炼订阅 · 北京', exact: true }).waitFor({ state: 'hidden' });
      assert.equal(await modal.getByRole('tab', { name: '模型与参数', exact: true }).getAttribute('aria-selected'), 'true');
      assert.equal(defaults.models.chat.primary, 'qwen-token-plan-cn/fast');
      assert.deepEqual(defaults.models.background, backgroundBeforeService);
    }
    await modal.getByRole('tab', { name: '模型与参数', exact: true }).click();
    assert.equal(page.url(), serviceOrigin);
    await modal.getByRole('button', { name: '完成', exact: true }).click();
    await page.waitForFunction(label => document.activeElement?.textContent?.trim() === label, label);
    assert.equal(page.url(), serviceOrigin);
    assert.ok(await scrollState.evaluate(positions => positions.every(({ element, top }) => Math.abs(element.scrollTop - top) <= 1)), 'Service page scroll must survive closing settings');
    await scrollState.dispose();
  }
  assert.equal(configWrites.length, 1, 'Reusing a service must not rewrite its credentials');
  assert.equal(writes.length, serviceWriteCount + 1, 'Only the explicit chat application may write models');
  assert.deepEqual(writes.at(-1), { provider: 'qwen-token-plan-cn', selected: ['chat'] });
  await page.screenshot({path:join(directory,'service-accounts-mobile.png'),fullPage:true});
  visionNeedsRepair = true;
  await page.reload();
  const repair = page.getByRole('button', { name: '图片理解：去接入模型', exact: true });
  await repair.waitFor();
  await repair.click();
  await modal.getByRole('heading', { name: '看图', exact: true }).waitFor();
  assert.equal(page.url(), serviceOrigin);
  await modal.getByRole('button', { name: /阿里云百炼订阅 · 北京/ }).click();
  await modal.getByRole('button', { name: '使用此模型', exact: true }).click();
  await modal.getByRole('heading', { name: '阿里云百炼订阅 · 北京', exact: true }).waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('button[aria-label="配置 图片理解"]') !== null);
  const configuredVision = page.locator('button[aria-label="配置 图片理解"]');
  assert.ok(await configuredVision.evaluate(element => element.closest('details')!.open), 'Status refresh must not collapse the invoking capability list');
  await modal.getByRole('button', { name: '完成', exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '配置 图片理解');
  assert.ok(await configuredVision.isVisible());
  assert.equal(page.url(), serviceOrigin);
  assert.equal(writes.length, serviceWriteCount + 2);
  assert.deepEqual(writes.at(-1), { provider: 'qwen-token-plan-cn', selected: ['vision'] });
  assert.deepEqual(defaults.models.background, backgroundBeforeService);

  await page.goto(`${url}#/settings/capabilities/image`);
  await page.waitForURL('**use=image');
  await page.getByRole('heading',{name:'生成图片',exact:true}).waitFor();
  assert.equal(configWrites.length,1,'Opening legacy image settings must not write configuration');
  assert.deepEqual(errors,[]);
  const report={passed:true,connectionAppliesOnlyCurrentCapability:true,samePageSettings:true,serviceAccountsStayInPlace:true,serviceAccountApplyInPlace:true,optionalRepairPreservesExpansionAndFocus:true,serviceDraftPreserved:true,legacyServiceReturnContextPreserved:true,explicitSingleUseSwitch:true,switchLocksVoiceParameters:true,advancedVoiceReturnsToOriginalCapability:true,backgroundPlansExcluded:true,mobileOverflow:false,legacyImageUrlPreserved:true,realCredentialsUsed:false,directory};
  await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  await page?.screenshot({ path: join(directory, 'failure.png'), fullPage: true }).catch(() => {});
  console.error(error); throw error;
} finally {
  await browser?.close(); await server?.close(); await Promise.all(files.map(file => rm(file, { force: true })));
}
