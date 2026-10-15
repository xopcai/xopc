import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { initializeTestAgentCatalog } from '../../agent-catalog/test-support.js';
import type { GatewayService } from '../service.js';
import { voiceManifestSchema } from '@xopcai/realtime-protocol/voice';
import { xopcCloudOAuthProvider } from '../../auth/oauth/xopc-cloud.js';
import { getModelCatalogStore } from '../../providers/model-catalog-store.js';
import { createOAuthHandler } from './oauth.js';
import { ConfigSchema } from '../../config/schema.js';
import { CredentialResolver } from '../../auth/credentials.js';
import { openaiOAuthProvider } from '../../auth/oauth/openai.js';
import { closeXopcDatabase } from '../../storage/sqlite/index.js';
import {
  buildDesktopOAuthReturnUrl,
  buildOAuthCompletionReadiness,
  createOAuthAsyncHandler,
  normalizeDesktopOAuthReturnPath,
  refreshModelCatalogAfterOAuth,
  resolveOAuthLoginMethodPreference,
} from './oauth-async.js';

beforeAll(() => initializeTestAgentCatalog());
afterAll(() => closeXopcDatabase());

describe('OpenAI OAuth manual callback', () => {
  afterEach(() => vi.restoreAllMocks());

  const service = () => ({ currentConfig: ConfigSchema.parse({}) }) as GatewayService;

  it('waits for the submitted callback instead of passing an empty code', async () => {
    const save = vi.spyOn(CredentialResolver.prototype, 'saveOAuthCredentials').mockResolvedValue();
    const received = vi.fn();
    vi.spyOn(openaiOAuthProvider, 'login').mockImplementation(async callbacks => {
      callbacks.onAuth({ url: 'https://auth.openai.com/example' });
      const code = await callbacks.onPrompt({ message: 'Paste callback URL', signal: callbacks.signal });
      received(code);
      return { access: 'access', refresh: 'refresh', expires: Date.now() + 3600_000, clientId: 'issued-client' };
    });
    const handler = createOAuthAsyncHandler(service());
    const started = await handler.request('/start', { method: 'POST', body: JSON.stringify({ provider: 'openai' }) });
    const { payload: { sessionId } } = await started.json() as { payload: { sessionId: string } };
    const status = async () => {
      const { payload } = await (await handler.request(`/${sessionId}/status`)).json() as { payload: { status: string } };
      return payload.status;
    };
    await vi.waitFor(async () => expect(await status()).toBe('waiting_code'));
    expect(received).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    const callback = 'http://127.0.0.1:1455/auth/callback?code=issued-code&client_id=issued-client';
    expect((await handler.request(`/${sessionId}/code`, { method: 'POST', body: JSON.stringify({ code: callback }) })).status).toBe(200);
    await vi.waitFor(async () => expect(await status()).toBe('completed'));
    expect(received).toHaveBeenCalledWith(callback);
    expect(save).toHaveBeenCalledWith('openai', expect.objectContaining({ clientId: 'issued-client' }));
  });

  it('releases the waiting prompt on cancellation without saving credentials', async () => {
    const save = vi.spyOn(CredentialResolver.prototype, 'saveOAuthCredentials').mockResolvedValue();
    const finished = vi.fn();
    vi.spyOn(openaiOAuthProvider, 'login').mockImplementation(async callbacks => {
      callbacks.onAuth({ url: 'https://auth.openai.com/example' });
      try {
        await callbacks.onPrompt({ message: 'Paste callback URL', signal: callbacks.signal });
        throw new Error('Cancelled prompt unexpectedly resolved');
      } finally { finished(); }
    });
    const handler = createOAuthAsyncHandler(service());
    const started = await handler.request('/start', { method: 'POST', body: JSON.stringify({ provider: 'openai' }) });
    const { payload: { sessionId } } = await started.json() as { payload: { sessionId: string } };
    await handler.request(`/${sessionId}/cancel`, { method: 'POST' });
    await vi.waitFor(() => expect(finished).toHaveBeenCalledOnce());
    const { payload } = await (await handler.request(`/${sessionId}/status`)).json() as { payload: { status: string } };
    expect(payload.status).toBe('cancelled');
    expect(save).not.toHaveBeenCalled();
  });
});

