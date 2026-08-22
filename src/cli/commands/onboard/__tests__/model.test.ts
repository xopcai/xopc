import { describe, expect, it, vi } from 'vitest';

import { ConfigSchema, getAgentDefaultImageGenerationModelConfig, getAgentDefaultModelRef } from '../../../../config/schema.js';
import { ModelCatalogStore } from '../../../../providers/model-catalog-store.js';
import {
  defaultXopcCloudImageModel,
  defaultXopcCloudAudioModels,
  refreshOnboardModelCatalogIfNeeded,
  setPrimaryModel,
} from '../model.js';

describe('refreshOnboardModelCatalogIfNeeded', () => {
  it('loads the XOPC Cloud catalog when the local catalog is empty', async () => {
    const refresh = vi.fn(async () => ({
      status: 'updated' as const,
      modelCount: 2,
      models: ['deepseek-v4-flash', 'glm-5'],
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
    const refresh = vi.fn(async () => ({ status: 'skipped' as const, reason: 'not_configured' as const }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(
      refreshOnboardModelCatalogIfNeeded('xopc-cloud', false, { refresh }),
    ).rejects.toThrow('credentials are unavailable after OAuth login');
    log.mockRestore();
  });
});

describe('XOPC Cloud onboard defaults', () => {
  it('uses the first available published image-generation model without prompting', () => {
    const store = new ModelCatalogStore();
    store.replaceSourceModels('xopc-cloud', {
      providerId: 'xopc-cloud', baseUrl: 'https://router.xopc.ai/v1',
      api: 'openai-completions', etag: '1', recommendedModel: 'chat-model', lastSuccessAt: Date.now(),
    }, [
      {
        id: 'chat-model', name: 'Chat', kind: 'language', input: ['text'], output: ['text'],
        operations: ['chat.completions'], reasoning: false, contextWindow: 128_000, maxOutputTokens: 8_192,
      },
      {
        id: 'image-01', name: 'Image', kind: 'image', input: ['text'], output: ['image'],
        operations: ['images.generate'], reasoning: false, contextWindow: 128_000, maxOutputTokens: null,
      },
      {
        id: 'stt-fast', name: 'STT', kind: 'stt', input: ['audio'], output: ['text'],
        operations: ['audio.transcription'], reasoning: false, contextWindow: 0, maxOutputTokens: null,
      },
      {
        id: 'tts-natural', name: 'TTS', kind: 'tts', input: ['text'], output: ['audio'],
        operations: ['audio.speech'], reasoning: false, contextWindow: 0, maxOutputTokens: null,
        tts: { maxCharacters: 4096, languages: ['zh'], outputFormats: ['opus'], streaming: true,
          speed: true, pitch: false, instructions: true, defaultVoice: 'coral' },
      },
    ]);

    expect(defaultXopcCloudImageModel(store)).toBe('xopc-cloud/image-01');
    expect(defaultXopcCloudAudioModels(store)).toEqual({
      stt: 'stt-fast', tts: { model: 'tts-natural', voice: 'coral', maxCharacters: 4096 },
    });
  });

  it('adds the image default while preserving other model roles', () => {
    const config = ConfigSchema.parse({});
    const updated = setPrimaryModel(
      config,
      '/tmp/xopc-main',
      'xopc-cloud/chat-model',
      'xopc-cloud/image-01',
    );

    expect(getAgentDefaultModelRef(updated)).toBe('xopc-cloud/chat-model');
    expect(getAgentDefaultImageGenerationModelConfig(updated, 'main')).toEqual({
      primary: 'xopc-cloud/image-01',
    });
  });

  it('does not replace an existing explicit image-generation model', () => {
    const config = ConfigSchema.parse({});
    config.agents.capabilityPresets.default!.models!.imageGenerationModel = {
      primary: 'openai/gpt-image-2',
    };

    const updated = setPrimaryModel(config, '/tmp/xopc-main', 'xopc-cloud/chat-model', 'xopc-cloud/image-01');
    expect(getAgentDefaultImageGenerationModelConfig(updated, 'main')?.primary).toBe('openai/gpt-image-2');
  });

  it('configures cloud STT and TTS without enabling automatic spoken replies', () => {
    const config = ConfigSchema.parse({});
    const updated = setPrimaryModel(config, '/tmp/xopc-main', 'xopc-cloud/chat-model', undefined, {
      stt: 'stt-fast', tts: { model: 'tts-natural', voice: 'coral', maxCharacters: 4096 },
    });
    expect(updated.tools.media?.audio).toMatchObject({
      enabled: true, provider: 'xopc-cloud', models: [{ provider: 'xopc-cloud', model: 'stt-fast' }],
      providers: { 'xopc-cloud': { model: 'stt-fast' } }, fallback: { enabled: false, order: [] },
    });
    expect(updated.messages?.tts).toMatchObject({
      enabled: true, provider: 'xopc-cloud', trigger: 'off', maxTextLength: 4096,
      providers: { 'xopc-cloud': { model: 'tts-natural', voice: 'coral' } },
    });
  });

  it('preserves explicit STT and TTS settings', () => {
    const config = ConfigSchema.parse({
      tools: { media: { audio: { enabled: true, provider: 'xopc-local' } } },
      messages: { tts: { enabled: true, provider: 'edge', trigger: 'inbound' } },
    });
    const updated = setPrimaryModel(config, '/tmp/xopc-main', 'xopc-cloud/chat-model', undefined, {
      stt: 'stt-fast', tts: { model: 'tts-natural', voice: 'coral', maxCharacters: 4096 },
    });
    expect(updated.tools.media?.audio?.provider).toBe('xopc-local');
    expect(updated.messages?.tts?.provider).toBe('edge');
  });
});
