import { describe, expect, it } from 'vitest';

import {
  agentListDisplayDescription,
  agentListDisplayName,
} from '../agent-display-names';
import { messages } from '@/i18n/messages';

describe('agent display names', () => {
  it.each([
    { id: 'main', name: 'Smart Assistant', description: 'General-purpose personal assistant.' },
    { id: 'conductor', name: 'Conductor', description: 'User-facing coordination Agent for task planning, delegation, progress, verification, and reporting to the user.' },
    { id: 'coder', name: 'Coding Expert', description: 'Software engineering agent for repository understanding, implementation, debugging, refactoring, tests, and review.' },
    { id: 'writer', name: 'Writing Assistant', description: 'Drafting, editing, rewriting, and audience-aware content.' },
    { id: 'researcher', name: 'Research Assistant', description: 'Deep research, source comparison, and fact synthesis.' },
    { id: 'data-analyst', name: 'Data Analyst', description: 'Data cleaning, analysis, visualization, and reproducible reports.' },
    { id: 'creative', name: 'Creative Assistant', description: 'Visual direction, image prompts, design critique, and creative options.' },
    { id: 'task-router', name: 'Task Router', description: 'Selects one suitable specialist for a delegated task.' },
  ])('covers the shipped $id name and description in both locales', (agent) => {
    const profile = agent;
    const en = messages('en').agentsSettings;
    const zh = messages('zh').agentsSettings;
    const translations = Object.values(zh.builtInAgents);

    expect(translations.some((entry) => entry.name === agentListDisplayName(profile, zh))).toBe(true);
    expect(translations.some((entry) => entry.description === agentListDisplayDescription(profile, zh))).toBe(true);
    expect(Object.values(en.builtInAgents).some((entry) => entry.name === agentListDisplayName(profile, en))).toBe(true);
    expect(Object.values(en.builtInAgents).some((entry) => entry.description === agentListDisplayDescription(profile, en))).toBe(true);
    const customized = { id: agent.id, name: 'My agent', description: 'My own description.' };
    expect(agentListDisplayName(customized, zh)).toBe(customized.name);
    expect(agentListDisplayDescription(customized, zh)).toBe(customized.description);
  });

  it('localizes every built-in agent from its stable id', () => {
    const en = messages('en').agentsSettings;
    const zh = messages('zh').agentsSettings;
    const agents = [
      ['main', 'Smart Assistant', '智能助手'],
      ['conductor', 'Conductor', '指挥家'],
      ['task-router', 'Task Router', '任务调度员'],
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
    const en = messages('en').agentsSettings;
    const zh = messages('zh').agentsSettings;

    expect(agentListDisplayName({ id: 'main', name: 'Main' }, zh)).toBe('智能助手');
    expect(agentListDisplayName({ id: 'coder', name: 'Coder' }, zh)).toBe('编程专家');
    expect(agentListDisplayName({ id: 'conductor', name: 'Conductor' }, zh)).toBe('指挥家');
    expect(agentListDisplayDescription({ id: 'conductor' }, zh)).toBe(
      '与你保持对话，安排专长智能体协作，并在有进展时告诉你。',
    );
    expect(agentListDisplayDescription({ id: 'conductor' }, en)).toBe(
      'Coordinates specialist agents and keeps you updated as work progresses.',
    );
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

  it('localizes the personal agent default description while preserving its chosen name and custom text', () => {
    const en = messages('en').agentsSettings;
    const zh = messages('zh').agentsSettings;
    const agent = {
      id: 'personal-a1b2c3d4e5f6',
      name: 'Ada',
      description: 'A personal AI that adapts its responses to the user and coordinates work.',
    };

    expect(agentListDisplayDescription(agent, en)).toBe(en.listPersonalAgentDescription);
    expect(agentListDisplayDescription(agent, zh)).toBe('了解你的交流偏好，为你提供贴合需求的回应，并协调各项工作。');
    expect(agentListDisplayDescription({ id: agent.id }, zh)).toBe(zh.listPersonalAgentDescription);
    expect(agentListDisplayName(agent, zh)).toBe('Ada');
    expect(agentListDisplayDescription({ ...agent, description: 'My custom assistant.' }, zh)).toBe('My custom assistant.');
    expect(agentListDisplayDescription({ ...agent, id: 'custom-agent' }, zh)).toBe(agent.description);
  });

  it('localizes the seeded Task Router profile and preserves customizations', () => {
    const agent = {
      id: 'task-router',
      name: 'Task Router',
      description: 'Selects one suitable specialist for a delegated task.',
    };
    const en = messages('en').agentsSettings;
    const zh = messages('zh').agentsSettings;

    expect(agentListDisplayName(agent, zh)).toBe('任务调度员');
    expect(agentListDisplayDescription(agent, zh)).toBe('为委派的任务选择合适的专长智能体。');
    expect(agentListDisplayName(agent, en)).toBe(agent.name);
    expect(agentListDisplayDescription(agent, en)).toBe(agent.description);
    expect(agentListDisplayName({ ...agent, name: 'My Router' }, zh)).toBe('My Router');
    expect(agentListDisplayDescription({ ...agent, description: 'My routing rules.' }, zh)).toBe('My routing rules.');
  });

  it('preserves customized and unknown agent presentations', () => {
    const en = messages('en').agentsSettings;

    expect(agentListDisplayName({ id: 'coder', name: 'Pair Programmer' }, en)).toBe('Pair Programmer');
    expect(agentListDisplayDescription({ id: 'coder', description: 'Knows our monorepo.' }, en)).toBe(
      'Knows our monorepo.',
    );
    expect(agentListDisplayName({ id: 'conductor', name: 'My Coordinator' }, en)).toBe('My Coordinator');
    expect(agentListDisplayDescription({ id: 'conductor', description: 'My description.' }, en)).toBe('My description.');
    expect(agentListDisplayName({ id: 'ops' }, en)).toBe('ops');
    expect(agentListDisplayDescription({ id: 'ops' }, en)).toBe('');
  });
});
