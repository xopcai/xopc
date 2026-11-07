import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const credentials = vi.hoisted(()=>vi.fn(async ()=>'plan-key'));
vi.mock('../../../providers/provider-auth-service.js',()=>({getProviderAuthService:()=>({resolveApiKey:credentials})}));

import { ConfigSchema } from '../../../config/schema.js';
import { resolveOmniRoute } from '../omniRoute.js';
import { getModelCatalogStore, resetModelCatalogStore } from '../../../providers/model-catalog-store.js';
import { voiceFixture } from '../../__tests__/voice-fixture.js';

describe('shared native voice credentials', () => {
  it('advertises actions only on compatible direct realtime models and removes the old generated restriction', async () => {
    const config = ConfigSchema.parse({ voice: { realtime: { omni: { provider: 'alibaba',
      model: 'qwen3.8-omni-flash-realtime', voice: 'Tina', apiKey: 'test',
      instructions: 'Keep replies conversational and concise. You cannot execute tools.' } } } });
    const route = await resolveOmniRoute(config);
    expect(route.tools).toBe(true);
    expect(route.instructions).not.toContain('cannot execute tools');
    config.voice.realtime.omni!.model = 'qwen3-omni-flash-realtime';
    expect((await resolveOmniRoute(config)).tools).toBe(false);
  });
  it('uses only the subscription credential and endpoint for subscription conversation', async () => {
    const route = await resolveOmniRoute(ConfigSchema.parse({voice:{realtime:{omni:{provider:'qwen-token-plan-cn',model:'qwen-audio-3.0-realtime-plus',voice:'longanqian',apiKey:'wrong-key',baseUrl:'wss://dashscope.aliyuncs.com/api-ws/v1/realtime'}}}}));
    expect(route.url).toBe('wss://token-plan.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen-audio-3.0-realtime-plus');
    expect(route.apiKey).toBe('plan-key');
    expect(credentials).toHaveBeenCalledWith('qwen-token-plan-cn');
  });
  it('uses the shared input credential unless an explicit native override is configured', async () => {
    const config = ConfigSchema.parse({
      voice: { realtime: { enabled: true, omni: { provider: 'alibaba', model: 'qwen3-omni-flash-realtime', voice: 'Cherry' } } },
      tools: { media: { audio: { providers: { alibaba: { apiKey: 'shared-test-key' } } } } },
    });
    expect((await resolveOmniRoute(config)).apiKey).toBe('shared-test-key');
    config.voice!.realtime!.omni!.apiKey = 'explicit-test-key';
    expect((await resolveOmniRoute(config)).apiKey).toBe('explicit-test-key');
  });
});

describe('per-Ada Cloud realtime selection', () => {
  beforeEach(() => getModelCatalogStore().saveSource('xopc-cloud', { providerId: 'xopc-cloud', baseUrl: 'https://example.test/v1',
    api: 'openai-completions', etag: 'realtime-test', recommendedModel: null, lastSuccessAt: 1,
    models: [{ id: 'realtime', name: 'XOPC Cloud Realtime', availability: 'available', kind: 'omni', input: ['audio'],
      output: ['audio', 'text'], operations: ['audio.conversation'], contextWindow: 128000, maxOutputTokens: null,
      reasoning: false, voice: voiceFixture(['conversation']) }] }));
  afterEach(resetModelCatalogStore);

  it('resolves a published model without changing the global selection or inventing tool support', async () => {
    const config = ConfigSchema.parse({});
    const route = await resolveOmniRoute(config, 'xopc-cloud/realtime');
    expect(route.route).toEqual({ provider: 'xopc-cloud', model: 'realtime', managed: true });
    expect(route.voice).toBe('voice-a');
    expect(route.apiKey).toBe('plan-key');
    expect(route.tools).toBe(false);
    expect(new URL(route.url).searchParams.get('model')).toBe('realtime');
    expect(config.voice?.realtime?.omni).toBeUndefined();
    getModelCatalogStore().removeSource('xopc-cloud');
    await expect(resolveOmniRoute(config, 'xopc-cloud/realtime')).rejects.toThrow('unavailable');
  });

  it('uses a conversation-capable voice when the catalog default belongs to another mode', async () => {
    const source = getModelCatalogStore().getSource('xopc-cloud')!;
    source.models[0]!.voice!.voices = [
      { id: 'speech-only', name: 'Speech', languages: ['zh'], modes: ['speech'] },
      { id: 'conversation-only', name: 'Conversation', languages: ['zh'], modes: ['conversation'] },
    ];
    source.models[0]!.voice!.defaultVoice = 'speech-only';
    getModelCatalogStore().saveSource('xopc-cloud', source);
    expect((await resolveOmniRoute(ConfigSchema.parse({}), 'xopc-cloud/realtime')).voice).toBe('conversation-only');
  });
});
