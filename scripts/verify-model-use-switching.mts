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

const directory = await mkdtemp(join(tmpdir(), 'xopc-model-use-browser-'));
const root = resolve(import.meta.dirname, '..');
const require = createRequire(join(root, 'web/package.json'));
const { default: react } = await import(require.resolve('@vitejs/plugin-react'));
const providers = ['qwen-token-plan-cn', 'xopc-cloud', 'xiaomi-token-plan-cn'];
let config = ConfigSchema.parse({});
let defaults = AgentDefaultsSchema.parse({ models: { chat: { primary: 'xopc-cloud/auto', fallbacks: [] } } });
const snapshot = (provider: string): SetupSnapshot => ({
  configured: true, configuredProviders: new Set(providers), defaults, profile: getProviderSetupProfile(provider),
  models: [{ ref: `${provider}/fast`, name: `${provider} Fast`, vision: true, recommended: true }, { ref: `${provider}/reasoning`, name: `${provider} Reasoning`, reasoning: true }],
  images: provider === 'qwen-token-plan-cn' ? [{ ref: `${provider}/qwen-image-3.0-pro`, name: 'Qwen Image 3.0 Pro' }] : [],
  voice: readSetupVoiceState(provider, config),
});
const files = [join(root, 'web/.model-use-verify.html'), join(root, 'web/.model-use-verify.tsx')];
let server: Awaited<ReturnType<typeof createServer>> | undefined;
let browser: Awaited<ReturnType<typeof playwright.chromium.launch>> | undefined;
const writes: Array<{ provider: string; selected: string[] }> = [];
let conflict = false;
try {
  const data = { loading: false, cards: providers.map(id => ({ id, configured: true })), builtinRows: providers.map(id => ({ id, setupProfile: getProviderSetupProfile(id) })), allModels: [], customConfig: null };
  await writeFile(files[0], '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/.model-use-verify.tsx"></script></body></html>');
  await writeFile(files[1], `import React from 'react';import{createRoot}from'react-dom/client';import{ModelUsesList}from'@/features/settings/models-hub/model-uses-list';import'@/styles/globals.css';createRoot(document.getElementById('root')!).render(<main className="mx-auto w-full min-w-0 max-w-5xl overflow-y-auto p-4"><ModelUsesList data={${JSON.stringify(data)} as any} zh onChange={()=>{}}/></main>);`);
  server = await createServer({ root: join(root, 'web'), configFile: false, plugins: [react(), tailwindcss()], resolve: { alias: { '@': join(root, 'web/src') } }, define: { __XOPC_WEB_VERSION__: '"test"', __XOPC_WEB_COMMIT__: '"test"', __XOPC_WEB_BUILD_TIME__: '"test"' }, cacheDir: join(directory, 'vite-cache'), server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/*'] } } });
  await server.listen();
  try { browser = await playwright.chromium.launch({ headless: true }); } catch { browser = await playwright.chromium.launch({ headless: true, channel: 'chrome' }); }
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 }, reducedMotion: 'reduce' });
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
        if (conflict) { await route.fulfill({ status: 409, json: { error: { message: '配置已变化，请重试' } } }); return; }
        const result = applyProviderSetup(snapshot(match[1]), request, request.revision);
        defaults = result.defaults; config = applySetupVoice(config, result.voiceAssignments);
        writes.push({ provider: match[1], selected: request.selected });
      }
      body = { payload: previewProviderSetup(snapshot(match[1]), match[2] === 'preview' ? request : {}) };
    } else if (path === '/api/config') body = { payload: { config: { ...config, stt: config.tools.media?.audio, tts: config.messages?.tts } } };
    else if (path === '/api/global-defaults') body = { payload: { defaults, builtinTools: [] } };
    else if (path === '/api/voice/providers' || path === '/api/voice/stt-providers') body = { payload: { providers: [] } };
    else if (path === '/api/image-generation/catalog') body = { payload: { providers: [] } };
    else if (path === '/api/models') body = { payload: { models: [] } };
    await route.fulfill({ json: body });
  });
  const url = `${server.resolvedUrls!.local[0]}.model-use-verify.html`;
  await page.goto(url);
  await page.getByText('能力总览', { exact: true }).waitFor().catch(async error => {
    console.log(JSON.stringify({ errors, body: await page.locator('body').innerText() }));
    throw error;
  });
  const choose = async (use: string, search: string, name: string) => {
    const trigger = page.getByRole('button', { name: `选择 ${use}`, exact: true });
    await trigger.focus(); await page.keyboard.press('Enter');
    await page.getByRole('searchbox').fill(search);
    await page.getByRole('button', { name, exact: true }).click();
    await page.getByRole('status').filter({ hasText: '已切换' }).waitFor();
    assert.ok((await trigger.textContent())?.includes(name));
  };
  await choose('对话与任务', 'qwen-token-plan-cn', 'qwen-token-plan-cn Fast');
  assert.equal(defaults.models.chat.primary, 'qwen-token-plan-cn/fast');
  await choose('对话与任务', 'xiaomi-token-plan-cn', 'xiaomi-token-plan-cn Fast');
  assert.equal(defaults.models.chat.primary, 'xiaomi-token-plan-cn/fast');
  await choose('看图', 'qwen-token-plan-cn', 'qwen-token-plan-cn Fast');
  assert.equal(defaults.models.imageUnderstanding?.primary, 'qwen-token-plan-cn/fast');
  await choose('生成图片', 'Qwen Image', 'Qwen Image 3.0 Pro');
  assert.equal(defaults.models.imageGeneration?.primary, 'qwen-token-plan-cn/qwen-image-3.0-pro');
  await page.getByRole('button', { name: '选择 自动与后台任务', exact: true }).click();
  assert.ok(!(await page.getByRole('dialog').textContent())?.includes('qwen-token-plan-cn'));
  assert.ok(!(await page.getByRole('dialog').textContent())?.includes('xiaomi-token-plan-cn'));
  await page.getByRole('searchbox').fill('xopc-cloud');
  await page.getByRole('button', { name: 'xopc-cloud Fast', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已切换' }).waitFor();
  assert.equal(defaults.models.background?.primary, 'xopc-cloud/fast');
  await choose('录音转文字', 'Qwen Audio', 'Qwen Audio 3.0 ASR Flash');
  assert.equal(config.tools.media.audio.provider, 'qwen-token-plan-cn');
  await choose('文字转语音', 'Qwen Audio', 'Qwen Audio 3.0 TTS Plus');
  await choose('实时语音对话', 'Qwen Audio', 'Qwen Audio 3.0 Realtime Plus');
  assert.ok(writes.every(write => write.selected.length === 1));
  await page.screenshot({ path: join(directory, 'desktop.png') });
  conflict = true;
  await page.getByRole('button', { name: '选择 对话与任务', exact: true }).click();
  await page.getByRole('searchbox').fill('qwen-token-plan-cn');
  await page.getByRole('button', { name: 'qwen-token-plan-cn Fast', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '配置已变化' }).waitFor();
  assert.equal(defaults.models.chat.primary, 'xiaomi-token-plan-cn/fast');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  for (const control of await page.getByRole('button', { name: /^选择 / }).all()) {
    const box = await control.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 390, 'Model control must fit the mobile viewport');
  }
  await page.screenshot({ path: join(directory, 'mobile.png'), fullPage: true });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.screenshot({ path: join(directory, 'dark.png'), fullPage: true });
  assert.deepEqual(errors, []);
  const report = { passed: true, writes, conflictKeepsSelection: true, keyboardOpen: true, mobileOverflow: false, realCredentialsUsed: false, directory };
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser?.close(); await server?.close(); await Promise.all(files.map(file => rm(file, { force: true })));
}
