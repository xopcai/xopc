/** Public, credential-free presentation of a Browser setup run. */
export interface BrowserSetupView {
  id: string;
  conversationId: string;
  agentId: string;
  revision: number;
  state: 'plan_ready' | 'preparing' | 'waiting_extension' | 'ready_for_verification' | 'verifying' | 'needs_attention' | 'completed' | 'cancelled';
  approvedBy?: string;
  error?: string;
  stale: boolean;
  toolPermission?: 'allowed' | 'denied';
  currentDriverKind?: string;
  settingsPath: string;
  endpoints: Array<{ endpointId: string; principalId: string; displayName: string; appVersion: string }>;
  checks: { configured: boolean; read: boolean; clicked: boolean; filled: boolean; released: boolean };
  attempt?: { id: string; endpointId: string; fixtureUrl: string; sample: string; expiresAt: number; sessionId?: string; released: boolean };
}
