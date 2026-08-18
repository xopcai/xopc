import type { Config } from '../config/schema.js';
import type { MessageBus } from '../infra/bus/index.js';
import type { SessionStore } from '../session/store.js';
import type { EnqueueOutcomeOptions, OutcomeQueueItem } from '../work/index.js';

export interface GatewayWorkflowAgentSurface {
  getModelForSession(sessionKey: string): string;
}

/** Minimal gateway surface for workflow run + session bridge (breaks circular imports). */
export interface GatewayWorkflowHost {
  readonly currentConfig: Config;
  readonly currentWorkspacePath: string;
  readonly messageBusInstance: MessageBus;
  readonly agentService: GatewayWorkflowAgentSurface;
  enqueueOutcome?: (outcomeId: string, options?: EnqueueOutcomeOptions) => OutcomeQueueItem;
  emit(event: string, payload: unknown): void;
  readonly sessionIndexInstance: {
    getStore(): SessionStore;
  };
}
