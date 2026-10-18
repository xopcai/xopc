import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { voiceManifestSchema } from '@xopcai/realtime-protocol/voice';

import { initializeTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { ConfigSchema } from '../../config/schema.js';
import { closeXopcDatabase } from '../../storage/sqlite/index.js';
import type { CatalogModel, CatalogSource } from '../../providers/model-catalog-store.js';
import { getModelCatalogStore } from '../../providers/model-catalog-store.js';
import { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import {
  applyXopcCloudCapabilitySetup,
  prepareXopcCloudCapabilitySetup,
  selectXopcCloudCapabilities,
} from '../xopc-cloud-capability-setup.js';

function model(input: Partial<CatalogModel> & Pick<CatalogModel, 'id' | 'kind'>): CatalogModel {
  return {
    name: input.id,
    availability: 'available',
    input: ['text'],
    output: ['text'],
    operations: ['chat.completions'],
    reasoning: false,
    contextWindow: 32_000,
    maxOutputTokens: 4_096,
    ...input,
  };
}

function source(models: CatalogModel[]): CatalogSource {
  return {
    providerId: 'xopc-cloud',
    baseUrl: 'https://cloud.test/v1',
    api: 'openai-completions',
    etag: 'catalog-v1',
    recommendedModel: 'chat',
    recommended: {
      vision: 'vision-recommended',
      'image-generation': 'image-recommended',
      stt: 'stt-recommended',
      tts: 'tts-recommended',
    },
    lastSuccessAt: Date.now(),
    models,
  };
}

function voice(modes: Array<'transcription.stream' | 'speech.stream' | 'conversation'>) {
  return voiceManifestSchema.parse({
    protocolVersion: 1, serviceVersion: 1, modes, transport: 'websocket-pcm',
    inputFormat: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 },
    outputFormat: { encoding: 'pcm_s16le', sampleRate: 24000, channels: 1 },
    turnDetection: ['server_vad'], bargeIn: true, tools: false, resumable: false,
    voices: [{ id: 'voice-a', name: 'Voice A', languages: ['zh'] }], defaultVoice: 'voice-a',
    limits: { maxFrameBytes: 65536, maxSessionSeconds: 1800 },
  });
}

const completeCatalog = source([
  model({ id: 'chat', kind: 'language' }),
  model({ id: 'vision-other', kind: 'language', input: ['text', 'image'], priority: 0 }),
  model({ id: 'vision-recommended', kind: 'language', input: ['text', 'image'], priority: 10 }),
  model({ id: 'image-recommended', kind: 'image', output: ['image'], operations: ['images.generate'] }),
  model({ id: 'stt-recommended', kind: 'stt', input: ['audio'], operations: ['audio.transcription'] }),
  model({
    id: 'tts-recommended',
    kind: 'tts',
    output: ['audio'],
    operations: ['audio.speech'],
    tts: {
      maxCharacters: 600,
      languages: ['zh', 'en'],
      outputFormats: ['wav'],
      streaming: false,
      speed: false,
      pitch: false,
      instructions: false,
      defaultVoice: 'Chelsie',
    },
    voice: voice(['speech.stream']),
  }),
  model({ id: 'stt-live', kind: 'stt', input: ['audio'], operations: ['audio.transcription'], voice: voice(['transcription.stream']) }),
  model({ id: 'omni-live', kind: 'omni', input: ['audio'], output: ['audio'], operations: ['audio.conversation'], voice: voice(['conversation']) }),
]);

beforeAll(() => initializeTestAgentCatalog());
afterAll(() => closeXopcDatabase());

describe('XOPC Cloud capability setup', () => {
  it('keeps an available API-key chat default and explicit media settings after OAuth', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    try {
      initializeTestAgentCatalog({ defaults: {
        models: { chat: { primary: 'openai/gpt-5', fallbacks: [] }, intents: {} },
        skills: { mode: 'selected', include: [] }, tools: {}, workflows: {}, runtime: {},
      } });
      getModelCatalogStore().saveSource('xopc-cloud', completeCatalog);
      const config = ConfigSchema.parse({
        tools: { media: { audio: { enabled: false, provider: 'xopc-local' } } },
        messages: { tts: { enabled: false, provider: 'edge' } },
      });
      const saved: typeof config[] = [];
      const result = await applyXopcCloudCapabilitySetup({
        currentConfig: config,
        saveConfig: async (next) => { saved.push(next); return { saved: true }; },
      });
      expect(result.configured).toBe(true);
      expect(new AgentCatalogRepository().getSettings().defaults.models.chat.primary).toBe('openai/gpt-5');
      expect(saved[0].tools?.media?.audio).toEqual(config.tools?.media?.audio);
      expect(saved[0].messages?.tts).toEqual(config.messages?.tts);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('sets up published chat capabilities even if image and speech models are missing', async () => {
    initializeTestAgentCatalog({ defaults: {
      models: { chat: { primary: 'xopc-cloud/auto', fallbacks: [] }, intents: {} },
      skills: { mode: 'selected', include: [] }, tools: {}, workflows: {}, runtime: {},
    } });
    getModelCatalogStore().saveSource('xopc-cloud', source([model({ id: 'chat', kind: 'language' })]));
    const saved: Array<ReturnType<typeof ConfigSchema.parse>> = [];
    const result = await applyXopcCloudCapabilitySetup({
      currentConfig: ConfigSchema.parse({}),
      saveConfig: async (next) => { saved.push(next); return { saved: true }; },
    });
    expect(result).toMatchObject({ configured: true, missing: ['vision', 'image-generation', 'stt', 'tts'] });
    expect(saved).toHaveLength(1);
    expect(new AgentCatalogRepository().getSettings().defaults.models.chat.primary).toBe('xopc-cloud/chat');
  });
  it('enables every published media mode on a fresh install and is idempotent', async () => {
    initializeTestAgentCatalog();
    getModelCatalogStore().saveSource('xopc-cloud', completeCatalog);
    let config = ConfigSchema.parse({});
    const service = {
      get currentConfig() { return config; },
      saveConfig: async (next: typeof config) => { config = ConfigSchema.parse(next); return { saved: true }; },
    };
    expect(await applyXopcCloudCapabilitySetup(service)).toMatchObject({ configured: true, missing: [] });
    expect(new AgentCatalogRepository().getSettings().defaults.models).toMatchObject({
      chat: { primary: 'xopc-cloud/chat' },
      imageUnderstanding: { primary: 'xopc-cloud/vision-recommended' },
      imageGeneration: { primary: 'xopc-cloud/image-recommended' },
      background: { primary: 'xopc-cloud/chat' },
      intents: { fast: { primary: 'xopc-cloud/chat' }, understanding: { primary: 'xopc-cloud/chat' }, coding: { primary: 'xopc-cloud/chat' } },
    });
    expect(config.tools.media?.audio).toMatchObject({ enabled: true, provider: 'xopc-cloud', providers: { 'xopc-cloud': { model: 'stt-recommended' } } });
    expect(config.messages?.tts).toMatchObject({ enabled: true, provider: 'xopc-cloud', trigger: 'off', providers: { 'xopc-cloud': { model: 'tts-recommended', voice: 'Chelsie' } } });
    expect(config.voice?.realtime).toMatchObject({
      enabled: true,
      stt: { provider: 'xopc-cloud', model: 'stt-live' },
      tts: { provider: 'xopc-cloud', model: 'tts-recommended', voice: 'voice-a' },
      omni: { provider: 'xopc-cloud', model: 'omni-live', voice: 'voice-a' },
    });
    const first = structuredClone(config);
    const defaults = new AgentCatalogRepository().getSettings().defaults;
    await applyXopcCloudCapabilitySetup(service);
    expect(config).toEqual(first);
    expect(new AgentCatalogRepository().getSettings().defaults).toEqual(defaults);
  });

  it('preserves explicit unavailable chat and image routes and disabled realtime voice', async () => {
    initializeTestAgentCatalog({ defaults: {
      models: {
        chat: { primary: 'custom/offline', fallbacks: [] }, intents: {},
        imageUnderstanding: { primary: 'custom/vision', fallbacks: [] },
        imageGeneration: { primary: 'custom/image', fallbacks: [], autoProviderFallback: false },
      },
      skills: { mode: 'selected', include: [] }, tools: {}, workflows: {}, runtime: {},
    } });
    const defaults = new AgentCatalogRepository().getSettings().defaults;
    getModelCatalogStore().saveSource('xopc-cloud', completeCatalog);
    const config = ConfigSchema.parse({ voice: { realtime: { enabled: false } } });
    let saved = config;
    await applyXopcCloudCapabilitySetup({ currentConfig: config, saveConfig: async (next) => { saved = next; return { saved: true }; } });
    expect(new AgentCatalogRepository().getSettings().defaults).toMatchObject(defaults);
    expect(saved.voice).toEqual(config.voice);
  });

  it('enables available capabilities on explicit onboarding with pre-existing disabled configuration', async () => {
    initializeTestAgentCatalog();
    getModelCatalogStore().saveSource('xopc-cloud', completeCatalog);
    let saved = ConfigSchema.parse({ voice: { realtime: { enabled: false } },
      tools: { media: { audio: { enabled: false, provider: 'openai' } } }, messages: { tts: { enabled: false, provider: 'edge' } },
    });
    await applyXopcCloudCapabilitySetup({ currentConfig: saved, saveConfig: async next => { saved = ConfigSchema.parse(next); return { saved: true }; } }, { enableAvailable: true });
    expect(saved.tools.media?.audio).toMatchObject({ enabled: true, provider: 'xopc-cloud' });
    expect(saved.messages?.tts).toMatchObject({ enabled: true, provider: 'xopc-cloud' });
    expect(saved.voice?.realtime).toMatchObject({ enabled: true, stt: { model: 'stt-live' }, tts: { model: 'tts-recommended' }, omni: { model: 'omni-live' } });
    expect(saved.computer.enabled).toBe(false);
  });

  it('keeps explicit voice choices while filling missing modes on enabled realtime', async () => {
    initializeTestAgentCatalog();
    getModelCatalogStore().saveSource('xopc-cloud', completeCatalog);
    const config = ConfigSchema.parse({ voice: { realtime: { enabled: true, tts: { provider: 'alibaba', model: 'my-model', voice: 'my-voice' } } } });
    let saved = config;
    await applyXopcCloudCapabilitySetup({ currentConfig: config, saveConfig: async (next) => { saved = next; return { saved: true }; } });
    expect(saved.voice?.realtime.tts).toEqual(config.voice?.realtime.tts);
    expect(saved.voice?.realtime.stt?.model).toBe('stt-live');
    expect(saved.voice?.realtime.omni?.model).toBe('omni-live');
  });

  it('does not enable realtime when the catalog offers no realtime models', async () => {
    initializeTestAgentCatalog();
    getModelCatalogStore().saveSource('xopc-cloud', source(completeCatalog.models.map(({ voice: _voice, ...entry }) => entry)));
    let saved = ConfigSchema.parse({});
    await applyXopcCloudCapabilitySetup({ currentConfig: saved, saveConfig: async (next) => { saved = next; return { saved: true }; } });
    expect(saved.voice).toBeUndefined();
    expect(saved.tools.media?.audio?.enabled).toBe(true);
    expect(saved.messages?.tts?.enabled).toBe(true);
  });

  it('does not persist Agent defaults when config saving fails', async () => {
    initializeTestAgentCatalog();
    const defaults = new AgentCatalogRepository().getSettings().defaults;
    getModelCatalogStore().saveSource('xopc-cloud', completeCatalog);
    expect(await applyXopcCloudCapabilitySetup({ currentConfig: ConfigSchema.parse({}), saveConfig: async () => ({ saved: false, error: 'disk full' }) })).toMatchObject({ configured: false, error: 'disk full' });
    expect(new AgentCatalogRepository().getSettings().defaults).toEqual(defaults);
  });

  it('selects the Cloud recommendation for every managed capability', () => {
    expect(selectXopcCloudCapabilities(completeCatalog)).toEqual({
      missing: [],
      selection: {
        chat: 'chat',
        vision: 'vision-recommended',
        imageGeneration: 'image-recommended',
        stt: 'stt-recommended',
        tts: 'tts-recommended',
        ttsVoice: 'Chelsie',
        realtimeStt: 'stt-live',
        realtimeTts: { model: 'tts-recommended', voice: 'voice-a' },
        realtimeOmni: { model: 'omni-live', voice: 'voice-a' },
      },
    });
  });

  it('starts realtime speech with a general voice when the catalog offers Cherry', () => {
    const tts = completeCatalog.models.find((entry) => entry.id === 'tts-recommended')!;
    const catalog = source(completeCatalog.models.map((entry) => entry.id === tts.id ? {
      ...entry,
      voice: voiceManifestSchema.parse({
        ...tts.voice,
        voices: [
          { id: 'Chelsie', name: 'Chelsie', languages: ['zh'] },
          { id: 'Cherry', name: 'Cherry', languages: ['zh'] },
        ],
        defaultVoice: 'Chelsie',
      }),
    } : entry));
    expect(selectXopcCloudCapabilities(catalog).selection?.realtimeTts).toEqual({
      model: 'tts-recommended', voice: 'Cherry',
    });
  });

  it('writes chat, STT, TTS, image understanding, and image generation in one config', () => {
    const config = ConfigSchema.parse({
      tools: {
        media: {
          audio: {
            enabled: true,
            provider: 'xopc-local',
            providers: { 'xopc-local': { model: 'sensevoice-small' } },
          },
        },
      },
    });

    const prepared = prepareXopcCloudCapabilitySetup(config, completeCatalog);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    expect(prepared.defaults.models).toMatchObject({
      chat: { primary: 'xopc-cloud/chat' },
      imageUnderstanding: { primary: 'xopc-cloud/vision-recommended' },
      imageGeneration: { primary: 'xopc-cloud/image-recommended' },
    });
    expect(prepared.config.tools.media?.audio).toMatchObject({
      enabled: true,
      provider: 'xopc-cloud',
      fallback: { enabled: false, order: ['xopc-cloud'] },
      providers: {
        'xopc-local': { model: 'sensevoice-small' },
        'xopc-cloud': { model: 'stt-recommended' },
      },
    });
    expect(prepared.config.messages?.tts).toMatchObject({
      enabled: true,
      provider: 'xopc-cloud',
      trigger: 'off',
      providers: {
        'xopc-cloud': { model: 'tts-recommended', voice: 'Chelsie' },
      },
    });
    expect(prepared.config.voice?.realtime).toMatchObject({
      enabled: true,
      stt: { provider: 'xopc-cloud', model: 'stt-live' },
      tts: { provider: 'xopc-cloud', model: 'tts-recommended', voice: 'voice-a' },
      omni: { provider: 'xopc-cloud', model: 'omni-live', voice: 'voice-a' },
    });
    expect(ConfigSchema.safeParse(prepared.config).success).toBe(true);
  });

  it('leaves realtime voice unset when the Cloud catalog publishes no realtime mode', () => {
    const catalog = source(completeCatalog.models.map(({ voice: _voice, ...entry }) => entry));
    const prepared = prepareXopcCloudCapabilitySetup(ConfigSchema.parse({}), catalog);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.config.voice?.realtime?.stt).toBeUndefined();
    expect(prepared.config.voice?.realtime?.tts).toBeUndefined();
    expect(prepared.config.voice?.realtime?.omni).toBeUndefined();
  });

  it('does not produce a partial configuration when the catalog is incomplete', () => {
    const incomplete = source(completeCatalog.models.filter((entry) => entry.kind !== 'image'));
    const prepared = prepareXopcCloudCapabilitySetup(ConfigSchema.parse({}), incomplete);

    expect(prepared).toMatchObject({ ok: false, missing: ['image-generation'] });
  });

  it('requires an available chat model before reporting setup success', () => {
    const incomplete = source(completeCatalog.models.filter((entry) => entry.kind !== 'language'));
    const prepared = prepareXopcCloudCapabilitySetup(ConfigSchema.parse({}), incomplete);

    expect(prepared).toMatchObject({ ok: false, missing: ['chat', 'vision'] });
  });
});
