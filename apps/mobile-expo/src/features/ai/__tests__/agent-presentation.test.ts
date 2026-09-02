import { describe, expect, it } from 'vitest';

import { en } from '../../../i18n/locales/en';
import { zh } from '../../../i18n/locales/zh';
import { agentDisplayDescription, agentDisplayName } from '../agent-presentation';

describe('agent presentation', () => {
  it('localizes shipped Agent defaults from their stable IDs', () => {
    const agent = {
      id: 'coder',
      name: 'Coding Expert',
      description: 'Software development, debugging, refactoring, and tests.',
    };

    expect(agentDisplayName(agent, zh.agentsPage)).toBe('编程专家');
    expect(agentDisplayDescription(agent, zh.agentsPage)).toBe('编写、调试、重构和测试软件。');
    expect(agentDisplayName(agent, en.agentsPage)).toBe('Coding Expert');
  });

  it('preserves user-authored names and descriptions', () => {
    const agent = {
      id: 'main',
      name: '小竹',
      description: '只处理我的个人事务。',
    };

    expect(agentDisplayName(agent, zh.agentsPage)).toBe('小竹');
    expect(agentDisplayDescription(agent, zh.agentsPage)).toBe('只处理我的个人事务。');
  });

  it('uses localized defaults when an older built-in profile has no presentation text', () => {
    expect(agentDisplayName({ id: 'researcher' }, zh.agentsPage)).toBe('研究助手');
    expect(agentDisplayDescription({ id: 'researcher' }, zh.agentsPage)).toBe(
      '研究主题、比较来源并综合结论。',
    );
  });
});
