import { describe, expect, it } from 'vitest';

import {
  agentListDisplayDescription,
  agentListDisplayName,
} from '../agent-display-names';
import { messages } from '@/i18n/messages';

describe('agent display names', () => {
  it('localizes every built-in agent from its stable id', () => {
    const en = messages('en').agentsSettings;
    const zh = messages('zh').agentsSettings;
    const agents = [
      ['main', 'Smart Assistant', '智能助手'],
      ['coder', 'Coding Expert', '编程专家'],
      ['writer', 'Writing Assistant', '写作助手'],
      ['researcher', 'Research Assistant', '研究助手'],
      ['data-analyst', 'Data Analyst', '数据分析师'],
      ['creative', 'Creative Assistant', '创意助手'],
    ] as const;

    for (const [id, enName, zhName] of agents) {
      expect(agentListDisplayName({ id }, en)).toBe(enName);
      expect(agentListDisplayName({ id }, zh)).toBe(zhName);
    }
  });

  it('recognizes legacy seeded names and descriptions', () => {
    const zh = messages('zh').agentsSettings;

    expect(agentListDisplayName({ id: 'main', name: 'Main' }, zh)).toBe('智能助手');
    expect(agentListDisplayName({ id: 'coder', name: 'Coder' }, zh)).toBe('编程专家');
    expect(
      agentListDisplayDescription(
        {
          id: 'coder',
          description:
            'Software engineering agent for repository understanding, implementation, debugging, refactoring, tests, and review.',
        },
        zh,
      ),
    ).toBe('编写、调试、重构和测试软件。');
  });

  it('preserves customized and unknown agent presentations', () => {
    const en = messages('en').agentsSettings;

    expect(agentListDisplayName({ id: 'coder', name: 'Pair Programmer' }, en)).toBe('Pair Programmer');
    expect(agentListDisplayDescription({ id: 'coder', description: 'Knows our monorepo.' }, en)).toBe(
      'Knows our monorepo.',
    );
    expect(agentListDisplayName({ id: 'ops' }, en)).toBe('ops');
    expect(agentListDisplayDescription({ id: 'ops' }, en)).toBe('');
  });
});
