import type { AgentTool } from '@earendil-works/pi-agent-core';

export const DELEGATION_CAPABILITIES = ['local_read', 'web_read', 'knowledge_read', 'skills_read', 'external_read', 'local_write', 'command', 'browser'] as const;
export type DelegationCapability = typeof DELEGATION_CAPABILITIES[number];
export type DelegationMode = 'inspect' | 'read' | 'research' | 'review' | 'implement' | 'custom';

/** Host-owned classifications. New tools fail closed until classified. */
export const DELEGATION_TOOL_CAPABILITIES: Readonly<Record<string, DelegationCapability>> = {
  read_file: 'local_read', grep: 'local_read', find: 'local_read', list_dir: 'local_read', review_workspace: 'local_read',
  read_media: 'local_read', image: 'local_read', tool_manual: 'local_read',
  web_search: 'web_read', web_fetch: 'web_read', web_extract: 'web_read',
  knowledge_search: 'knowledge_read', knowledge_get: 'knowledge_read', session_search: 'knowledge_read',
  session_recall: 'knowledge_read', user_context_search: 'knowledge_read', user_context_get: 'knowledge_read',
  skills_list: 'skills_read', skill_view: 'skills_read', skills_marketplace_search: 'skills_read',
  xopc_tool_search: 'external_read', xopc_tool_describe: 'external_read', xopc_tool_execute: 'external_read',
  write_file: 'local_write', apply_patch: 'local_write', exec_command: 'command', language_diagnostics: 'command',
  browser_use: 'browser',
};

const RESEARCH: DelegationCapability[] = ['local_read', 'web_read', 'knowledge_read', 'skills_read', 'external_read'];

export function delegationCapabilities(mode: DelegationMode, requested?: DelegationCapability[]): Set<DelegationCapability> {
  const ceiling: DelegationCapability[] = mode === 'implement' ? [...RESEARCH, 'local_write', 'command', 'browser']
    : mode === 'custom' ? [...RESEARCH, 'browser']
      : mode === 'research' ? RESEARCH : ['local_read'];
  const defaults = mode === 'implement' ? ceiling.filter(capability => capability !== 'browser')
    : mode === 'custom' ? [] : ceiling;
  return new Set((requested ?? defaults).filter(capability => ceiling.includes(capability)));
}

export function resolveDelegationTools(parentNames: readonly string[], mode: DelegationMode, requested?: string[], capabilities?: DelegationCapability[]) {
  const parent = new Set(parentNames);
  const allowed = delegationCapabilities(mode, capabilities);
  const granted: string[] = [];
  const rejected: Array<{ tool: string; reason: string }> = [];
  for (const tool of new Set((requested ?? parentNames).map(name => name.trim()).filter(Boolean))) {
    const capability = DELEGATION_TOOL_CAPABILITIES[tool];
    const reason = !parent.has(tool) ? 'Unavailable to the parent agent'
      : !capability ? 'Tool has no delegable capability'
        : !allowed.has(capability) ? `Capability ${capability} is outside this delegation` : undefined;
    if (reason) { if (requested) rejected.push({ tool, reason }); }
    else granted.push(tool);
  }
  return { granted, rejected };
}

/** Always enforce the external read contract, even when the child explicitly sends readOnly:false. */
export function protectDelegatedTool(tool: AgentTool<any, any>): AgentTool<any, any> {
  if (tool.name !== 'xopc_tool_execute') return tool;
  return { ...tool, execute: (id, args, signal, onUpdate) => tool.execute(id, { ...(args as Record<string, unknown>), readOnly: true, approvalId: undefined }, signal, onUpdate) };
}
