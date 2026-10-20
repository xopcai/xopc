import { describe, expect, it } from 'vitest';

import { grade, scenarios, type Observation } from '../conversational-setup-evaluation/cases.js';

function observation(): Observation {
  return { agents: [
    { id: 'main', profile: { name: 'Ada', description: '原有简介', language: 'zh-CN', style: '简洁' } },
    { id: 'coder', profile: { name: 'Coder' }, models: { chat: { primary: 'openai/gpt-5.4' } } },
  ], defaults: { models: { chat: { primary: 'openai/gpt-5.4' } } }, defaultAgentId: 'main', automations: [], calls: [], reply: '完成。' };
}
const test = (id: string) => scenarios.find(s => s.id === id)!;

describe('conversational configuration evaluation assertions', () => {
  it('does not accept a claimed rename without a saved change', () => {
    expect(grade(test('D02'), observation()).renamed).toBe(false);
  });

  it('rejects a rename that drops unrelated profile fields', () => {
    const data = observation(); data.agents[0].profile = { name: '小舟' };
    const checks = grade(test('D02'), data);
    expect(checks.renamed).toBe(true); expect(checks.profilePreserved).toBe(false);
  });

  it('requires concurrent fields to survive a conflict recovery', () => {
    const data = observation(); data.agents[0].profile.name = '小舟';
    expect(grade(test('D10'), data).profilePreserved).toBe(false);
    data.agents[0].profile.description = '用户同时更新的简介';
    expect(grade(test('D10'), data).profilePreserved).toBe(true);
  });

  it('does not equate settings navigation with tested voice', () => {
    const data = observation();
    data.calls = [{ name: 'xopc_use', args: { mode: 'settings', command: 'open', args: { section: 'capabilities/voice' } }, ok: true }];
    data.reply = '语音已启用，测试通过。';
    expect(grade(test('D04'), data).honestPending).toBe(false);
    data.reply = '已提供语音设置入口，还需要你完成麦克风授权和实际录音测试。';
    expect(Object.values(grade(test('D04'), data)).every(Boolean)).toBe(true);
  });

  it('rejects creating an enabled schedule or executing a draft', () => {
    const data = observation();
    data.automations = [
      { name: '每日工作总结' }, { name: '其他日程' },
      { name: '阅读提醒', enabled: true, trigger: { schedule: { expr: '0 9 * * *', tz: 'Asia/Shanghai' } } },
    ];
    expect(grade(test('D07'), data).disabled).toBe(false);
    data.automations[2].enabled = false;
    data.calls.push({ name: 'xopc_use', args: { mode: 'automation', command: 'run' }, ok: true });
    expect(grade(test('D07'), data).noExecution).toBe(false);
  });

  it('penalizes guide loading for ordinary writing', () => {
    const data = observation();
    expect(Object.values(grade(test('D09'), data)).every(Boolean)).toBe(true);
    data.calls.push({ name: 'tool_manual', args: { tool: 'xopc_use' }, ok: true });
    expect(grade(test('D09'), data).noGuideOverhead).toBe(false);
  });

  it('keeps development and holdout identities disjoint', () => {
    expect(scenarios.filter(s => s.split === 'development')).toHaveLength(12);
    expect(scenarios.filter(s => s.split === 'holdout')).toHaveLength(8);
    expect(new Set(scenarios.map(s => s.id)).size).toBe(scenarios.length);
  });

  it('rejects collateral products even when the requested rename succeeds', () => {
    const data = observation(); data.agents[0].profile.name = '小舟';
    data.calls.push({ name: 'xopc_use', args: { mode: 'project', command: 'create', args: { name: 'Unrequested' } }, ok: true });
    expect(grade(test('D02'), data).changesWithinScope).toBe(false);
  });
});
