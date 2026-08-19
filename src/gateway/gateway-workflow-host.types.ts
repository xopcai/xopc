import type { Config } from '../config/schema.js';
import type { MessageBus } from '../infra/bus/index.js';
import type { SessionStore } from '../session/store.js';
import type { EnqueueTaskOptions, TaskQueueItem } from '../tasks/index.js';

export interface GatewayWorkflowAgentSurface {
  getModelForSession(sessionKey: string): string;
}

/** Minimal gateway surface for workflow run + session bridge (breaks circular imports). */
export interface GatewayWorkflowHost {
  readonly currentConfig: Config;
  readonly currentWorkspacePath: string;
  readonly messageBusInstance: MessageBus;
  readonly agentService: GatewayWorkflowAgentSurface;
  enqueueTask?: (taskId: string, options?: EnqueueTaskOptions) => TaskQueueItem;
  emit(event: string, payload: unknown): void;
  readonly sessionIndexInstance: {
    getStore(): SessionStore;
  };
}
