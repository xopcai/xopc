import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../../config/schema.js';
import { resolveStreamingStt, resolveStreamingTts } from '../runtime.js';

function settings() {
  return ConfigSchema.parse({
    voice: { realtime: { enabled: true, tts: { provider: 'alibaba', voice: 'Ethan' } } },
    tools: { media: { audio: { enabled: true, provider: 'alibaba', providers: { alibaba: { apiKey: 'input-key' } } } } },
    messages: { tts: { enabled: true, provider: 'edge', trigger: 'inbound', providers: {
      edge: { voice: 'zh-CN-XiaoxiaoNeural' }, alibaba: { apiKey: 'readout-key', model: 'qwen-tts', voice: 'longxiaochun' },
    } } },
  });
}

describe('independent realtime voice settings', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('reuses the input credential without changing message readout', () => {
    const config = settings();
    const snapshot = structuredClone(config);
    const output = resolveStreamingTts(config);
    expect(output?.route).toEqual({ provider: 'alibaba', model: 'qwen3-tts-flash-realtime', managed: false });
    expect(output?.config.providers?.alibaba).toMatchObject({ apiKey: 'input-key', voice: 'Ethan' });
    expect(resolveStreamingStt(config)?.apiKey).toBe('input-key');
    expect(config).toEqual(snapshot);
  });

  it('keeps conversation enabled when message readout is off', () => {
    const config = settings();
    config.messages!.tts!.enabled = false;
    config.messages!.tts!.trigger = 'off';
    expect(resolveStreamingTts(config)?.route.provider).toBe('alibaba');
  });

  it('does not mistake Edge message readout for realtime output', () => {
    const config = settings();
    delete config.voice!.realtime.tts;
    expect(resolveStreamingTts(config)).toBeUndefined();
    expect(resolveStreamingStt(config)?.route.provider).toBe('alibaba');
  });

  it('uses an environment input key before an unrelated readout key', () => {
    const config = settings();
    delete config.tools.media!.audio!.providers!.alibaba!.apiKey;
    vi.stubEnv('DASHSCOPE_API_KEY', 'environment-key');
    expect(resolveStreamingTts(config)?.config.providers?.alibaba?.apiKey).toBe('environment-key');
  });

  it('chooses a realtime default voice independently of the batch voice', () => {
    const config = settings();
    delete config.voice!.realtime.tts!.voice;
    expect(resolveStreamingTts(config)?.config.providers?.alibaba?.voice).toBe('Cherry');
  });

  it('rejects secrets and batch-only providers in the conversation selection', () => {
    expect(ConfigSchema.safeParse({ voice: { realtime: { tts: { provider: 'edge' } } } }).success).toBe(false);
    expect(ConfigSchema.safeParse({ voice: { realtime: { tts: { provider: 'alibaba', apiKey: 'secret' } } } }).success).toBe(false);
  });
});
