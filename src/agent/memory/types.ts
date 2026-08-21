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
  | 'user_note'
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
  /** Memory provider that owns storage and retrieval for this record. */
  providerId: string;
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
  id: string;
  scope?: Partial<MemoryScope>;
}

export interface MemoryReadResult {
  record: MemoryRecord;
}

export interface MemoryListRequest {
  kind?: MemoryKind;
  status?: MemoryStatus;
  canonicalKey?: string;
  scope?: Partial<MemoryScope>;
}

export interface MemoryWriteRequest {
  kind: MemoryKind;
  content: string;
  canonicalKey?: string;
  scope?: Partial<MemoryScope>;
  /** Agent that produced this record. This is request data, never provider state. */
  sourceAgentId?: string;
  writeTarget?: 'userProfile' | 'agentProfile' | 'understanding' | 'workspace';
  confirmed?: boolean;
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
}

export interface MemoryUpdateRequest {
  id: string;
  content: string;
  scope?: Partial<MemoryScope>;
}

export interface MemoryDeleteRequest {
  id: string;
  scope?: Partial<MemoryScope>;
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
      type: 'signal';
      signal: MemorySignal;
    };

export interface MemorySignal {
  source: 'search_recall' | 'context_injection' | 'session_summary' | 'explicit_remember' | 'background_review' | 'dreaming';
  recordId?: string;
  score?: number;
  content?: string;
  metadata?: Record<string, unknown>;
}
