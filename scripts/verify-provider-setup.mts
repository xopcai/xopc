import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import playwright from 'playwright-core';
const { chromium } = playwright;
import { createServer } from 'vite';
import tailwindcss from '@tailwindcss/vite';

const root = resolve(import.meta.dirname, '..');
const directory = await mkdtemp(join(tmpdir(), 'xopc-provider-setup-'));
process.env.XOPC_STATE_DIR = directory;
const { ConfigSchema } = await import('../src/config/schema.js');
const { readSetupVoiceState, applySetupVoice } = await import('../src/providers/setup/voice.js');
const { getModelCatalogStore } = await import('../src/providers/model-catalog-store.js');
const { voiceFixture } = await import('../src/voice/__tests__/voice-fixture.js');
getModelCatalogStore().replaceSourceModels('xopc-cloud', {providerId:'xopc-cloud',baseUrl:'https://test/v1',api:'openai-completions',etag:null,recommendedModel:null,lastSuccessAt:1}, (['tts','stt','omni'] as const).map(kind => ({id:`voice-${kind}`,name:kind,kind,input:['audio'],output:['text','audio'],operations:['audio.transcriptions','audio.speech'],reasoning:false,contextWindow:0,maxOutputTokens:null,voice:voiceFixture([kind === 'tts' ? 'speech' : kind === 'stt' ? 'transcription' : 'conversation'])})));
const { AgentDefaultsSchema } = await import('../src/agent-config/index.js');
const { getModelsByProvider } = await import('../src/providers/index.js');
const { getProviderSetupProfile } = await import('../src/providers/setup/profiles.js');
const { previewProviderSetup, applyProviderSetup } = await import('../src/providers/setup/engine.js');
const require = createRequire(join(root, 'web/package.json'));
const { default: react } = await import(require.resolve('@vitejs/plugin-react'));
const providers = ['qwen-token-plan-cn', 'xopc-cloud', 'xiaomi-token-plan-cn'];
const html = join(root, 'web/.provider-setup-verify.html');
const entry = join(root, 'web/.provider-setup-verify.tsx');
const output = join(directory, 'screenshots');
const rows = providers.map(id => ({ id, name: id, category: 'domestic', configured: false, apiKey: '',
  supportsApiKey: id !== 'xopc-cloud', supportsOAuth: id === 'xopc-cloud', setupProfile: getProviderSetupProfile(id) }));
