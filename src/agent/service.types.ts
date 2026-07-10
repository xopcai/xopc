import type { ThinkingLevel } from '@earendil-works/pi-agent-core';

import type { Config } from '../config/schema.js';
import type { SessionStore } from '../session/store.js';
import type { AutomationService } from '../automations/index.js';
import type { ExtensionRegistryImpl as ExtensionRegistry } from '../extensions/index.js';
import type { NotesService } from '../notes/index.js';
import type { ProjectService } from '../projects/index.js';
import type { WorkItemService } from '../work-items/index.js';
import type { GatewayClarifyRequestFn } from './tools/clarify-tool.js';
import type { ProgressStage } from './lifecycle/progress.js';
import type { AgentSourceContextResolver } from './source-context/types.js';

export interface AgentServiceConfig {
  workspace: string;
  model?: string;
  config?: Config;
  extensionRegistry?: ExtensionRegistry;
  maxRequestsPerTurn?: number;
  maxToolFailuresPerTurn?: number;
  maxTaskDurationMs?: number;
  thinkingLevel?: ThinkingLevel;
  reasoningLevel?: 'off' | 'on' | 'stream';
  verboseLevel?: 'off' | 'on' | 'full';
  /**
   * Gateway-only: blocks the `clarify` tool until the user answers via the web UI.
   */
  gatewayClarify?: {
    requestClarification: GatewayClarifyRequestFn;
  };
  getAutomationService?: () => AutomationService | undefined;
  /** Gateway: exposes first-class xopc product objects for the `xopc_use` tool. */
  getNotesService?: () => NotesService | undefined;
  getProjectService?: () => ProjectService | undefined;
  getWorkItemService?: () => WorkItemService | undefined;
  /**
   * Gateway: reuse the gateway `SessionManager` store so web API and agent share one index + files.
   * When omitted, `AgentService` creates its own `SessionStore` (CLI / embedded).
   */
  sessionStore?: SessionStore;
  /**
   * Gateway: invoked after `sessionStore.updateMetadata` from built-in `/goal` APIs (store does not emit).
   * Wire to `sessionManager.emit('sessionUpdated', { key })` so the console refetches.
   */
  onSessionMetadataUpdated?: (sessionKey: string, patch?: { name?: string }) => void;
  /** Gateway: transcript JSONL append (goal verdict, slash receipt, background turns). */
  onSessionTranscriptUpdated?: (sessionKey: string) => void;
  /** Gateway: durable goal status changed after post-turn judge. */
  onGoalStatusUpdated?: (payload: {
    goalId: string;
    sessionKey: string;
    previousStatus: string;
    status: string;
    goal: import('../goals/types.js').GoalWithDetails;
  }) => void;
  /** Gateway/TUI: local skill catalog changed or skill config toggles changed. */
  onSkillsUpdated?: (payload: { reason: 'disk' | 'config' }) => void;
  /**
   * Runtime trust override. Local TUI uses this to trust the startup workspace
   * without persisting a trust entry; gateway mode leaves trust fully persistent.
   */
  isWorkspaceTrusted?: (workspaceDir: string) => boolean | null | undefined;
  /** Gateway: persisted workflow runs. */
  getWorkflowRunService?: () => import('../workflows/service/workflow-run-service.types.js').WorkflowRunServiceLike;
  /** Gateway: resolves bound source context (e.g. Note-grounded chat) before each turn. */
  sourceContextResolver?: AgentSourceContextResolver;
}

export interface AgentContext {
  channel: string;
  chatId: string;
  sessionKey: string;
  senderId?: string;
  isGroup?: boolean;
}

export interface StreamHandle {
  update: (text: string) => void;
  updateProgress?: (text: string, stage: ProgressStage, detail?: string) => void;
  setProgress?: (stage: ProgressStage, detail?: string) => void;
  end: () => Promise<void>;
  abort: () => Promise<void>;
  messageId: () => number | undefined;
}
