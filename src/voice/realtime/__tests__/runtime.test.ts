import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../../config/schema.js';
import { VoiceRealtimeRuntime } from '../runtime.js';

function config() {
  return ConfigSchema.parse({
    voice: { realtime: { enabled: true } },
    tools: {
      media: {
        audio: {
          enabled: true,
          provider: 'alibaba',
          providers: { alibaba: { apiKey: 'stt-key' } },
        },
      },
    },
    messages: {
      tts: {
        enabled: true,
        provider: 'alibaba',
        trigger: 'always',
        providers: { alibaba: { apiKey: 'tts-key', voice: 'Cherry' } },
      },
    },
  });
}

describe('VoiceRealtimeRuntime session creation', () => {
  let runtime: VoiceRealtimeRuntime | undefined;

  afterEach(() => runtime?.close());

  function createRuntime(options?: { exists?: boolean; busy?: boolean }) {
    runtime = new VoiceRealtimeRuntime({
      getConfig: config,
      sessionExists: vi.fn(async () => options?.exists ?? true),
      sessionBusy: vi.fn(() => options?.busy ?? false),
      runAgent: vi.fn(async function* () {}),
      recordInterruption: vi.fn(async () => undefined),
    });
    return runtime;
  }

  it('creates a dictation session with only a streaming STT route', async () => {
    const result = await createRuntime().createSession({ purpose: 'dictation' }, 'user-1');

    expect(result.route).toEqual({
      engine: 'dictation',
      stt: {
        provider: 'alibaba',
        model: 'qwen-audio-3.0-asr-flash-streaming',
        managed: false,
      },
    });
    expect(result.inputFormat).toEqual({ encoding: 'pcm_s16le', sampleRate: 16_000, channels: 1 });
  });

  it('creates an Omni session independently of STT and TTS and keeps secrets out of the ticket response', async () => {
    const nativeConfig = ConfigSchema.parse({ voice: { realtime: { enabled: true, omni: { provider: 'alibaba', model: 'qwen3-omni-flash-realtime', voice: 'Cherry', apiKey: 'native-secret' } } } });
    runtime = new VoiceRealtimeRuntime({ getConfig: () => nativeConfig, sessionExists: async () => true, sessionBusy: () => false,
      getSessionIdentity: async () => 'stored-session', recordOmniTranscript: async () => {}, recordInterruption: async () => {}, runAgent: vi.fn(async function* () {}) });
    const request = { purpose: 'conversation' as const, engine: 'omni' as const, sessionKey: 'chat' };
    const result = await runtime.createSession(request, 'user');
    expect(result.route).toEqual({ engine: 'omni', omni: { provider: 'alibaba', model: 'qwen3-omni-flash-realtime', managed: false } });
    expect(JSON.stringify(result)).not.toContain('native-secret');
    expect(runtime.hasConversation('chat')).toBe(true);
    await expect(runtime.createSession(request, 'user')).rejects.toThrow('voice connection');
  });

  it('freezes both Qwen routes for conversation', async () => {
    const result = await createRuntime().createSession(
      { purpose: 'conversation', engine: 'agent', sessionKey: 'agent:main:webchat:default:direct:voice' },
      'user-1',
    );

    expect(result.route.engine).toBe('agent');
    if (result.route.engine !== 'agent') throw new Error('Expected agent route');
    expect(result.route.tts).toEqual({
      provider: 'alibaba',
      model: 'qwen3-tts-flash-realtime',
      managed: false,
    });
    expect(result.limits.maxSessionMs).toBe(3_600_000);
  });

  it('rejects a conversation when its chat is already running', async () => {
    await expect(createRuntime({ busy: true }).createSession(
      { purpose: 'conversation', engine: 'agent', sessionKey: 'agent:main:webchat:default:direct:voice' },
      'user-1',
    )).rejects.toThrow('active response');
  });

  it('reserves one voice conversation per chat', async () => {
    const service = createRuntime();
    const request = {
      purpose: 'conversation' as const, engine: 'agent' as const,
      sessionKey: 'agent:main:webchat:default:direct:voice',
    };
    await service.createSession(request, 'user-1');

    await expect(service.createSession(request, 'user-1')).rejects.toMatchObject({
      code: 'SESSION_CONFLICT',
      status: 409,
    });
  });

  it('releases an unused conversation reservation when its ticket expires', async () => {
    const service = createRuntime();
    const request = {
      purpose: 'conversation' as const, engine: 'agent' as const,
      sessionKey: 'agent:main:webchat:default:direct:voice',
    };
    await service.createSession(request, 'user-1', 1_000);

    await expect(service.createSession(request, 'user-1', 61_001)).resolves.toMatchObject({
      purpose: 'conversation', route: { engine: 'agent' },
    });
  });
});
