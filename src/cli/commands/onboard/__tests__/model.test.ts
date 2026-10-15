import { voiceManifestSchema } from '@xopcai/realtime-protocol/voice';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initializeTestAgentCatalog } from '../../../../agent-catalog/test-support.js';
import {
  ConfigSchema,
  getAgentDefaultModelRef,
} from '../../../../config/schema.js';
import {
  refreshOnboardModelCatalogIfNeeded,
  setPrimaryModel,
  setupModel,
} from '../model.js';
import { AgentCatalogRepository } from '../../../../agent-catalog/repository.js';
import { getModelCatalogStore } from '../../../../providers/model-catalog-store.js';

vi.mock('@inquirer/prompts', () => ({ confirm: vi.fn(async () => true), select: vi.fn(), input: vi.fn() }));
vi.mock('../../../../auth/profiles/index.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../auth/profiles/index.js')>(),
  listProfilesForProvider: vi.fn(() => [{ id: 'xopc-cloud:default' }]),
}));

describe('refreshOnboardModelCatalogIfNeeded', () => {
  it('loads the XOPC Cloud catalog when the local catalog is empty', async () => {
    const refresh = vi.fn(async () => ({
      state: 'ready' as const,
      source: 'network' as const,
      modelCount: 2,
    }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await refreshOnboardModelCatalogIfNeeded('xopc-cloud', false, { refresh });

    expect(refresh).toHaveBeenCalledOnce();
    log.mockRestore();
  });

  it('keeps a usable cached XOPC Cloud catalog without a network refresh', async () => {
    const refresh = vi.fn();

    await refreshOnboardModelCatalogIfNeeded('xopc-cloud', true, { refresh });

    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not refresh catalog-backed providers other than XOPC Cloud', async () => {
    const refresh = vi.fn();

    await refreshOnboardModelCatalogIfNeeded('openai', false, { refresh });

    expect(refresh).not.toHaveBeenCalled();
  });

  it('reports missing credentials instead of continuing with an empty catalog', async () => {
    const refresh = vi.fn(async () => ({ state: 'not-authorized' as const, source: 'none' as const, modelCount: 0 }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(
      refreshOnboardModelCatalogIfNeeded('xopc-cloud', false, { refresh }),
    ).rejects.toThrow('credentials are unavailable after OAuth login');
    log.mockRestore();
  });
});

describe('XOPC Cloud onboard defaults', () => {
  beforeEach(() => {
    initializeTestAgentCatalog();
    const voice = voiceManifestSchema.parse({
      protocolVersion: 1, serviceVersion: 1, modes: ['transcription.stream'], transport: 'websocket-pcm',
      inputFormat: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 },
      outputFormat: { encoding: 'pcm_s16le', sampleRate: 24000, channels: 1 },
      turnDetection: ['server_vad'], bargeIn: true, tools: false, resumable: false,
      voices: [], limits: { maxFrameBytes: 65536, maxSessionSeconds: 1800 },
    });
    getModelCatalogStore().saveSource('xopc-cloud', {
      providerId: 'xopc-cloud', baseUrl: 'https://cloud.test/v1', api: 'openai-completions',
      etag: null, recommendedModel: 'chat-model', lastSuccessAt: Date.now(),
      models: [{
        id: 'chat-model', name: 'Chat', kind: 'language', availability: 'available',
        input: ['text', 'image'], output: ['text'], operations: ['chat.completions'],
        reasoning: false, contextWindow: 32000, maxOutputTokens: 4096,
      }, {
        id: 'stt', name: 'Speech', kind: 'stt', availability: 'available',
        input: ['audio'], output: ['text'], operations: ['audio.transcription'], voice,
        reasoning: false, contextWindow: 0, maxOutputTokens: null,
      }],
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('fills capabilities when keeping the built-in Cloud chat model', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const updated = await setupModel(ConfigSchema.parse({}), {
      configPath: '/tmp/xopc.json', workspacePath: '/tmp/xopc-main', isVerbose: false, argv: [],
    });
    expect(updated.tools.media?.audio?.provider).toBe('xopc-cloud');
    expect(updated.voice?.realtime).toMatchObject({ enabled: true, stt: { model: 'stt' } });
  });

  it('sets the selected chat model and enables published Cloud capabilities', async () => {
    const config = ConfigSchema.parse({});
    const updated = await setPrimaryModel(config, '/tmp/xopc-main', 'xopc-cloud/chat-model');
    const defaults = new AgentCatalogRepository().getSettings().defaults;

    expect(getAgentDefaultModelRef()).toBe('xopc-cloud/chat-model');
    expect(defaults.models.imageUnderstanding?.primary).toBe('xopc-cloud/chat-model');
    expect(defaults.models.imageGeneration).toBeUndefined();
    expect(updated.tools.media?.audio).toMatchObject({ enabled: true, provider: 'xopc-cloud', providers: { 'xopc-cloud': { model: 'stt' } } });
    expect(updated.voice?.realtime).toMatchObject({ enabled: true, stt: { provider: 'xopc-cloud', model: 'stt' } });
    expect(updated.messages?.tts).toBeUndefined();
  });

  it('preserves existing explicit modality settings', async () => {
    const config = ConfigSchema.parse({
      tools: { media: { audio: { enabled: true, provider: 'custom-stt' } } },
      messages: { tts: { enabled: true, provider: 'edge', trigger: 'inbound' } },
    });
    const updated = await setPrimaryModel(config, '/tmp/xopc-main', 'xopc-cloud/chat-model');
    expect(updated.tools.media?.audio?.provider).toBe('custom-stt');
    expect(updated.messages?.tts?.provider).toBe('edge');
  });
});
