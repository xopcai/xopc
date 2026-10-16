import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initializeTestAgentCatalog } from '../../../../agent-catalog/test-support.js';
import { closeXopcDatabase } from '../../../../storage/sqlite/index.js';
import { getModelCatalogStore, resetModelCatalogStore } from '../../../../providers/model-catalog-store.js';
import { resetModelRegistry } from '../../../../providers/model-registry.js';
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
    const stale = await request(provider, '/apply', { mode: 'replace', selected: ['chat'], revision: payload.revision });
    expect(stale.status).toBe(409);
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
  it('rejects invalid input and does not silently configure an unsupported background use', async () => {
    const preview = await (await request('qwen-token-plan-cn')).json() as { payload: ModelSetupPreview };
    expect((await request('qwen-token-plan-cn', '/apply', { selected: ['background'], revision: preview.payload.revision })).status).toBe(400);
    expect((await request('qwen-token-plan-cn', '/preview', { overrides: { vision: 'other/model' } })).status).toBe(400);
  });
});
