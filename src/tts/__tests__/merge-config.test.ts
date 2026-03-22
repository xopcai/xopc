import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mergeTtsConfigFromAppConfig, appendTtsReadinessNote } from '../merge-config.js';
import type { Config } from '../../config/schema.js';

describe('mergeTtsConfigFromAppConfig', () => {
  it('fills defaults when tts is undefined', () => {
    const merged = mergeTtsConfigFromAppConfig(undefined);
    expect(merged.provider).toBe('openai');
    expect(merged.openai?.model).toBe('tts-1');
    expect(merged.fallback?.order?.length).toBeGreaterThan(0);
  });

  it('preserves explicit provider and nested openai fields', () => {
    const merged = mergeTtsConfigFromAppConfig({
      enabled: true,
      provider: 'alibaba',
      alibaba: { model: 'qwen-tts', voice: 'Cherry' },
    });
    expect(merged.provider).toBe('alibaba');
    expect(merged.alibaba?.model).toBe('qwen-tts');
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
      tts: {
        enabled: true,
        provider: 'openai' as const,
        trigger: 'always' as const,
        edge: { enabled: false },
        fallback: { enabled: false, order: [] as ('openai' | 'alibaba' | 'edge')[] },
      },
    } as unknown as Config;

    const out = appendTtsReadinessNote('✅ TTS enabled.', cfg);
    expect(out).toContain('✅ TTS enabled.');
    expect(out).toContain('TTS is on, but no provider can run yet');
  });

  it('does not append when TTS disabled', () => {
    const cfg = { tts: { enabled: false } } as unknown as Config;
    expect(appendTtsReadinessNote('Done', cfg)).toBe('Done');
  });
});
