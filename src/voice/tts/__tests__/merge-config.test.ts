import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mergeTtsConfigFromAppConfig, appendTtsReadinessNote } from '../merge-config.js';
import type { Config } from '../../../config/schema.js';

describe('mergeTtsConfigFromAppConfig', () => {
  it('fills defaults when tts is undefined', () => {
    const merged = mergeTtsConfigFromAppConfig(undefined);
    expect(merged.provider).toBe('edge');
    expect(merged.providers?.openai?.model).toBe('tts-1');
    expect(merged.fallback?.order?.length).toBeGreaterThan(0);
  });

  it('preserves explicit provider and nested provider fields', () => {
    const merged = mergeTtsConfigFromAppConfig({
      enabled: true,
      provider: 'alibaba',
      providers: { alibaba: { model: 'qwen-tts', voice: 'Cherry' } },
    });
    expect(merged.provider).toBe('alibaba');
    expect(merged.providers?.alibaba?.model).toBe('qwen-tts');
  });

  it('merges provider defaults with caller overrides', () => {
    const merged = mergeTtsConfigFromAppConfig({
      providers: { minimax: { voice: 'female-shaonv' } },
    });
    expect(merged.providers?.minimax?.model).toBe('speech-2.8-hd');
    expect(merged.providers?.minimax?.voice).toBe('female-shaonv');
  });

  it('merges providers map entries for extension providers', () => {
    const merged = mergeTtsConfigFromAppConfig({
      provider: 'tts-local-cli',
      providers: {
        'tts-local-cli': { command: 'piper --text {{Text}}', outputFormat: 'wav' },
      },
    });
    expect(merged.provider).toBe('tts-local-cli');
    expect(merged.providers?.['tts-local-cli']).toEqual({
      command: 'piper --text {{Text}}',
      outputFormat: 'wav',
    });
  });
});

describe('appendTtsReadinessNote', () => {
  const prevOpenai = process.env.OPENAI_API_KEY;
  const prevDash = process.env.DASHSCOPE_API_KEY;

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.DASHSCOPE_API_KEY;
  });

  afterEach(() => {
    if (prevOpenai !== undefined) process.env.OPENAI_API_KEY = prevOpenai;
    else delete process.env.OPENAI_API_KEY;
    if (prevDash !== undefined) process.env.DASHSCOPE_API_KEY = prevDash;
    else delete process.env.DASHSCOPE_API_KEY;
  });

  it('appends setup hint when TTS enabled but no provider works', () => {
    const cfg = {
      messages: {
        tts: {
          enabled: true,
          provider: 'openai' as const,
          trigger: 'always' as const,
          providers: { edge: { enabled: false } },
          fallback: { enabled: false, order: [] as string[] },
        },
      },
    } as unknown as Config;

    const out = appendTtsReadinessNote('✅ TTS enabled.', cfg);
    expect(out).toContain('✅ TTS enabled.');
    expect(out).toContain('TTS is on, but no provider can run yet');
  });

  it('does not append when TTS disabled', () => {
    // Schema v2: messages.tts (was top-level `tts`).
    const cfg = { messages: { tts: { enabled: false } } } as unknown as Config;
    expect(appendTtsReadinessNote('Done', cfg)).toBe('Done');
  });
});
