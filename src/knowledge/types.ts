import type { MemorySensitivity } from '../agent/memory/types.js';

export type KnowledgeSyncRunStatus = 'running' | 'succeeded' | 'partial' | 'failed' | 'cancelled';
export type KnowledgeSynthesisStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'ignored';
export type KnowledgeSynthesisPipeline = 'user_understanding' | 'connected_knowledge';
export type KnowledgeRetentionClass = 'ephemeral' | 'bounded' | 'durable';
export type KnowledgeAuthorRole = 'user' | 'assistant' | 'third_party' | 'system' | 'unknown';
export type KnowledgeChangeKind = 'added' | 'modified' | 'deleted';

export interface KnowledgeSourceItem {
  id: string;
  sourceInstanceId: string;
  externalId: string;
  itemType: string;
  authorRole?: KnowledgeAuthorRole;
  occurredAt?: string;
  sourceUpdatedAt?: string;
  contentHash: string;
  normalizedText?: string;
  payloadRef?: string;
  metadata: Record<string, unknown>;
  sensitivity: MemorySensitivity;
  retentionClass: KnowledgeRetentionClass;
  synthesisPipeline: KnowledgeSynthesisPipeline;
  synthesisStatus: KnowledgeSynthesisStatus;
  synthesisAttempts: number;
  synthesisClaimedAt?: string;
  synthesisClaimedBy?: string;
  synthesisError?: string;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeSourceChange {
  sequence: number;
  id: string;
  sourceInstanceId: string;
  sourceItemId: string;
  kind: KnowledgeChangeKind;
  oldHash?: string;
  newHash?: string;
  changedAt: string;
}

export interface KnowledgeSourceItemInput {
  id?: string;
  sourceInstanceId: string;
  externalId: string;
  itemType: string;
  authorRole?: KnowledgeAuthorRole;
  occurredAt?: string;
  sourceUpdatedAt?: string;
  contentHash: string;
  normalizedText?: string;
  payloadRef?: string;
  metadata?: Record<string, unknown>;
  sensitivity?: MemorySensitivity;
  retentionClass?: KnowledgeRetentionClass;
  synthesisPipeline?: KnowledgeSynthesisPipeline;
  synthesisStatus?: KnowledgeSynthesisStatus;
  deletedAt?: string;
}

export interface KnowledgeSyncRun {
  id: string;
  sourceInstanceId: string;
  status: KnowledgeSyncRunStatus;
  cursorBefore?: string;
  cursorAfter?: string;
  itemsSeen: number;
  itemsCreated: number;
  itemsUpdated: number;
  warnings: string[];
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface KnowledgePullInput {
  instanceId: string;
  cursor?: string;
  windowStart?: string;
  signal: AbortSignal;
}

export interface KnowledgePullResult {
  items: KnowledgeSourceItemInput[];
  nextCursor?: string;
  warnings: string[];
}

export interface KnowledgeSourceAdapter {
  readonly kind: string;
  pull(input: KnowledgePullInput): Promise<KnowledgePullResult>;
}
