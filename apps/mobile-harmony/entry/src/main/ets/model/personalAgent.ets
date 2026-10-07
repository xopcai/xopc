export interface XopcPersonalAgentRecord {
  agentId: string;
  conversationId: string;
  state: 'provisioning' | 'ready' | 'error';
  displayName: string;
  appearance: string;
  errorMessage: string | null;
}

export interface XopcPersonalAgentResponse {
  ok: boolean;
  payload: XopcPersonalAgentRecord | null;
  error?: string;
}
