import type { AgentsSettingsMessages } from '@/i18n/messages';

type BuiltInAgentMessages = AgentsSettingsMessages['builtInAgents'];
type BuiltInAgentKey = keyof BuiltInAgentMessages;

type BuiltInAgentPresentation = {
  key: BuiltInAgentKey;
  defaultNames: readonly string[];
  defaultDescriptions: readonly string[];
};

/**
 * Stable agent IDs select translation entries. Persisted profile strings are
 * only substituted when they still match a shipped default, so user edits
 * remain literal across locale changes.
 */
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
  return Boolean(normalizedValue) && defaults.some((candidate) => normalized(candidate) === normalizedValue);
}

function presentationFor(agentId: string): BuiltInAgentPresentation | undefined {
  return BUILT_IN_AGENT_PRESENTATIONS[normalized(agentId)];
}

export function agentListDisplayName(
  ag: { id: string; name?: string | undefined },
  agentsMessages: AgentsSettingsMessages,
): string {
  const n = ag.name?.trim();
  const presentation = presentationFor(ag.id);
  if (presentation && (!n || isDefaultValue(n, presentation.defaultNames))) {
    return agentsMessages.builtInAgents[presentation.key].name;
  }
  return n || ag.id;
}

export function agentListDisplayDescription(
  ag: { id: string; description?: string | undefined },
  agentsMessages: AgentsSettingsMessages,
): string {
  const d = ag.description?.trim();
  const presentation = presentationFor(ag.id);
  if (presentation && (!d || isDefaultValue(d, presentation.defaultDescriptions))) {
    return agentsMessages.builtInAgents[presentation.key].description;
  }
  return d || '';
}
