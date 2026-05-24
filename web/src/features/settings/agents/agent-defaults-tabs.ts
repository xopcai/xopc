/** Internal tabs for the merged agent defaults settings page. */
export type AgentDefaultsTabId =
  | 'chat'
  | 'workspace'
  | 'browser'
  | 'runtime'
  | 'tools'
  | 'skills'
  | 'system-prompt';

export const AGENT_DEFAULTS_TABS: readonly AgentDefaultsTabId[] = [
  'chat',
  'workspace',
  'browser',
  'runtime',
  'tools',
  'skills',
  'system-prompt',
] as const;

/** Legacy `/settings/agent-*` section ids → tab id (bookmark redirects). */
export const LEGACY_AGENT_DEFAULTS_SECTION_TO_TAB: Record<string, AgentDefaultsTabId> = {
  'agent-chat': 'chat',
  'agent-workspace': 'workspace',
  'agent-browser': 'browser',
  'agent-runtime': 'runtime',
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

export function agentDefaultsTabSearchParam(tab: AgentDefaultsTabId): string {
  return tab === 'chat' ? '' : tab;
}
