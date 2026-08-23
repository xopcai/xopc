export type UnderstandingSourcePlatform = 'darwin' | 'win32' | 'linux' | 'all';

export type UnderstandingSourceCategory =
  | 'files'
  | 'recent_documents'
  | 'calendar'
  | 'tasks'
  | 'notes'
  | 'mail'
  | 'messages'
  | 'code_activity';

export type UnderstandingSourceAccessMode = 'once' | 'continuous';
export type UnderstandingSourceRetentionPolicy = 'metadata_only' | 'derived_only' | 'bounded_raw';
export type UnderstandingSourceProcessingPolicy = 'local_only' | 'remote_allowed';

export interface UnderstandingSourceDefinition {
  id: string;
  category: UnderstandingSourceCategory;
  platform: UnderstandingSourcePlatform;
  displayName: string;
  description: string;
  availability: 'available' | 'unavailable';
  permission: 'not_requested' | 'granted' | 'denied' | 'unavailable';
  defaultAccessMode: UnderstandingSourceAccessMode;
  supportedAccessModes: UnderstandingSourceAccessMode[];
  recommended: boolean;
  sensitive: boolean;
}

export interface UnderstandingSourceGrant {
  id: string;
  sourceKey: string;
  adapterId: string;
  category: UnderstandingSourceCategory;
  platform: UnderstandingSourcePlatform;
  displayName: string;
  status: 'active' | 'revoked';
  accessMode: UnderstandingSourceAccessMode;
  retentionPolicy: UnderstandingSourceRetentionPolicy;
  processingPolicy: UnderstandingSourceProcessingPolicy;
  config: Record<string, unknown>;
  checkpoint: Record<string, unknown>;
  lastCollectedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface UnderstandingSourceItem {
  id: string;
  sourceId: string;
  type: 'document' | 'calendar_event' | 'task' | 'note' | 'mail' | 'message' | 'code_activity' | 'bookmark';
  title: string;
  text?: string;
  group?: string;
  /** Sanitized locator. It must not contain credentials, query parameters, or fragments. */
  resourceUri?: string;
  occurredAt?: number;
  modifiedAt?: number;
  startsAt?: number;
  endsAt?: number;
  ownerAttribution: 'user' | 'other' | 'shared' | 'unknown';
  sensitivity: 'normal' | 'personal' | 'secret' | 'regulated';
  evidenceRef: string;
}

export interface UnderstandingSourceCollectionResult {
  sourceId: string;
  status: 'completed' | 'denied' | 'failed';
  items: UnderstandingSourceItem[];
  checkpoint?: { fingerprint: string; collectedAt: number };
  error?: string;
}

export interface UnderstandingSourceRun {
  id: string;
  grantId: string;
  kind: 'preview' | 'bootstrap' | 'incremental' | 'fingerprint';
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'canceled';
  cursorBefore?: string;
  cursorAfter?: string;
  itemsSeen: number;
  metadata: Record<string, unknown>;
  errorMessage?: string;
  startedAt: number;
  completedAt?: number;
}

export interface UserFocus {
  id: string;
  canonicalKey: string;
  title: string;
  summary: string;
  horizon: 'current' | 'ongoing' | 'long_term';
  status: 'candidate' | 'active' | 'paused' | 'completed' | 'rejected';
  confidence: number;
  projectId?: string;
  evidenceRefs: string[];
  sourceRunId?: string;
  createdAt: number;
  updatedAt: number;
}
