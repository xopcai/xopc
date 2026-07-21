export type WorkDiscoveryOnboardingStatus =
  | 'not_started'
  | 'in_progress'
  | 'completed'
  | 'dismissed';

export interface WorkDiscoveryOnboardingState {
  status: WorkDiscoveryOnboardingStatus;
  activeRunId?: string;
  completedAt?: number;
  dismissedAt?: number;
  updatedAt: number;
}

export type WorkDiscoveryRunStatus =
  | 'queued'
  | 'probing'
  | 'analyzing'
  | 'completed'
  | 'failed'
  | 'canceled';

export type WorkDiscoveryStage = 'folder_structure' | 'recent_progress' | 'next_steps';
export type WorkDiscoverySource = 'onboarding_selected_directory' | 'manual_selected_directory';
export type WorkDiscoveryErrorCode =
  | 'folder_unavailable'
  | 'folder_not_readable'
  | 'nothing_useful_found'
  | 'model_unavailable'
  | 'analysis_invalid'
  | 'analysis_timeout'
  | 'canceled'
  | 'internal_error';

export interface WorkDiscoveryEvidence {
  path?: string;
  observation: string;
}

export interface WorkDiscoverySuggestion {
  id: string;
  actionType: 'summarize_recent_work' | 'inspect_related_tests' | 'plan_next_step';
  title: string;
  rationale: string;
  evidence: WorkDiscoveryEvidence[];
  actionPrompt: string;
  confidence: 'high' | 'medium' | 'low';
  expectedOutcome: string;
  estimatedMinutes: number;
  risk: 'analysis' | 'command' | 'file_write';
  verification: string[];
}

export interface WorkDiscoveryResult {
  projectSummary: string;
  currentState: string;
  uncertainties: string[];
  suggestions: WorkDiscoverySuggestion[];
  primarySuggestionId?: string;
  lowConfidence?: boolean;
  contextQuestion?: string;
}

export type WorkDiscoveryRecognitionDecision =
  | 'confirmed'
  | 'corrected'
  | 'different_goal'
  | 'dismissed';

export interface WorkDiscoveryFeedback {
  runId: string;
  recognitionDecision: WorkDiscoveryRecognitionDecision;
  correctedIntent?: string;
  createdAt: number;
  updatedAt: number;
}

export interface WorkContextDocument {
  relativePath: string;
  modifiedAt?: number;
  excerpt: string;
  truncated: boolean;
  selectionReason: string;
}

export interface WorkContextMetadataFile {
  relativePath: string;
  modifiedAt?: number;
  size: number;
  kind: 'document' | 'pdf' | 'image';
}

export interface WorkContextSnapshot {
  root: {
    displayName: string;
    projectKind: 'coding' | 'general' | 'unknown';
    markerReasons: string[];
  };
  structure: {
    sampledPaths: string[];
    metadataOnlyFiles: WorkContextMetadataFile[];
    omittedPathCount: number;
  };
  git?: {
    branch?: string;
    changedPaths: string[];
    recentCommits: Array<{ subject: string; committedAt?: number }>;
  };
  documents: WorkContextDocument[];
  limits: {
    policyVersion: number;
    fileCount: number;
    contentBytes: number;
    truncated: boolean;
  };
}

export interface WorkContextSnapshotSummary {
  projectKind: 'coding' | 'general' | 'unknown';
  sampledPathCount: number;
  omittedPathCount: number;
  documentCount: number;
  contentBytes: number;
  changedPathCount: number;
  truncated: boolean;
}

export interface WorkDiscoveryRun {
  id: string;
  idempotencyKey: string;
  source: WorkDiscoverySource;
  status: WorkDiscoveryRunStatus;
  stage?: WorkDiscoveryStage;
  rootPath: string;
  projectId: string;
  sessionKey: string;
  agentId: string;
  modelRef: string;
  scanPolicyVersion: number;
  snapshot?: WorkContextSnapshotSummary;
  result?: WorkDiscoveryResult;
  feedback?: WorkDiscoveryFeedback;
  errorCode?: WorkDiscoveryErrorCode;
  errorMessage?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  canceledAt?: number;
}

export interface WorkDiscoveryPreview {
  canonicalRootPath: string;
  displayName: string;
  exists: boolean;
  readable: boolean;
  projectKind: 'coding' | 'general' | 'unknown';
  projectKindConfidence: number;
  markerReasons: string[];
  fingerprint: {
    branch?: string;
    changedFileCount: number;
    recentAreas: string[];
    generatedAt: number;
  };
  provider: string;
  remoteModel: boolean;
  policyVersion: number;
}
