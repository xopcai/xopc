/**
 * Curated Markdown compatibility store:
 * - shared memories: `~/.xopc/user/memories/MEMORY.md`
 * - user profile: `~/.xopc/user/MEMORY.md`
 */

export interface MemoryStoreConfig {
  workspaceDir: string;
  /** Absolute path to the shared user memories directory. */
  memoriesDir: string;
  /** Absolute path to global user memory (`~/.xopc/user/MEMORY.md`). */
  userMemoryPath: string;
  /** Max chars for MEMORY.md entries (excluding delimiter overhead in limit check uses joined body). */
  memoryCharLimit: number;
  /** Max chars for global user memory entries. */
  userCharLimit: number;
  /** When false, global user memory is not loaded into the snapshot or shown in the system prompt. */
  userProfileEnabled?: boolean;
}

/** Frozen at session start; not updated when tools mutate disk mid-session. */
export interface MemorySnapshot {
  memory: string;
  user: string;
}

export type MemoryKind =
  | 'user_profile'
  | 'preference'
  | 'boundary'
  | 'relationship'
  | 'project_context'
  | 'commitment'
  | 'routine'
  | 'personal_logistics'
  | 'open_question'
  | 'milestone'
  | 'current_state'
  | 'curated_note'
  | 'workspace_fact'
  | 'daily_note'
  | 'session_summary'
  | 'derived_insight'
  | 'task_lesson'
  | 'tool_preference'
  | 'long_term_goal';

export type MemoryStatus =
  | 'candidate'
  | 'active'
  | 'needs_review'
  | 'stale'
  | 'archived'
  | 'rejected';

export type MemorySensitivity = 'normal' | 'personal' | 'secret' | 'regulated';

export type MemoryExplicitness = 'explicit' | 'observed' | 'inferred';

export type MemoryDurability = 'ephemeral' | 'durable' | 'recurring';

export type MemoryDisclosurePolicy = 'silent' | 'referenceable' | 'ask_before_reference';

export type MemoryEvidenceRelation = 'supports' | 'contradicts' | 'supersedes' | 'derived_from';

export interface MemoryEvidence {
  evidenceId?: string;
  sourceItemId?: string;
  relation?: MemoryEvidenceRelation;
  sessionKey?: string;
  turnId?: string;
  toolCallId?: string;
  sourceText?: string;
  observedAt?: string;
  confidence?: number;
}

export interface MemoryScope {
  userId: string;
  workspaceId?: string;
  sessionKey?: string;
  projectId?: string;
}

export interface MemoryCitation {
  providerId: string;
  recordId: string;
  title?: string;
  uri?: string;
  path?: string;
  lineStart?: number;
  lineEnd?: number;
  createdAt?: string;
}

export interface MemoryRecord {
  id: string;
  kind: MemoryKind;
  status?: MemoryStatus;
  canonicalKey?: string;
  scope: MemoryScope;
  provenance: {
    sourceAgentId: string;
  };
  content: string;
  source: {
    sourceInstanceId?: string;
    path?: string;
    lineStart?: number;
    lineEnd?: number;
    sessionEntryId?: string;
    provider?: string;
  };
  confidence?: number;
  sensitivity?: MemorySensitivity;
  explicitness: MemoryExplicitness;
  durability: MemoryDurability;
  importance: number;
  disclosurePolicy: MemoryDisclosurePolicy;
  evidence?: MemoryEvidence[];
  validFrom?: string;
  validTo?: string;
  reviewAfter?: string;
  expiresAt?: string;
  supersedesRecordId?: string;
  conflictGroupId?: string;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
}

export interface MemorySearchRequest {
  query: string;
  scope?: Partial<MemoryScope>;
  kinds?: MemoryKind[];
  maxResults?: number;
  minScore?: number;
}

export interface MemorySearchResult {
  record: MemoryRecord;
  score: number;
  snippet: string;
  citation: MemoryCitation;
}

export interface MemoryReadRequest {
  id?: string;
  path?: string;
  from?: number;
  lines?: number;
  scope?: Partial<MemoryScope>;
}

export interface MemoryReadResult {
  record: MemoryRecord;
  lineNumbers?: { start: number; end: number };
}

export interface MemoryListRequest {
  kind?: MemoryKind;
  status?: MemoryStatus;
  canonicalKey?: string;
  target?: 'memory' | 'user';
  scope?: Partial<MemoryScope>;
}

export interface MemoryWriteRequest {
  kind: MemoryKind;
  content: string;
  canonicalKey?: string;
  scope?: Partial<MemoryScope>;
  target?: 'memory' | 'user';
  tags?: string[];
  source?: MemoryRecord['source'];
  confidence?: number;
  status?: MemoryStatus;
  sensitivity?: MemorySensitivity;
  explicitness?: MemoryExplicitness;
  durability?: MemoryDurability;
  importance?: number;
  disclosurePolicy?: MemoryDisclosurePolicy;
  evidence?: MemoryEvidence[];
  validFrom?: string;
  validTo?: string;
  reviewAfter?: string;
  expiresAt?: string;
  supersedesRecordId?: string;
  conflictGroupId?: string;
  approved?: boolean;
}

export interface MemoryUpdateRequest {
  id?: string;
  matchText?: string;
  content: string;
  scope?: Partial<MemoryScope>;
  target?: 'memory' | 'user';
  approved?: boolean;
}

export interface MemoryDeleteRequest {
  id?: string;
  matchText?: string;
  scope?: Partial<MemoryScope>;
  target?: 'memory' | 'user';
}

export interface MemoryWriteResult {
  success: boolean;
  message?: string;
  error?: string;
  record?: MemoryRecord;
}

export interface MemoryCapabilities {
  search: boolean;
  read: boolean;
  write: boolean;
  update: boolean;
  delete: boolean;
  keywordSearch?: boolean;
  semanticSearch?: boolean;
  hybridSearch?: boolean;
  citations?: boolean;
  sync?: boolean;
  local?: boolean;
}

export interface MemoryProviderManifest {
  type: 'memory-provider';
  id: string;
  displayName: string;
  entry?: string;
  capabilities: Partial<MemoryCapabilities>;
  configSchema?: string;
}

export type MemorySyncEvent =
  | {
      type: 'turn';
      userContent: string;
      assistantContent: string;
      sessionId?: string;
    }
  | {
      type: 'write';
      action: 'add' | 'replace' | 'remove';
      target?: 'memory' | 'user';
      content: string;
    }
  | {
      type: 'signal';
      signal: MemorySignal;
    };

export interface MemorySignal {
  source: 'search_recall' | 'session_summary' | 'explicit_remember' | 'background_review' | 'dreaming';
  recordId?: string;
  score?: number;
  content?: string;
  metadata?: Record<string, unknown>;
}
