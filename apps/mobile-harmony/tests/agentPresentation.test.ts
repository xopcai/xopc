import { expect, it, vi } from 'vitest';
import { agentDisplayDescription, agentDisplayName } from '../entry/src/main/ets/common/agentPresentation.ets';

vi.stubGlobal('$r', (key: string) => key);

it('uses locale resources for built-in defaults and preserves user edits', () => {
  expect(agentDisplayName({ id: 'coder', name: 'Coder' })).toBe('app.string.agent_builtin_coding_name');
  expect(agentDisplayDescription({ id: 'researcher', description: 'Deep research, source comparison, and fact synthesis.' }))
    .toBe('app.string.agent_builtin_research_description');
  expect(agentDisplayName({ id: 'coder', name: '我的代码伙伴' })).toBe('我的代码伙伴');
  expect(agentDisplayDescription({ id: 'writer', description: 'Short stories in Cantonese' }))
    .toBe('Short stories in Cantonese');
});

it('preserves the Personal Agent name and translates only its standard description', () => {
  const agent = { id: 'personal-012345abcdef', name: 'Ada' };
  expect(agentDisplayName(agent)).toBe('Ada');
  expect(agentDisplayDescription(agent)).toBe('app.string.agent_personal_description');
  expect(agentDisplayDescription({ ...agent, description: 'My own description' })).toBe('My own description');
  expect(agentDisplayName({ id: 'custom-agent' })).toBe('custom-agent');
});
