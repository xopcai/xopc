export const BUILTIN_AGENT_IDS = [
  'main',
  'coder',
  'creative',
  'data-analyst',
  'researcher',
  'writer',
] as const;

const BUILTIN_AGENT_ID_SET = new Set<string>(BUILTIN_AGENT_IDS);

export function isBuiltinAgentId(agentId: string | undefined | null): boolean {
  return BUILTIN_AGENT_ID_SET.has(String(agentId ?? '').trim().toLowerCase());
}
