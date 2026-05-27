import type { ThinkingLevel } from '@earendil-works/pi-agent-core';

import type { Config, AgentDefaults } from '../config/schema.js';
import type { SessionStore } from '../session/store.js';
import type { CronService } from '../cron/index.js';
import type { ExtensionRegistryImpl as ExtensionRegistry } from '../extensions/index.js';
import type { GatewayClarifyRequestFn } from './tools/clarify-tool.js';
import type { ProgressStage } from './lifecycle/progress.js';

export interface AgentServiceConfig {
  workspace: string;
  model?: string;
  config?: Config;
  agentDefaults?: AgentDefaults;
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
  getCronService?: () => CronService | undefined;
  /**
   * Gateway: reuse the gateway `SessionManager` store so web API and agent share one index + files.
   * When omitted, `AgentService` creates its own `SessionStore` (CLI / embedded).
   */
  sessionStore?: SessionStore;
  /**
   * Gateway: invoked after `sessionStore.updateMetadata` from built-in `/goal` APIs (store does not emit).
   * Wire to `sessionManager.emit('sessionUpdated', { key })` so the console refetches.
   */
  onSessionMetadataUpdated?: (sessionKey: string) => void;
  /** Gateway: transcript JSONL append (goal verdict, slash receipt, background turns). */
  onSessionTranscriptUpdated?: (sessionKey: string) => void;
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
