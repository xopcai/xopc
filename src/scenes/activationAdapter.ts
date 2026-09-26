import type { ScenePrincipal, SceneTemplate } from './contracts.js';

/** Extension point for activation shapes that need more than the core read-only setup. */
export interface SceneActivationAdapter {
  id: string;
  preflight(principal: ScenePrincipal, template: SceneTemplate, configuration: unknown): Promise<{ ready: boolean; missing: string[] }>;
  create(principal: ScenePrincipal, template: SceneTemplate, configuration: unknown): Promise<unknown>;
  get(principal: ScenePrincipal, activationId: string): unknown;
  configure(principal: ScenePrincipal, activationId: string, expectedRevision: number, configuration: unknown): Promise<unknown>;
  transition(principal: ScenePrincipal, activationId: string, expectedRevision: number, status: 'active' | 'paused' | 'archived'): Promise<unknown>;
  tick(): Promise<void>;
  stop(): Promise<void>;
  executeTask?(runId: string, conversationId: string): Promise<boolean>;
  allowsTaskNotification?(taskId: string): boolean;
  listProjectBranches?(principal: ScenePrincipal, projectId: string): Promise<unknown>;
  associateBranch?(principal: ScenePrincipal, input: unknown): Promise<unknown>;
}
