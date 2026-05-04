import type { AgentsSettingsMessages } from '@/i18n/messages';

const MAIN_AGENT_ID = 'main';

export function agentListDisplayName(
  ag: { id: string; name?: string | undefined },
  agentsMessages: AgentsSettingsMessages,
): string {
  const n = ag.name?.trim();
  if (n) return n;
  if (ag.id.trim().toLowerCase() === MAIN_AGENT_ID) {
    return agentsMessages.defaultMainAgentName;
  }
  return ag.id;
}

export function agentListDisplayDescription(
  ag: { id: string; description?: string | undefined },
  agentsMessages: AgentsSettingsMessages,
): string {
  const d = ag.description?.trim();
  if (d) return d;
  if (ag.id.trim().toLowerCase() === MAIN_AGENT_ID) {
    return agentsMessages.defaultMainAgentDescription;
  }
  return '';
}
