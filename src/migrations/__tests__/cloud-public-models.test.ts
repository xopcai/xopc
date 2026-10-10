import { describe, expect, it } from 'vitest';
import { migrateCloudModelFields, migrateCloudModelRef } from '../cloud-public-models.js';

describe('cloud public model migration', () => {
  it('preserves public products, Codex and third-party choices', () => {
    for (const ref of ['xopc-cloud/advanced', 'xopc-cloud/auto', 'xopc-cloud/openai-codex/gpt-5', 'openai/gpt-5']) expect(migrateCloudModelRef(ref)).toBe(ref);
    expect(migrateCloudModelRef('xopc-cloud/deepseek-v4-flash')).toBe('xopc-cloud/auto');
  });
  it('preserves the dedicated Computer Use service across old references', () => {
    expect(migrateCloudModelRef('xopc-cloud/computer-gui-plus-preview')).toBe('xopc-cloud/computer');
    expect(migrateCloudModelFields({models:{computerUse:{primary:'xopc-cloud/computer-gui-plus-preview',fallbacks:['xopc-cloud/gui-plus-2026-02-26']}},prompt:'xopc-cloud/computer-gui-plus-preview'})).toEqual({models:{computerUse:{primary:'xopc-cloud/computer',fallbacks:[]}},prompt:'xopc-cloud/computer-gui-plus-preview'});
    expect(migrateCloudModelRef('dashscope-cn/gui-plus-2026-02-26')).toBe('dashscope-cn/gui-plus-2026-02-26');
  });
  it('migrates routes and audio settings without changing prompts or other providers', () => {
    const old = { models: { chat: { primary: 'xopc-cloud/deepseek-v4-flash', fallbacks: ['xopc-cloud/glm-5', 'xopc-cloud/deepseek-v4-flash', 'openai/gpt-5'] }, imageGeneration: { primary: 'xopc-cloud/image-01' } }, stt: { providers: { 'xopc-cloud': { model: 'qwen-asr' } } }, tts: { provider: 'xopc-cloud', providers: { 'xopc-cloud': { model: 'qwen-tts', voice: 'Cherry' }, openai: { model: 'tts-1', voice: 'alloy' } } }, omni: { provider: 'xopc-cloud', model: 'qwen3-omni-flash-realtime', voice: 'Cherry' }, prompt: 'xopc-cloud/glm-5' };
    const next = migrateCloudModelFields(old) as typeof old;
    expect(next.models.chat).toEqual({ primary: 'xopc-cloud/auto', fallbacks: ['openai/gpt-5'] });
    expect(next.models.imageGeneration.primary).toBe('xopc-cloud/image');
    expect(next.stt.providers['xopc-cloud'].model).toBe('stt');
    expect(next.tts.providers['xopc-cloud']).toEqual({ model: 'tts', voice: 'default' });
    expect(next.tts.providers.openai).toEqual(old.tts.providers.openai);
    expect(next.omni).toEqual({ provider: 'xopc-cloud', model: 'realtime', voice: 'default' });
    expect(next.prompt).toBe(old.prompt);
    expect(migrateCloudModelFields(next)).toEqual(next);
  });
});
