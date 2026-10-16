import { describe, expect, it } from 'vitest';
import { ConfigSchema } from '../../../../config/schema.js';
import { applyMiscPatch } from '../config-patch/misc.js';

describe('scoped voice capability patches', () => {
  it('preserves real-time preferences when recorded recognition changes language', async () => {
    const config = ConfigSchema.parse({ voice: { language: 'en', realtime: { silenceDurationMs: 2000, bargeIn: false } } });
    const realtime = structuredClone(config.voice!.realtime);
    await applyMiscPatch(config, { voicePatchMode: 'merge', voice: { language: 'zh', languageMode: 'manual' } });
    expect(config.voice!.language).toBe('zh');
    expect(config.voice!.realtime).toEqual(realtime);
  });
  it.each(['legacy', 'conversation'])('clears removed streaming selections in a full %s snapshot', async scope => {
    const config = ConfigSchema.parse({ voice: { realtime: { stt: { provider: 'xopc-cloud', model: 'old-stream' }, tts: { provider: 'xopc-cloud', model: 'old-output' } } } });
    const voice = structuredClone(config.voice!);
    delete voice.realtime.stt;
    delete voice.realtime.tts;
    voice.realtime.defaultEngine = 'omni';
    await applyMiscPatch(config, { ...(scope === 'conversation' ? { voicePatchMode: 'merge' } : {}), voice: scope === 'legacy' ? voice : { realtime: voice.realtime } });
    expect(config.voice!.realtime).not.toHaveProperty('stt');
    expect(config.voice!.realtime).not.toHaveProperty('tts');
    expect(config.voice!.realtime.defaultEngine).toBe('omni');
  });
  it('retains legacy sparse snapshot replacement semantics', async () => {
    const config = ConfigSchema.parse({ voice: { language: 'en', realtime: { stt: { provider: 'xopc-cloud', model: 'old-stream' }, silenceDurationMs: 2000 } } });
    await applyMiscPatch(config, { voice: { language: 'zh', realtime: { enabled: true } } });
    expect(config.voice!.realtime).not.toHaveProperty('stt');
    expect(config.voice!.realtime.silenceDurationMs).toBe(1200);
  });
  it('preserves input settings when the conversation engine is changed', async () => {
    const config = ConfigSchema.parse({ voice: { language: 'en', input: { refinement: { mode: 'punctuation' } }, realtime: { silenceDurationMs: 2000 } } });
    const input = structuredClone(config.voice!.input);
    await applyMiscPatch(config, { voicePatchMode: 'merge', voice: { realtime: { ...config.voice!.realtime, enabled: true } } });
    expect(config.voice!.language).toBe('en');
    expect(config.voice!.input).toEqual(input);
    expect(config.voice!.realtime.silenceDurationMs).toBe(2000);
    expect(config.voice!.realtime.enabled).toBe(true);
    expect(await applyMiscPatch(config, {voice: 'invalid'})).toMatchObject({ok:false});
    expect(await applyMiscPatch(config, {voice: {}, voicePatchMode: 'invalid'})).toMatchObject({ok:false});
  });
});

it('saves recognition text processing without changing the selected conversation route', async () => {
  const config = ConfigSchema.parse({ voice: { realtime: { defaultEngine: 'agent', silenceDurationMs: 2000 } } });
  const conversation = structuredClone(config.voice!.realtime);
  await applyMiscPatch(config, { voicePatchMode: 'merge', voice: { input: { refinement: { mode: 'punctuation' } } } });
  expect(config.voice!.input.refinement.mode).toBe('punctuation');
  expect(config.voice!.realtime).toEqual(conversation);
});
