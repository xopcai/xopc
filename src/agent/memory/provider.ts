import type { AgentTool } from '@earendil-works/pi-agent-core';

import type {
  MemoryCapabilities,
  MemoryDeleteRequest,
  MemoryListRequest,
  MemoryProviderManifest,
  MemoryReadRequest,
  MemoryReadResult,
  MemorySearchRequest,
  MemorySearchResult,
  MemorySyncEvent,
  MemoryUpdateRequest,
  MemoryWriteRequest,
  MemoryWriteResult,
  MemoryRecord,
} from './types.js';

export interface MemoryProviderInitOptions {
  workspace?: string;
  agentWorkspace?: string;
  sessionId?: string;
  config?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MemoryProvider {
  readonly id: string;
  readonly displayName?: string;
  readonly manifest?: MemoryProviderManifest;
  readonly capabilities: MemoryCapabilities;

  isAvailable(): boolean;

  initialize(sessionId: string, options?: MemoryProviderInitOptions): Promise<void> | void;

  /** Static text merged into the system prompt. */
  systemPromptBlock?(): string;

  prefetch?(query: string, options?: { sessionId?: string }): Promise<string>;

  queuePrefetch?(query: string, options?: { sessionId?: string }): void;

  sync?(event: MemorySyncEvent): Promise<void> | void;

  search?(request: MemorySearchRequest): Promise<MemorySearchResult[]>;
  read?(request: MemoryReadRequest): Promise<MemoryReadResult | null>;
  get?(id: string): Promise<MemoryRecord | null>;
  list?(request: MemoryListRequest): Promise<MemoryRecord[]>;
  write?(request: MemoryWriteRequest): Promise<MemoryWriteResult>;
  update?(request: MemoryUpdateRequest): Promise<MemoryWriteResult>;
  delete?(request: MemoryDeleteRequest): Promise<MemoryWriteResult>;

  getToolSchemas?(): AgentTool[];

  /** JSON string result for tool calls routed by name (when not using inline AgentTool.execute only). */
  handleToolCall?(toolName: string, args: Record<string, unknown>): Promise<string>;

  shutdown(): Promise<void> | void;

  onTurnStart?(turnNumber: number, message: string, metadata?: Record<string, unknown>): void;
  onSessionEnd?(messages: unknown[]): void;
  onPreCompress?(messages: unknown[]): string;
}
