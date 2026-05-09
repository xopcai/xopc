import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { SessionMetadata } from '../../session/types.js';

/** Session persistence + scheduling for `/goal` on any channel (Hermes-style). */
export interface PersistentGoalApis {
  getSessionMetadata(key: string): Promise<SessionMetadata | null>;
  updateSessionMetadata(key: string, updates: Partial<SessionMetadata>): Promise<void>;
  loadMessages(key: string): Promise<AgentMessage[]>;
  saveMessages(key: string, messages: AgentMessage[]): Promise<void>;
  scheduleContinuation(sessionKey: string, message: string): void;
  /**
   * Hermes-style guard: >1 while setting a new goal text means another inbound turn is still in-flight
   * for the same session (e.g. concurrent requests).
   */
  inboundConcurrentDepth(sessionKey: string): number;
}
