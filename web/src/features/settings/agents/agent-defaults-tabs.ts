/** Internal tabs for the merged agent defaults settings page. */
export type AgentDefaultsTabId =
  | 'model-strategy'
  | 'generation'
  | 'workspace'
  | 'runtime'
  | 'context'
  | 'memory'
  | 'tools'
  | 'skills'
  | 'system-prompt';

export const AGENT_DEFAULTS_TABS: readonly AgentDefaultsTabId[] = [
  'model-strategy',
  'generation',
  'workspace',
  'runtime',
  'context',
  'memory',
  'tools',
  'skills',
  'system-prompt',
] as const;

export function parseAgentDefaultsTab(raw: string | null | undefined): AgentDefaultsTabId {
  const id = (raw ?? '').trim();
  if (AGENT_DEFAULTS_TABS.includes(id as AgentDefaultsTabId)) {
    return id as AgentDefaultsTabId;
  }
  return 'model-strategy';
}
