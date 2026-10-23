import { describe, expect, it } from 'vitest';
import { ConfigSchema } from '../../../../config/schema.js';
import { applyMiscPatch } from '../config-patch/misc.js';

describe('scoped voice capability patches', () => {
  it('preserves real-time preferences when recorded recognition changes language', async () => {
    const config = ConfigSchema.parse({ voice: { language: 'en', realtime: { silenceDurationMs: 2000, bargeIn: false } } });
    const realtime = structuredClone(config.voice!.realtime);
    await applyMiscPatch(config, { voice: { language: 'zh', languageMode: 'manual' } });
    expect(config.voice!.language).toBe('zh');
    expect(config.voice!.realtime).toEqual(realtime);
  });
  it('preserves input settings when the conversation engine is changed', async () => {
    const config = ConfigSchema.parse({ voice: { language: 'en', input: { refinement: { mode: 'punctuation' } }, realtime: { silenceDurationMs: 2000 } } });
    const input = structuredClone(config.voice!.input);
    await applyMiscPatch(config, { voice: { realtime: { ...config.voice!.realtime, enabled: true } } });
    expect(config.voice!.language).toBe('en');
    expect(config.voice!.input).toEqual(input);
    expect(config.voice!.realtime.silenceDurationMs).toBe(2000);
    expect(config.voice!.realtime.enabled).toBe(true);
    expect(await applyMiscPatch(config, {voice: 'invalid'})).toMatchObject({ok:false});
  });
});

it('saves recognition text processing without changing the selected conversation route', async () => {
  const config = ConfigSchema.parse({ voice: { realtime: { defaultEngine: 'agent', silenceDurationMs: 2000 } } });
  const conversation = structuredClone(config.voice!.realtime);
  await applyMiscPatch(config, { voice: { input: { refinement: { mode: 'punctuation' } } } });
  expect(config.voice!.input.refinement.mode).toBe('punctuation');
  expect(config.voice!.realtime).toEqual(conversation);
});
