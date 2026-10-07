import { describe, expect, it } from 'vitest';
import { alibabaVoicesForModel } from '../providers/alibaba-voices.js';

describe('DashScope voice catalog', () => {
  it('includes selection metadata and respects model voice sets', () => {
    expect(alibabaVoicesForModel('qwen-tts').map(voice => voice.id)).toEqual(['Cherry', 'Serena', 'Ethan', 'Chelsie']);
    expect(alibabaVoicesForModel('qwen3-tts-flash').find(voice => voice.id === 'Ryan')).toMatchObject({ gender: 'male', category: '戏剧感' });
    expect(alibabaVoicesForModel('qwen3-tts-instruct-flash').some(voice => voice.id === 'Ryan')).toBe(false);
  });
});
