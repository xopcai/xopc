import { describe, expect, it } from 'vitest';
import { implicitMemoryClaimCorrection } from '../memory-claim-grounding.js';

const preference = '我长期偏好先给结论再列证据。请只回复收到。';
describe('implicit learning acknowledgements', () => {
  it.each(['已把这条偏好和这个习惯写进用户偏好里了，以后会按这个来。', '已经记住了你的偏好。', "I've saved this preference to memory."])(
    'requires a real current-turn receipt: %s', answer => {
      expect(implicitMemoryClaimCorrection(preference, answer, [])).toContain('no successful usable memory-write receipt');
      expect(implicitMemoryClaimCorrection(preference, answer, [{ role: 'toolResult', toolName: 'user_context_read', details: { status: 'saved', usable: true } }])).toBeDefined();
      expect(implicitMemoryClaimCorrection(preference, answer, [{ role: 'toolResult', toolName: 'personal_memory', details: { status: 'saved', usable: false } }])).toBeDefined();
      expect(implicitMemoryClaimCorrection(preference, answer, [{ role: 'toolResult', toolName: 'personal_memory', details: { status: 'saved', usable: true } }])).toBeUndefined();
    });
  it.each(['收到。', '尚未确认写入记忆，这里先按这个偏好回答。', "I haven't saved this preference to memory."])(
    'accepts a truthful acknowledgement: %s', answer => expect(implicitMemoryClaimCorrection(preference, answer, [])).toBeUndefined());
  it('leaves explicit commands and unrelated work acknowledgements to their existing receipt paths', () => {
    expect(implicitMemoryClaimCorrection('记住我喜欢简洁回答。', '已记住。', [])).toBeUndefined();
    expect(implicitMemoryClaimCorrection('请保存这个文件。', "I've saved this profile.", [])).toBeUndefined();
  });
});
