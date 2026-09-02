import type { MessageBundle } from '../../i18n/messages';

type AgentMessages = MessageBundle['agentsPage'];
type BuiltInAgentMessages = AgentMessages['builtInAgents'];
type BuiltInAgentKey = keyof BuiltInAgentMessages;

type BuiltInAgentPresentation = {
  key: BuiltInAgentKey;
  defaultNames: readonly string[];
  defaultDescriptions: readonly string[];
};

const BUILT_IN_AGENT_PRESENTATIONS: Readonly<Record<string, BuiltInAgentPresentation>> = {
  main: {
    key: 'assistant',
    defaultNames: ['main', 'Main', 'Smart Assistant'],
    defaultDescriptions: [
      'General assistant',
      'General-purpose personal assistant.',
      'Your personal intelligent assistant for answering questions, handling everyday tasks, and chatting with you anytime.',
    ],
  },
  coder: {
    key: 'coding',
    defaultNames: ['coder', 'Coder', 'Coding Expert'],
    defaultDescriptions: [
      'Software development, debugging, refactoring, and tests.',
      'Software engineering agent for repository understanding, implementation, debugging, refactoring, tests, and review.',
    ],
  },
  writer: {
    key: 'writing',
    defaultNames: ['writer', 'Writer', 'Writing Assistant'],
    defaultDescriptions: ['Drafting, editing, rewriting, and audience-aware content.'],
  },
  researcher: {
    key: 'research',
    defaultNames: ['researcher', 'Researcher', 'Research Assistant'],
    defaultDescriptions: ['Deep research, source comparison, and fact synthesis.'],
  },
  'data-analyst': {
    key: 'data',
    defaultNames: ['data-analyst', 'Data Analyst'],
    defaultDescriptions: ['Data cleaning, analysis, visualization, and reproducible reports.'],
  },
  creative: {
    key: 'creative',
    defaultNames: ['creative', 'Creative', 'Creative Assistant'],
    defaultDescriptions: ['Visual direction, image prompts, design critique, and creative options.'],
  },
};

function normalized(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

function isDefaultValue(value: string | undefined, defaults: readonly string[]): boolean {
  const normalizedValue = normalized(value);
  return Boolean(normalizedValue)
    && defaults.some((candidate) => normalized(candidate) === normalizedValue);
}

function presentationFor(agentId: string): BuiltInAgentPresentation | undefined {
  return BUILT_IN_AGENT_PRESENTATIONS[normalized(agentId)];
}

/** Translate shipped Agent defaults while preserving every user-authored value. */
export function agentDisplayName(
  agent: { id: string; name?: string },
  messages: AgentMessages,
): string {
  const name = agent.name?.trim();
  const presentation = presentationFor(agent.id);
  if (presentation && (!name || isDefaultValue(name, presentation.defaultNames))) {
    return messages.builtInAgents[presentation.key].name;
  }
  return name || agent.id;
}

/** Translate shipped Agent descriptions while preserving every user-authored value. */
export function agentDisplayDescription(
  agent: { id: string; description?: string },
  messages: AgentMessages,
): string {
  const description = agent.description?.trim();
  const presentation = presentationFor(agent.id);
  if (presentation && (!description || isDefaultValue(description, presentation.defaultDescriptions))) {
    return messages.builtInAgents[presentation.key].description;
  }
  return description || '';
}
