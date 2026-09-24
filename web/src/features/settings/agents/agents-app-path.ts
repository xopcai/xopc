export const AGENTS_APP_LIST_PATH = '/capabilities/agents';

export function agentsAppDetailPath(agentId: string): string {
  return `${AGENTS_APP_LIST_PATH}/${encodeURIComponent(agentId)}`;
}
