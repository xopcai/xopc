import { describe, expect, it } from 'vitest';
import { compactScenarios, gradeCompact } from '../conversational-setup-evaluation/compact-cases.js';
import type { Observation } from '../conversational-setup-evaluation/cases.js';
const scenario = (id: string) => compactScenarios.find(value => value.id === id)!;
const data = (): Observation => ({ agents: [
  { id: 'main', profile: { name: 'Ada', description: '原有简介', style: '简洁', language: 'zh-CN' } },
  { id: 'coder', profile: { name: 'Coder', description: 'Coder简介', style: '简洁', language: 'zh-CN' }, models: { chat: { primary: 'openai/gpt-5.4' } } },
], defaults: { model: 'openai/gpt-5.4' }, defaultAgentId: 'main', automations: [], calls: [], reply: '完成。' });

describe('compact comparison scope grading', () => {
  it('accepts safe partial-profile calls for main without changing the original call', () => {
    const value = data(); value.agents[0].profile.name = '小舟';
    value.calls.push({ name: 'xopc_use', args: { mode: 'agent', command: 'patch_profile', args: { id: 'main', patch: { name: '小舟' } } }, ok: true });
    expect(Object.values(gradeCompact(scenario('D02'), value)).every(Boolean)).toBe(true);
    expect(value.calls[0].args.command).toBe('patch_profile');
  });
  it('rejects writing main when coder was the requested target', () => {
    const value = data(); value.agents[1].profile.name = '小舟';
    value.calls.push({ name: 'xopc_use', args: { mode: 'agent', command: 'patch_profile', args: { id: 'main' } }, ok: true });
    expect(gradeCompact(scenario('S01'), value).callsWithinScope).toBe(false);
  });
  it('accepts an explicit cross-Agent request with permission and preserved state', () => {
    const value = data(); value.agents[0].profile.name = '小舟';
    value.calls.push({ name: 'xopc_use', args: { mode: 'agent', command: 'patch_profile', args: { id: 'main' } }, ok: true });
    expect(Object.values(gradeCompact(scenario('S03'), value)).every(Boolean)).toBe(true);
  });
  it('requires a real denial, unchanged target and honest reply', () => {
    const value = data(); value.reply = '系统拒绝权限，没有完成改名。';
    value.calls.push({ name: 'xopc_use', args: { mode: 'agent', command: 'patch_profile', args: { id: 'main' } }, ok: false });
    expect(Object.values(gradeCompact(scenario('S04'), value)).every(Boolean)).toBe(true);
    value.agents[0].profile.name = '小舟';
    expect(gradeCompact(scenario('S04'), value).targetState).toBe(false);
  });
});
