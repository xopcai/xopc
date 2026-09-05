import { describe, expect, it, vi } from 'vitest';

const logger = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('../../utils/logger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/logger.js')>();
  return { ...actual, createLogger: (prefix: string) => {
    const instance = actual.createLogger(prefix);
    vi.spyOn(instance, 'warn').mockImplementation(logger.warn);
    return instance;
  } };
});

import { collectConfiguredProviderIds } from '../activation-context.js';
import '../../voice/stt/providers/index.js';
import '../../voice/tts/providers/index.js';

describe('collectConfiguredProviderIds', () => {
  it('quietly ignores saved configuration for unavailable voice extensions', () => {
    logger.warn.mockClear();
    const ids = collectConfiguredProviderIds({
      messages: { tts: { provider: 'edge', providers: { 'tts-local-cli': { command: '' } } } },
      tools: { media: { audio: { provider: 'alibaba', providers: { alibaba: { apiKey: 'test' }, groq: { model: 'whisper-large-v3-turbo' } } } } },
    });
    expect(ids).toContain('alibaba');
    expect(ids).not.toContain('groq');
    expect(ids).not.toContain('tts-local-cli');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('includes only configured TTS providers from messages.tts', () => {
    const ids = collectConfiguredProviderIds({
      messages: {
        tts: {
          enabled: true,
          provider: 'openai',
          providers: {
            openai: { apiKey: 'sk-test' },
            edge: { enabled: true },
          },
        },
      },
    });
    expect(ids).toContain('openai');
    expect(ids).toContain('edge');
  });

  it('includes only configured STT providers from tools.media.audio', () => {
    const ids = collectConfiguredProviderIds({
      tools: {
        media: {
          audio: {
            enabled: true,
            provider: 'alibaba',
            providers: {
              alibaba: { apiKey: 'sk-alibaba' },
            },
          },
        },
      },
    });
    expect(ids).toContain('alibaba');
    expect(ids).not.toContain('openai');
  });

  it('does not include TTS provider keys without credentials', () => {
    const ids = collectConfiguredProviderIds({
      messages: {
        tts: {
          enabled: true,
          provider: 'openai',
          providers: { openai: {} },
        },
      },
    });
    expect(ids ?? []).not.toContain('openai');
  });

  it('includes LLM/image providers configured only via env vars', () => {
    const prev = process.env.DASHSCOPE_API_KEY;
    process.env.DASHSCOPE_API_KEY = 'sk-test-dashscope';
    try {
      const ids = collectConfiguredProviderIds({});
      expect(ids).toContain('dashscope');
    } finally {
      if (prev === undefined) delete process.env.DASHSCOPE_API_KEY;
      else process.env.DASHSCOPE_API_KEY = prev;
    }
  });
});
