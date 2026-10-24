import type { BrowserObservation } from '@xopcai/browser-control-contract';

export type SetupState = 'plan_ready' | 'preparing' | 'waiting_extension' | 'ready_for_verification' | 'verifying' | 'needs_attention' | 'completed' | 'cancelled';
export interface BrowserSetup {
  id: string;
  conversationId: string;
  agentId: string;
  revision: number;
  state: SetupState;
  configRevision: string;
  approvedBy?: string;
  createdAt: number;
  updatedAt: number;
  operation?: { key: string; startedAt: number };
  error?: string;
  attempt?: {
    id: string;
    endpointId: string;
    principalId: string;
    appVersion: string;
    policyRevision: string;
    fixtureUrl: string;
    marker: string;
    sample: string;
    expiresAt: number;
    actions: number;
    sessionId?: string;
    tabId?: string;
    documentId?: string;
    observation?: Pick<BrowserObservation, 'revision' | 'nodes'>;
    read: boolean;
    clicked: boolean;
    filled: boolean;
    released: boolean;
  };
}
