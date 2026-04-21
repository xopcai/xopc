/** Top-level gateway console routes for the agents UI (outside the settings shell). */
export const AGENTS_APP_LIST_PATH = '/agents';

export function agentsAppDetailPath(agentId: string): string {
  return `${AGENTS_APP_LIST_PATH}/${encodeURIComponent(agentId)}`;
}
