/** Fired when `sessionStorage` pending run id is set or cleared for a web chat session. */
export const PENDING_AGENT_RUN_CHANGED_EVENT = 'xopc-pending-agent-run-changed';

export function dispatchPendingAgentRunChanged(chatId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PENDING_AGENT_RUN_CHANGED_EVENT, { detail: { chatId } }));
}