let server: Awaited<ReturnType<typeof createServer>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await mkdir(output);
  await writeFile(html, '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/.provider-setup-verify.tsx"></script></body></html>');
  await writeFile(entry, `import React from 'react';import{createRoot}from'react-dom/client';import{AddProviderDialog}from'@/features/settings/models-hub/add-provider-dialog';import{messages}from'@/i18n/messages';import{useLocaleStore}from'@/stores/locale-store';import'@/styles/globals.css';useLocaleStore.setState({language:'zh'});const id=new URLSearchParams(location.search).get('provider')!;createRoot(document.getElementById('root')!).render(<AddProviderDialog open initialProviderId={id} onOpenChange={()=>{}} onSaved={()=>{}} builtinRows={${JSON.stringify(rows)}} customConfig={null} labels={messages('zh').capabilitiesSettings.addProviderDialog} language="zh"/>);`);
  server = await createServer({ root: join(root, 'web'), configFile: false, plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': join(root, 'web/src') } },
    define: { __XOPC_WEB_VERSION__: JSON.stringify('test'), __XOPC_WEB_COMMIT__: JSON.stringify('test'), __XOPC_WEB_BUILD_TIME__: JSON.stringify('test') },
    cacheDir: join(directory, 'vite-cache'), server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/*'] } },
  });
  await server.listen();
  try { browser = await chromium.launch({ headless: true }); }
  catch { browser = await chromium.launch({ headless: true, channel: 'chrome' }); }
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 }, reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const provider of providers) {
    let configured = false;
    let voiceConfig = ConfigSchema.parse({});
    let defaults = AgentDefaultsSchema.parse({ models: { chat: { primary: 'old/chat', fallbacks: [] } } });
    let applied = 0;
    const models = provider === 'xopc-cloud'
      ? ['auto', 'advanced'].map(id => ({ ref: `${provider}/${id}`, name: id, vision: true, reasoning: true, recommended: id === 'auto' }))
      : getModelsByProvider(provider).map(model => ({ ref: `${provider}/${model.id}`, name: model.name, vision: model.input.includes('image'), reasoning: model.reasoning }));
    const snapshot = () => ({ voice: readSetupVoiceState(provider, voiceConfig), profile: getProviderSetupProfile(provider), defaults, configured,
      configuredProviders: new Set(configured ? [provider] : []), models: provider === 'xopc-cloud' && !configured ? [] : models,
      images: provider === 'qwen-token-plan-cn' ? [{ ref: `${provider}/qwen-image-3.0-pro`, name: 'Qwen Image 3.0 Pro' }] : [],
    });
    await page.unrouteAll();
    await page.route('**/api/**', async route => {
      const req = route.request(); const path = new URL(req.url()).pathname;
      if (!path.startsWith('/api/')) return route.continue();
      let payload: unknown = {};
      if (path.endsWith('/oauth-async/start')) payload = { sessionId: 'fixture' };
      else if (path.endsWith('/fixture/status')) { configured = true; payload = { status: 'completed' }; }
      else if (path.endsWith('/setup/' + provider + '/preview')) payload = previewProviderSetup(snapshot(), req.postDataJSON());
      else if (path.endsWith('/setup/' + provider + '/apply')) {
        const body = req.postDataJSON(); const result = applyProviderSetup(snapshot(), body, body.revision);
        defaults = result.defaults; voiceConfig = applySetupVoice(voiceConfig, result.voiceAssignments); payload = result.preview; applied++;
      } else if (path === '/api/config' && req.method() === 'PATCH') configured = true;
      else if (path === '/api/models') payload = { models: [] };
      await route.fulfill({ json: { ok: true, payload } });
    });
    await page.goto(`${server.resolvedUrls!.local[0]}.provider-setup-verify.html?provider=${provider}`, { waitUntil: 'networkidle' });
    if (provider === 'xopc-cloud') {
      await page.getByRole('button', { name: '授权', exact: true }).click();
      await page.getByRole('button', { name: '连接并应用', exact: true }).waitFor();
    } else await page.getByLabel('套餐 API Key', { exact: true }).fill('fixture-subscription-key');
    if (provider === providers[0]) {
      for (const [name, width, height, dark] of [['desktop-light',1280,850,false],['desktop-dark',1280,850,true],['mobile',375,812,false],['landscape',812,375,false]] as const) {
        await page.setViewportSize({ width, height });
        await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark);
        await page.screenshot({ path: join(output, `${name}.png`) });
        if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error(`${name} horizontal overflow`);
        const bounds = await page.getByRole('button', { name: '连接并应用', exact: true }).boundingBox();
        if (!bounds || bounds.y < 0 || bounds.y + bounds.height > height) throw new Error(`${name} footer not visible`);
      }
      await page.setViewportSize({ width: 1280, height: 850 });
    }
    await page.getByRole('button', { name: '连接并应用', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '所选用途配置已保存' }).waitFor();
    if (applied !== 1 || !defaults.models.chat.primary.startsWith(`${provider}/`)) throw new Error(`${provider} did not apply once`);
    if (getProviderSetupProfile(provider).interactiveOnly && defaults.models.background) throw new Error('Subscription assigned to background');
    if (provider !== 'xiaomi-token-plan-cn' && (voiceConfig.messages?.tts?.provider !== provider || voiceConfig.tools.media?.audio?.provider !== provider || voiceConfig.voice?.realtime.omni?.provider !== provider)) throw new Error(`${provider} voice setup incomplete`);
    await page.screenshot({ path: join(output, `${provider}-saved.png`) });
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ ok: true, providers, viewports: 4, screenshots: output }));
} finally {
  await browser?.close(); await server?.close(); await rm(html, { force: true }); await rm(entry, { force: true });
}

// Imported runtime registries may retain maintenance timers in this verification process.
process.exit(0);
