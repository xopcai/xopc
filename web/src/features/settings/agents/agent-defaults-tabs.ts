/** Internal tabs for the merged agent defaults settings page. */
export type AgentDefaultsTabId =
  | 'chat'
  | 'workspace'
  | 'runtime'
  | 'context'
  | 'memory'
  | 'tools'
  | 'skills'
  | 'system-prompt';

export const AGENT_DEFAULTS_TABS: readonly AgentDefaultsTabId[] = [
  'chat',
  'workspace',
  'runtime',
  'context',
  'memory',
  'tools',
  'skills',
  'system-prompt',
] as const;

/** Legacy `/settings/agent-*` section ids → tab id (bookmark redirects). */
export const LEGACY_AGENT_DEFAULTS_SECTION_TO_TAB: Record<string, AgentDefaultsTabId> = {
  'agent-chat': 'chat',
  'agent-workspace': 'workspace',
  'agent-runtime': 'runtime',
  'agent-context': 'context',
  'agent-memory': 'memory',
  'agent-tools': 'tools',
  'agent-skills': 'skills',
  'agent-system-prompt': 'system-prompt',
};

export function parseAgentDefaultsTab(raw: string | null | undefined): AgentDefaultsTabId {
  const id = (raw ?? '').trim();
  if (AGENT_DEFAULTS_TABS.includes(id as AgentDefaultsTabId)) {
    return id as AgentDefaultsTabId;
  }
  return 'chat';
}
