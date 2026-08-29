import type { UserFocus } from '../user-context/sources/types.js';

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

export type WorkDiscoveryCandidateSource =
  | 'existing_project'
  | 'approved_directory'
  | 'common_work_root'
  | 'personal_work_root';

export interface WorkDiscoveryCandidate {
  id: string;
  rootPath: string;
  displayName: string;
  source: WorkDiscoveryCandidateSource;
  projectId?: string;
  projectKind: 'coding' | 'general' | 'unknown';
  projectKindConfidence: number;
  score: number;
  lastActiveAt?: number;
  branch?: string;
  changedFileCount: number;
  evidence: string[];
}

export interface WorkDiscoveryDirectorySource {
  id: string;
  kind: 'directory';
  rootPath: string;
  displayName: string;
  status: 'active' | 'revoked';
  scope: { readOnly: true };
  fingerprint?: WorkDiscoveryPreview['fingerprint'];
  lastScannedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface WorkDiscoverySourceRefresh {
  id: string;
  sourceId: string;
  changed: boolean;
  previousFingerprint?: WorkDiscoveryPreview['fingerprint'];
  currentFingerprint: WorkDiscoveryPreview['fingerprint'];
  status: 'checked' | 'queued' | 'completed' | 'failed';
  discoveryRunId?: string;
  checkedAt: number;
}

export type WorkUnderstandingInvestigationStatus =
  | 'planning'
  | 'investigating'
  | 'synthesizing'
  | 'completed'
  | 'failed'
  | 'canceled';

export type WorkUnderstandingEvidenceSourceType =
  | 'file'
  | 'git'
  | 'project_metadata'
  | 'understanding_source'
  | 'session'
  | 'user_statement';

export interface WorkUnderstandingInvestigationBudget {
  maxToolCalls: number;
  maxContentChars: number;
  maxDurationMs: number;
}

export interface WorkUnderstandingInvestigation {
  id: string;
  discoveryRunId: string;
  status: WorkUnderstandingInvestigationStatus;
  plan: {
    hypotheses: string[];
    questions: string[];
  };
  budget: WorkUnderstandingInvestigationBudget;
  toolCallCount: number;
  contentCharsRead: number;
  startedAt: number;
  completedAt?: number;
  errorMessage?: string;
}

export interface WorkUnderstandingEvidenceItem {
  id: string;
  investigationId: string;
  sourceGrantId?: string;
  projectId?: string;
  sourceType: WorkUnderstandingEvidenceSourceType;
  sourceRef: string;
  observation: string;
  contentHash?: string;
  observedAt?: number;
  collectedAt: number;
  sensitivity: 'normal' | 'restricted';
}

export type WorkUnderstandingThreadStatus = 'active' | 'paused' | 'blocked' | 'completed' | 'uncertain';
export type WorkUnderstandingThreadHorizon = 'current' | 'ongoing' | 'long_term';
export type WorkUnderstandingThreadUserStatus = 'unreviewed' | 'confirmed' | 'corrected' | 'rejected';

export interface WorkUnderstandingThreadCandidate {
  topicKey: string;
  title: string;
  summary: string;
  status: WorkUnderstandingThreadStatus;
  horizon: WorkUnderstandingThreadHorizon;
  confidence: 'high' | 'medium' | 'low';
  evidenceRefs: string[];
}

export interface WorkUnderstandingThread {
  id: string;
  canonicalKey: string;
  title: string;
  summary: string;
  status: WorkUnderstandingThreadStatus;
  horizon: WorkUnderstandingThreadHorizon;
  focusScore: number;
  confidence: number;
  userStatus: WorkUnderstandingThreadUserStatus;
  projectIds: string[];
  evidenceIds: string[];
  parentThreadId?: string;
  firstObservedAt: number;
  lastObservedAt: number;
  createdAt: number;
  updatedAt: number;
}
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
  expectedTask: string;
  estimatedMinutes: number;
  risk: 'analysis' | 'command' | 'file_write';
  verification: string[];
}

export interface WorkDiscoveryResult {
  projectSummary: string;
  currentState: string;
  uncertainties: string[];
  suggestions: WorkDiscoverySuggestion[];
  conversationStarter?: string;
  discoveredProjects?: Array<{
    rootPath: string;
    displayName: string;
    score: number;
    projectKind: 'coding' | 'general' | 'unknown';
    lastActiveAt?: number;
    evidence: string[];
  }>;
  profileCandidates?: WorkDiscoveryProfileCandidate[];
  primarySuggestionId?: string;
  lowConfidence?: boolean;
  contextQuestion?: string;
  investigation?: {
    id: string;
    hypotheses: string[];
    questions: string[];
    toolCallCount: number;
    contentCharsRead: number;
    degraded: boolean;
  };
  workThreadCandidates?: WorkUnderstandingThreadCandidate[];
  workThreads?: WorkUnderstandingThread[];
  focusCandidates?: UserFocus[];
}

export interface WorkDiscoveryProfileCandidate {
  id: string;
  understandingId?: string;
  category: 'role' | 'focus' | 'technology' | 'workflow' | 'preference';
  statement: string;
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];
  evidenceRefs?: string[];
  status: 'pending' | 'accepted' | 'edited' | 'rejected';
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
    contentSignature: string;
    generatedAt: number;
  };
  provider: string;
  remoteModel: boolean;
  policyVersion: number;
}
