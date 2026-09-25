import type { Config } from '../config/schema.js';
import type { EndpointToolRuntime } from '../endpoint-tools/index.js';
import type { MessageBus } from '../infra/bus/index.js';
import type { SessionStore } from '../session/store.js';

export interface GatewayWorkflowAgentSurface {
  getModelForSession(conversationId: string): string;
  getWorkflowSkillInstructions(agentId: string, names: readonly string[]): string | undefined;
}

/** Minimal gateway surface for workflow run + session bridge (breaks circular imports). */
export interface GatewayWorkflowHost {
  readonly currentConfig: Config;
  readonly currentWorkspacePath: string;
  readonly messageBusInstance: MessageBus;
  readonly agentService: GatewayWorkflowAgentSurface;
  readonly endpointTools?: EndpointToolRuntime;
  emit(event: string, payload: unknown): void;
  readonly sessionIndexInstance: {
    getStore(): SessionStore;
  };
}
