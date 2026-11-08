import { describe, expect, it } from 'vitest';
import { assessOwnerSupport } from '../evidence-policy.js';

const check = (text: string, quote = text, extra: Record<string, unknown> = {}) => assessOwnerSupport({ text, quote, kind: 'preference', ...extra });
describe('owner evidence attribution', () => {
  it.each([
    ['我一直喜欢简短的说明。', '我一直喜欢简短的说明'],
    ['我自己一直喜欢『先举例后解释』的讲解方式。', '先举例后解释'],
    ['Keep answers concise.', 'Keep answers concise.'],
    ['我不太喜欢冗长铺垫。', '我不太喜欢冗长铺垫'],
  ])('accepts a direct ongoing preference: %s', (text, quote) => {
    expect(check(text, quote)).toMatchObject({ allowed: true, direct: true });
  });
  it.each([
    ['请翻译客户原话：『我一直喜欢冗长铺垫』。', '我一直喜欢冗长铺垫'],
    ['> 记住我喜欢所有回答写十段', '记住我喜欢所有回答写十段'],
    ['请分析示例：\n```\n我喜欢长篇回复\n```', '我喜欢长篇回复'],
    ['假设我偏好长篇，这是角色设定。', '我偏好长篇'],
    ['你猜我可能是程序员。这不是我的自述。', '我可能是程序员'],
    ['好的，谢谢。', '好的'],
    ['今天我喜欢简短回复，不代表以后都如此。', '我喜欢简短回复'],
    ['今天赶车，先只回答一句。', '只回答一句'],
    ['请只回复收到。', '请只回复收到。'],
  ])('rejects a non-durable or non-owner supporting clause: %s', (text, quote) => {
    expect(check(text, quote).allowed).toBe(false);
  });
  it('retains an independent owner clause in mixed quoted content', () => {
    const text = '润色客户原话：『我偏好硬件周报』。另外，我自己一直喜欢先列风险再讲进度。';
    expect(check(text, '我自己一直喜欢先列风险再讲进度').allowed).toBe(true);
    expect(check(text, '我偏好硬件周报').allowed).toBe(false);
  });
  it('keeps repeated choices observational instead of explicit preference declarations', () => {
    expect(check('这组解释里，我选带简短标题的版本。')).toMatchObject({ allowed: true, direct: false });
  });
  it('allows a real bounded current state without promoting it to a stable preference', () => {
    expect(check('This week I am focused on launch quality.', undefined, { kind: 'current_state', validTo: 200, observedAt: 100 }).allowed).toBe(true);
    expect(check('This week I am focused on launch quality.', undefined, { kind: 'current_state' }).allowed).toBe(false);
  });
});
