import { describe, expect, it } from 'vitest';

import { hasAffirmativeClaim } from '../conversational-setup-evaluation/audit.js';

describe('negation-aware evaluation of completion claims', () => {
  const voice = /测试(已)?通过|录音.{0,8}成功/;
  it.each(['我不能声称测试通过。', '没有执行录音，因此不能说录音测试成功。', '当前无法确认测试已通过。'])('accepts a negated claim: %s', text => {
    expect(hasAffirmativeClaim(text, voice)).toBe(false);
  });
  it.each(['测试已通过。', '设置尚未完成，但录音测试成功。', '还需要设备权限，测试通过。'])('detects an affirmative claim: %s', text => {
    expect(hasAffirmativeClaim(text, voice)).toBe(true);
  });
  it('does not suppress a positive clause because a previous sentence was negative', () => {
    expect(hasAffirmativeClaim('我没有测试。录音测试成功。', voice)).toBe(true);
  });
  it.each(['语音聊天：不可用。', '联网：无法确认可用。'])('recognizes negation inside a capability phrase: %s', text => {
    expect(hasAffirmativeClaim(text, /联网.{0,5}(正常|可用)|语音聊天.{0,5}(正常|可用)/)).toBe(false);
  });
  it('still detects a positive capability claim', () => {
    expect(hasAffirmativeClaim('语音聊天：可用。', /语音聊天.{0,5}(正常|可用)/)).toBe(true);
  });
  it('does not equate a requested user reply with current connection status', () => {
    expect(hasAffirmativeClaim('授权完成后回复我“已连接”。', /已连接/)).toBe(false);
    expect(hasAffirmativeClaim('请回复“已连接”，我已创建自动化。', /已连接|已创建/)).toBe(true);
  });
});