describe('buildDesktopOAuthReturnUrl', () => {
  it('uses a dedicated Electron callback for tunnel authorization', () => {
    expect(buildDesktopOAuthReturnUrl(
      'xopc-tunnel',
      'oauth-test',
      '/settings/remote-access?tab=public',
    )).toBe(
      'xopc://cloud/tunnel-connected?request_id=oauth-test&return_path=%2Fsettings%2Fremote-access%3Ftab%3Dpublic',
    );
  });

  it('keeps model authorization on its dedicated callback', () => {
    expect(buildDesktopOAuthReturnUrl('xopc-cloud', 'oauth-test', undefined)).toBe(
      'xopc://cloud/model-connected?request_id=oauth-test',
    );
  });

  it('does not create Electron callbacks for unrelated OAuth providers', () => {
    expect(buildDesktopOAuthReturnUrl('google-gemini-cli', 'oauth-test', '/chat')).toBeUndefined();
  });
});

describe('normalizeDesktopOAuthReturnPath', () => {
  it('accepts internal routes and rejects external or malformed paths', () => {
    expect(normalizeDesktopOAuthReturnPath('/chat?onboarding=1')).toBe('/chat?onboarding=1');
    expect(normalizeDesktopOAuthReturnPath('//evil.example')).toBeUndefined();
    expect(normalizeDesktopOAuthReturnPath('https://evil.example')).toBeUndefined();
    expect(normalizeDesktopOAuthReturnPath('/chat\\evil')).toBeUndefined();
  });
});

describe('resolveOAuthLoginMethodPreference', () => {
  const supportedMethods = ['browser', 'device_code'] as const;

  it('uses device code for a remote client when the provider supports both flows', () => {
    expect(resolveOAuthLoginMethodPreference({ remote: true, supportedMethods })).toBe('device_code');
  });

  it('lets a local client use the provider browser default', () => {
    expect(resolveOAuthLoginMethodPreference({ remote: false, supportedMethods })).toBeUndefined();
  });

  it('honors a supported explicit method', () => {
    expect(resolveOAuthLoginMethodPreference({
      remote: true,
      supportedMethods,
      requestedMethod: 'browser',
    })).toBe('browser');
  });

  it('rejects an unsupported explicit method for capability-aware providers', () => {
    expect(resolveOAuthLoginMethodPreference({
      remote: false,
      supportedMethods,
      requestedMethod: 'manual',
    })).toBeUndefined();
  });
});

describe('refreshModelCatalogAfterOAuth', () => {
  function serviceWith(refreshNow: () => Promise<unknown>) {
    return {
      getModelCatalogSync: () => ({ refreshNow }),
    } as unknown as Pick<GatewayService, 'getModelCatalogSync'>;
  }

  it('refreshes XOPC Cloud models after credentials are persisted', async () => {
    const refreshNow = vi.fn(async () => ({ status: 'updated' }));

    await refreshModelCatalogAfterOAuth('xopc-cloud', serviceWith(refreshNow));

    expect(refreshNow).toHaveBeenCalledOnce();
  });

  it('does not refresh unrelated OAuth providers', async () => {
    const refreshNow = vi.fn(async () => ({ status: 'updated' }));

    await refreshModelCatalogAfterOAuth('google-gemini-cli', serviceWith(refreshNow));

    expect(refreshNow).not.toHaveBeenCalled();
  });

  it('keeps a successful OAuth connection when model refresh is temporarily unavailable', async () => {
    const refreshNow = vi.fn(async () => { throw new Error('rate limited'); });

    await expect(
      refreshModelCatalogAfterOAuth('xopc-cloud', serviceWith(refreshNow)),
    ).resolves.toMatchObject({
      state: 'unavailable',
      error: { code: 'refresh_failed', message: 'rate limited', retryable: true },
    });
  });
});

