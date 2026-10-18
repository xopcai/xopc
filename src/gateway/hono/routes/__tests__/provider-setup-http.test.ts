import { voiceFixture } from '../../../../voice/__tests__/voice-fixture.js';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initializeTestAgentCatalog } from '../../../../agent-catalog/test-support.js';
import { closeXopcDatabase } from '../../../../storage/sqlite/index.js';
import { getModelCatalogStore, resetModelCatalogStore } from '../../../../providers/model-catalog-store.js';
import { resetModelRegistry } from '../../../../providers/model-registry.js';
import { reloadImageGenerationProviders } from '../../../../agent/image/generation/provider-registry.js';
import { ConfigSchema, type Config } from '../../../../config/schema.js';
import { listGlobalDefaults, updateGlobalDefaults } from '../../../global-defaults-admin.js';
import { auth } from '../../middleware/auth.js';
import { gatewayScopes } from '../../middleware/scopes.js';
import { registerAuthenticatedLazyRouteFallback, resetLazyRouteBundlesForTests } from '../lazy-fallback.js';
import type { AuthenticatedRouteDeps } from '../deps.js';
import type { ModelSetupPreview } from '@xopcai/gateway-contract';

describe('model setup authenticated Gateway HTTP', () => {
  let server: ReturnType<typeof serve>;
  let origin: string;
  let service: { currentConfig: Config; saveConfig: ReturnType<typeof vi.fn>; getModelCatalogSync: () => object; refreshAgentCatalog: ReturnType<typeof vi.fn> };
  const request = (provider: string, action = '', body?: unknown, authenticated = true) => fetch(`${origin}/api/models/setup/${provider}${action}`, {
    method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(authenticated ? { authorization: 'Bearer setup-test' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  beforeEach(async () => {
    initializeTestAgentCatalog(); resetLazyRouteBundlesForTests(); resetModelCatalogStore(); resetModelRegistry();
    vi.stubEnv('QWEN_TOKEN_PLAN_CN_API_KEY', 'sk-sp-fixture');
    vi.stubEnv('XIAOMI_TOKEN_PLAN_CN_API_KEY', 'fixture');
    vi.stubEnv('XOPC_CLOUD_API_KEY', 'fixture');
    getModelCatalogStore().replaceSourceModels('xopc-cloud', { providerId: 'xopc-cloud', baseUrl: 'https://router.test/v1', api: 'openai-completions', etag: null, recommendedModel: 'auto', lastSuccessAt: Date.now() },
      ['auto', 'advanced'].map(id => ({ id, name: id, kind: 'language' as const, input: ['text', 'image'], output: ['text'], operations: ['chat.completions'], reasoning: true, contextWindow: 128000, maxOutputTokens: 8192 })));
    service = { currentConfig: ConfigSchema.parse({}), getModelCatalogSync: () => ({}), refreshAgentCatalog: vi.fn(), saveConfig: vi.fn(async (next: Config) => { service.currentConfig = next; return { saved: true }; }) };
    const app = new Hono();
    app.use(auth({ getResolvedAuth: () => ({ mode: 'token', token: 'setup-test', allowTailscale: false }) }));
    app.use(gatewayScopes());
    registerAuthenticatedLazyRouteFallback(app, {
      service,
      strictRateLimitMiddleware: async (_c, next) => next(),
    } as unknown as AuthenticatedRouteDeps);
    await new Promise<void>(resolve => { server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, () => resolve()); });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    reloadImageGenerationProviders({ providers: {} });
    closeXopcDatabase(); resetLazyRouteBundlesForTests(); resetModelRegistry(); resetModelCatalogStore(); vi.unstubAllEnvs();
  });
  it.each(['qwen-token-plan-cn', 'xopc-cloud', 'xiaomi-token-plan-cn'])('previews and applies %s through lazy loading and authentication', async provider => {
    expect((await request(provider, '', undefined, false)).status).toBe(401);
    const response = await request(provider, '/preview', { mode: 'replace' });
    expect(response.status).toBe(200);
    const { payload } = await response.json() as { payload: ModelSetupPreview };
    expect(payload.configured).toBe(true);
    expect(payload.uses.find(use => use.id === 'chat')?.recommended).toMatch(new RegExp(`^${provider}/`));
    const result = await request(provider, '/apply', { mode: 'replace', selected: ['chat'], revision: payload.revision });
    expect(await result.json()).toMatchObject({ ok: true });
    expect(listGlobalDefaults().defaults.models.chat.primary).toMatch(new RegExp(`^${provider}/`));
    expect(listGlobalDefaults().defaults.models.background).toBeUndefined();
    const stale = await request(provider, '/apply', { mode: 'replace', selected: ['chat'], revision: payload.revision });
    expect(stale.status).toBe(409);
  });
  it('repairs initialized but disabled media and configures every Cloud use while keeping desktop control off', async () => {
    const store = getModelCatalogStore();
    const source = store.getSource('xopc-cloud')!;
    const template = source.models[0]!;
    store.saveSource('xopc-cloud', { ...source, models: [
      ...source.models,
      { ...template, id: 'gui', computerUse: { profile: 'gui-plus-2026-02-26' }, priority: 1000 },
      { ...template, id: 'image', kind: 'image', output: ['image'], operations: ['images.generate'], imageGeneration: { generate: { maxCount: 1 }, edit: { enabled: false } } },
      { ...template, id: 'stt', kind: 'stt', input: ['audio'], operations: ['audio.transcription'], voice: voiceFixture(['transcription', 'transcription.stream']) },
      { ...template, id: 'tts', kind: 'tts', output: ['audio'], operations: ['audio.speech'], voice: voiceFixture(['speech', 'speech.stream']) },
      { ...template, id: 'omni', kind: 'omni', input: ['audio'], output: ['audio'], operations: ['audio.conversation'], voice: voiceFixture(['conversation']) },
    ] });
    reloadImageGenerationProviders({ providers: {} });
    resetModelRegistry();
    service.currentConfig = ConfigSchema.parse({
      tools: { media: { audio: { enabled: false, provider: 'openai' } } },
      messages: { tts: { enabled: false, provider: 'edge' } }, voice: { realtime: { enabled: false } },
    });
    const { payload } = await (await request('xopc-cloud', '/preview', { mode: 'replace' })).json() as { payload: ModelSetupPreview };
    const selected = payload.uses.filter(use => use.selected).map(use => use.id);
    expect(selected.sort()).toEqual(['background', 'chat', 'conversation', 'image', 'speech', 'transcription', 'vision']);
    expect((await request('xopc-cloud', '/apply', { mode: 'replace', selected, revision: payload.revision })).status).toBe(200);
    const config = ConfigSchema.parse(service.currentConfig);
    expect(config.tools.media?.audio).toMatchObject({ enabled: true, provider: 'xopc-cloud', models: [{ model: 'stt' }] });
    expect(config.messages?.tts).toMatchObject({ enabled: true, provider: 'xopc-cloud' });
    expect(config.voice?.realtime).toMatchObject({ enabled: true, stt: { model: 'stt' }, tts: { model: 'tts' }, omni: { model: 'omni' } });
    expect(config.computer.enabled).toBe(false);
    expect(config.browser.enabled).toBe(true);
    const models = listGlobalDefaults().defaults.models;
    expect(models.computerUse?.primary).toBe('xopc-cloud/gui');
    expect(models.chat.primary).toBe('xopc-cloud/auto');
    expect(models.imageUnderstanding?.primary).toBe('xopc-cloud/auto');
    for (const intent of ['fast', 'reasoning', 'coding', 'review', 'vision', 'understanding'] as const) expect(models.intents[intent]?.primary).toMatch(/^xopc-cloud\//);
  });
  it('supports image-only custom sources without adding chat or background choices', async () => {
    reloadImageGenerationProviders({ providers: { 'local-image-fixture': {
      baseUrl: 'http://127.0.0.1:8080/v1', imageGeneration: { api: 'openai-images', name: 'Local image', defaultModel: 'image-one', auth: {type:'none'},
        models: [{id:'image-one',capabilities:{generate:{maxCount:1},edit:{enabled:false}}}] },
    } } });
    const before = listGlobalDefaults().defaults;
    const response = await request('local-image-fixture');
    expect(response.status).toBe(200);
    const { payload } = await response.json() as { payload: ModelSetupPreview };
    expect(payload.configured).toBe(true);
    expect(payload.uses.find(use => use.id === 'chat')?.choices).toEqual([]);
    expect(payload.uses.find(use => use.id === 'background')?.choices).toEqual([]);
    expect((await request('local-image-fixture', '/apply', { mode:'replace',selected:['image'],revision:payload.revision })).status).toBe(200);
    expect(listGlobalDefaults().defaults.models.chat).toEqual(before.models.chat);
    expect(listGlobalDefaults().defaults.models.imageGeneration).toMatchObject({primary:'local-image-fixture/image-one',fallbacks:[],autoProviderFallback:false});
  });
  it('supports local speech without a chat provider or credential and changes only speech', async () => {
    const defaults = listGlobalDefaults().defaults;
    const previous = service.currentConfig.tools;
    const response = await request('edge', '/preview', { mode: 'replace', selected: ['speech'] });
    expect(response.status).toBe(200);
    const { payload } = await response.json() as { payload: ModelSetupPreview };
    expect(payload.configured).toBe(true);
    expect(payload.uses.find(use => use.id === 'speech')?.choices.length).toBeGreaterThan(0);
    expect(payload.uses.find(use => use.id === 'chat')?.choices).toEqual([]);
    expect((await request('edge', '/apply', { mode: 'replace', selected: ['speech'], revision: payload.revision })).status).toBe(200);
    expect(service.currentConfig.messages?.tts?.provider).toBe('edge');
    expect(service.currentConfig.tools).toEqual(previous);
    expect(listGlobalDefaults().defaults).toEqual(defaults);
  });
  it('does not treat native voice credentials as language model credentials', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    service.currentConfig = ConfigSchema.parse({ tools: { media: { audio: { provider: 'openai', providers: { openai: { apiKey: 'native-only-fixture' } } } } } });
    const { payload } = await (await request('openai')).json() as { payload: ModelSetupPreview };
    expect(payload.configured).toBe(true);
    expect(payload.uses.find(use => use.id === 'chat')?.choices).toEqual([]);
    expect(payload.uses.find(use => use.id === 'transcription')?.choices.length).toBeGreaterThan(0);
    expect((await request('openai', '/apply', { mode: 'replace', selected: ['chat'], revision: payload.revision })).status).toBe(400);
  });
  it('saves three voice uses through the same authenticated setup route without copying secrets', async () => {
    const { payload } = await (await request('qwen-token-plan-cn', '/preview', { mode:'replace' })).json() as { payload: ModelSetupPreview };
    const response = await request('qwen-token-plan-cn', '/apply', { selected:['speech','transcription','conversation'], revision:payload.revision });
    expect(await response.json()).toMatchObject({ok:true});
    expect(service.currentConfig.messages?.tts?.provider).toBe('qwen-token-plan-cn');
    expect(service.currentConfig.tools.media?.audio?.provider).toBe('qwen-token-plan-cn');
    expect(service.currentConfig.voice?.realtime.omni?.provider).toBe('qwen-token-plan-cn');
    expect(JSON.stringify(service.currentConfig)).not.toContain('sk-sp-fixture');
  });
  it('does not update model defaults if the voice configuration save fails', async () => {
    const current = listGlobalDefaults().defaults;
    service.saveConfig.mockResolvedValueOnce({saved:false,error:'disk failure'});
    const { payload } = await (await request('qwen-token-plan-cn')).json() as {payload:ModelSetupPreview};
    const response = await request('qwen-token-plan-cn', '/apply', {selected:['chat','speech'],revision:payload.revision});
    expect(response.status).toBe(500);
    expect(listGlobalDefaults().defaults).toEqual(current);
  });
  it('reports the saved voice stage and preserves concurrent model changes', async () => {
    service.saveConfig.mockImplementationOnce(async (next: Config) => {
      service.currentConfig = next;
      const defaults = listGlobalDefaults().defaults;
      updateGlobalDefaults({defaults:{...defaults,models:{...defaults.models,chat:{primary:'openai/concurrent',fallbacks:[]}}}});
      return {saved:true};
    });
    const {payload} = await (await request('qwen-token-plan-cn')).json() as {payload:ModelSetupPreview};
    const response = await request('qwen-token-plan-cn','/apply',{selected:['chat','speech'],revision:payload.revision});
    expect(response.status).toBe(409);
    expect((await response.json()).error.message).toContain('Voice settings saved');
    expect(listGlobalDefaults().defaults.models.chat.primary).toBe('openai/concurrent');
  });
  it('configures a selected subscription background model and rejects invalid overrides', async () => {
    const preview = await (await request('qwen-token-plan-cn')).json() as { payload: ModelSetupPreview };
    const background = preview.payload.uses.find(use => use.id === 'background');
    expect(background?.recommended).toMatch(/^qwen-token-plan-cn\//);
    expect((await request('qwen-token-plan-cn', '/apply', { selected: ['background'], revision: preview.payload.revision })).status).toBe(200);
    expect(listGlobalDefaults().defaults.models.background?.primary).toBe(background?.recommended);
    expect((await request('qwen-token-plan-cn', '/preview', { overrides: { vision: 'other/model' } })).status).toBe(400);
  });
});