describe('buildOAuthCompletionReadiness', () => {
  it('marks authorization as connected-degraded when catalog setup fails', () => {
    const readiness = buildOAuthCompletionReadiness(ConfigSchema.parse({}), {
      state: 'unavailable',
      source: 'none',
      modelCount: 0,
      error: { code: 'refresh_failed', message: 'offline', retryable: true },
    });

    expect(readiness).toMatchObject({
      authorized: true,
      state: 'connected-degraded',
      catalog: { state: 'unavailable' },
    });
  });
});


describe('Cloud capability setup through web and desktop OAuth', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(['web', 'desktop'] as const)('enables published voice capabilities after %s authorization', async (client) => {
    initializeTestAgentCatalog();
    vi.spyOn(CredentialResolver.prototype, 'saveOAuthCredentials').mockResolvedValue();
    vi.spyOn(xopcCloudOAuthProvider, 'login').mockResolvedValue({
      access: 'test-access', refresh: 'test-refresh', expires: Date.now() + 3600_000,
    });
    const voice = voiceManifestSchema.parse({
      protocolVersion: 1, serviceVersion: 1, modes: ['conversation'], transport: 'websocket-pcm',
      inputFormat: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 },
      outputFormat: { encoding: 'pcm_s16le', sampleRate: 24000, channels: 1 },
      turnDetection: ['server_vad'], bargeIn: true, tools: false, resumable: false,
      voices: [{ id: 'voice-a', name: 'Voice A', languages: ['zh'] }], defaultVoice: 'voice-a',
      limits: { maxFrameBytes: 65536, maxSessionSeconds: 1800 },
    });
    let config = ConfigSchema.parse({});
    const service = {
      get currentConfig() { return config; },
      saveConfig: vi.fn(async (next: typeof config) => { config = ConfigSchema.parse(next); return { saved: true }; }),
      emit: vi.fn(),
      getModelCatalogSync: () => ({ refreshNow: async () => {
        getModelCatalogStore().saveSource('xopc-cloud', {
          providerId: 'xopc-cloud', baseUrl: 'https://cloud.test/v1', api: 'openai-completions',
          etag: null, recommendedModel: null, lastSuccessAt: Date.now(),
          models: [{
            id: 'realtime', name: 'Realtime', kind: 'omni', availability: 'available', voice,
            input: ['audio'], output: ['audio'], operations: ['audio.conversation'],
            reasoning: false, contextWindow: 32000, maxOutputTokens: 4096,
          }],
        });
        return { state: 'ready', source: 'network', modelCount: 1 };
      } }),
    } as unknown as GatewayService;
    const handler = client === 'desktop' ? createOAuthAsyncHandler(service) : createOAuthHandler(service);
    const response = await handler.request('/start', { method: 'POST', body: JSON.stringify({ provider: 'xopc-cloud' }) });
    expect(response.status).toBe(200);
    if (client === 'desktop') {
      const { payload: { sessionId } } = await response.json() as { payload: { sessionId: string } };
      await vi.waitFor(async () => {
        const { payload } = await (await handler.request(`/${sessionId}/status`)).json() as { payload: { status: string; readiness: { configuration: { applied: boolean } } } };
        expect(payload.status).toBe('completed');
        expect(payload.readiness.configuration.applied).toBe(true);
      });
    } else {
      expect(await response.json()).toMatchObject({ payload: { success: true, readiness: { configuration: { applied: true } } } });
    }
    expect(config.voice?.realtime).toMatchObject({ enabled: true, omni: { provider: 'xopc-cloud', model: 'realtime', voice: 'voice-a' } });
  });
});
