import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';

function currentUiLocale(): string {
  return useLocaleStore.getState().language === 'zh' ? 'zh-CN' : 'en-US';
}

export type WorkDiscoveryStatus = 'queued' | 'probing' | 'analyzing' | 'completed' | 'failed' | 'canceled';
export type WorkDiscoveryStage = 'folder_structure' | 'recent_progress' | 'next_steps';

export type WorkDiscoveryOnboardingSnapshot = {
  enabled: boolean;
  state: {
    status: 'not_started' | 'in_progress' | 'completed' | 'dismissed';
    activeRunId?: string;
  };
};

export type WorkDiscoverySuggestion = {
  id: string;
  actionType: 'summarize_recent_work' | 'inspect_related_tests' | 'plan_next_step';
  title: string;
  rationale: string;
  evidence: Array<{ path?: string; observation: string }>;
  actionPrompt: string;
  confidence: 'high' | 'medium' | 'low';
  expectedTask: string;
  estimatedMinutes: number;
  risk: 'analysis' | 'command' | 'file_write';
  verification: string[];
};

export type WorkDiscoveryProfileCandidate = {
  id: string;
  assertionId?: string;
  category: 'role' | 'responsibility' | 'capability' | 'preference' | 'routine' | 'communication' | 'boundary' | 'relationship';
  domain?: string;
  factKey: string;
  statement: string;
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];
  evidenceRefs?: string[];
  sourceIds?: string[];
  independentSourceCount?: number;
  status: 'pending' | 'accepted' | 'edited' | 'rejected';
};

export type WritingStyleDimension =
  | 'language'
  | 'structure'
  | 'tone'
  | 'density'
  | 'scenarios'
  | 'vocabulary';

export type WritingStyleCandidate = {
  id: string;
  assertionId?: string;
  ruleId?: string;
  dimension: WritingStyleDimension;
  factKey: string;
  statement: string;
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];
  evidenceRefs: string[];
  sourceIds: string[];
  status: 'pending' | 'accepted' | 'edited' | 'rejected';
};

export type CalibrationQuestion = {
  id: string;
  question: string;
  options?: string[];
  relatedTopicKey?: string;
};

export type WorkUnderstandingThread = {
  id: string;
  canonicalKey: string;
  title: string;
  summary: string;
  status: 'active' | 'paused' | 'blocked' | 'completed' | 'uncertain';
  horizon: 'current' | 'ongoing' | 'long_term';
  focusScore: number;
  confidence: number;
  userStatus: 'unreviewed' | 'confirmed' | 'corrected' | 'rejected';
  projectIds: string[];
  evidenceIds: string[];
  sourceIds?: string[];
  recommendedFirstStep?: string;
};

export type DeepUnderstandingPhase =
  | 'collecting'
  | 'analyzing_writing'
  | 'synthesizing'
  | 'completed'
  | 'failed'
  | 'canceled';

export type DeepUnderstandingSourceProgress = {
  sourceId: string;
  status: 'pending' | 'collecting' | 'completed' | 'partial' | 'denied' | 'failed';
  itemCount: number;
  error?: string;
};

export type DeepUnderstandingResult = {
  aboutYou: WorkDiscoveryProfileCandidate[];
  writingPreferences: WritingStyleCandidate[];
  workThreads: WorkUnderstandingThread[];
  calibrationQuestions: CalibrationQuestion[];
  sampledCounts: Record<string, number>;
  sourceStatuses: Array<{ sourceId: string; status: 'completed' | 'partial' | 'failed'; error?: string }>;
};

export type DeepUnderstandingRun = {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'canceled';
  phase: DeepUnderstandingPhase;
  selectedSources: string[];
  sourceStatuses: DeepUnderstandingSourceProgress[];
  result?: DeepUnderstandingResult;
  errorMessage?: string;
  startedAt: number;
  completedAt?: number;
};

export type DeepUnderstandingConfirmationInput = {
  aboutYou?: Array<{
    id: string;
    assertionId?: string;
    decision: 'accepted' | 'edited' | 'rejected';
    statement?: string;
  }>;
  writingPreferences?: Array<{
    id: string;
    assertionId?: string;
    dimension?: WritingStyleDimension;
    decision: 'accepted' | 'edited' | 'rejected';
    statement?: string;
    sourceIds?: string[];
  }>;
  customWritingRules?: string[];
  calibrationAnswers?: Array<{
    question: string;
    answer: string;
  }>;
  selectedThreadId?: string;
  markOnboardingCompleted?: boolean;
};

export type LocalSourcePreview = {
  sourceId: string;
  detected: boolean;
  itemCount: number;
  summary?: string;
};

export type WorkDiscoveryResult = {
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
  workThreads?: WorkUnderstandingThread[];
  knowledgeCandidates?: Array<{ id: string; content: string; status: string }>;
  primarySuggestionId?: string;
  lowConfidence?: boolean;
  contextQuestion?: string;
};

export type WorkDiscoveryRun = {
  id: string;
  status: WorkDiscoveryStatus;
  stage?: WorkDiscoveryStage;
  rootPath: string;
  projectId: string;
  conversationId: string;
  snapshot?: {
    projectKind: 'coding' | 'general' | 'unknown';
    sampledPathCount: number;
    omittedPathCount: number;
    documentCount: number;
    contentBytes: number;
    changedPathCount: number;
    branch?: string;
    files?: Array<{
      relativePath: string;
      source: 'git_change' | 'document' | 'structure';
    }>;
    truncated: boolean;
  };
  result?: WorkDiscoveryResult;
  feedback?: {
    recognitionDecision: 'confirmed' | 'corrected' | 'different_goal' | 'dismissed';
    correctedIntent?: string;
  };
  errorCode?: string;
  errorMessage?: string;
};

export type WorkDiscoveryPreview = {
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
};

export type WorkDiscoveryCandidate = {
  id: string;
  rootPath: string;
  displayName: string;
  source: 'existing_project' | 'approved_directory' | 'ai_tool_project' | 'common_work_root' | 'personal_work_root';
  projectId?: string;
  projectKind: 'coding' | 'general' | 'unknown';
  projectKindConfidence: number;
  score: number;
  lastActiveAt?: number;
  branch?: string;
  changedFileCount: number;
  evidence: string[];
};

export type WorkDiscoveryRecentFile = {
  id: string;
  name: string;
  directory: string;
  rootLabel: string;
  extension: string;
  modifiedAt: number;
};

export type WorkDiscoveryProcessingTarget = {
  provider: string;
  remoteModel: boolean;
};

export type WorkDiscoveryProcessingPolicy = 'local_only' | 'remote_allowed';

export async function fetchWorkDiscoveryOnboarding(): Promise<WorkDiscoveryOnboardingSnapshot> {
  return fetchJson<WorkDiscoveryOnboardingSnapshot>(apiUrl('/api/onboarding/work-discovery'));
}

export async function dismissWorkDiscoveryOnboarding(): Promise<void> {
  await fetchJson(apiUrl('/api/onboarding/work-discovery'), {
    method: 'PATCH',
    body: JSON.stringify({ status: 'dismissed' }),
  });
}

export async function previewWorkDiscoveryFolder(rootPath: string): Promise<WorkDiscoveryPreview> {
  const response = await fetchJson<{ preview: WorkDiscoveryPreview }>(apiUrl('/api/work-discovery/preview'), {
    method: 'POST',
    body: JSON.stringify({ rootPath }),
  });
  return response.preview;
}

export async function discoverWorkDiscoveryCandidates(): Promise<{
  candidates: WorkDiscoveryCandidate[];
  recentFiles: WorkDiscoveryRecentFile[];
  processingTarget: WorkDiscoveryProcessingTarget;
}> {
  const response = await fetchJson<{
    candidates: WorkDiscoveryCandidate[];
    recentFiles?: WorkDiscoveryRecentFile[];
    processingTarget: WorkDiscoveryProcessingTarget;
  }>(apiUrl('/api/work-discovery/candidates'), {
    method: 'POST',
  });
  return {
    candidates: response.candidates,
    recentFiles: response.recentFiles ?? [],
    processingTarget: response.processingTarget,
  };
}

export type WorkDiscoveryDirectorySource = {
  id: string;
  kind: 'directory';
  rootPath: string;
  displayName: string;
  status: 'active' | 'revoked';
  scope: { readOnly: true };
  processingPolicy: WorkDiscoveryProcessingPolicy;
  fingerprint?: WorkDiscoveryPreview['fingerprint'];
  lastScannedAt?: number;
  createdAt: number;
  updatedAt: number;
};

export async function grantUnderstandingWorkFolder(
  rootPath: string,
  processingPolicy: WorkDiscoveryProcessingPolicy,
): Promise<WorkDiscoveryDirectorySource> {
  const response = await fetchJson<{ source: WorkDiscoveryDirectorySource }>(apiUrl('/api/context-sources/work-folders'), {
    method: 'POST',
    body: JSON.stringify({ rootPath, processingPolicy }),
  });
  return response.source;
}

export async function fetchLocalSourcePreviews(customNoteDirectories?: string[]): Promise<LocalSourcePreview[]> {
  const query = customNoteDirectories?.length
    ? `?customNoteDirectories=${encodeURIComponent(customNoteDirectories.join(','))}`
    : '';
  const response = await fetchJson<{ previews: LocalSourcePreview[] }>(
    apiUrl(`/api/context-sources/local-preview${query}`),
  );
  return response.previews;
}

export async function startDeepUnderstandingRun(input: {
  selectedTier1Sources?: string[];
  customNoteDirectories?: string[];
  excludeIds?: string[];
  precollectedItems?: Array<{
    id: string;
    sourceId: string;
    type: 'document' | 'calendar_event' | 'task' | 'note' | 'mail' | 'message' | 'code_activity' | 'bookmark';
    title: string;
    group?: string;
    resourceUri?: string;
    occurredAt?: number;
    modifiedAt?: number;
    startsAt?: number;
    endsAt?: number;
    text?: string;
    ownerAttribution: 'user' | 'other' | 'shared' | 'unknown';
    sensitivity: 'normal' | 'personal' | 'secret' | 'regulated';
    evidenceRef: string;
  }>;
  sourceCheckpoints?: Record<string, { fingerprint: string; collectedAt: number }>;
  processingPolicy: WorkDiscoveryProcessingPolicy;
  locale?: string;
}): Promise<DeepUnderstandingRun> {
  const response = await fetchJson<{ run: DeepUnderstandingRun }>(apiUrl('/api/context-sources/understanding-runs'), {
    method: 'POST',
    body: JSON.stringify({
      ...input,
      locale: input.locale ?? currentUiLocale(),
    }),
  });
  return response.run;
}

export async function fetchDeepUnderstandingRun(runId: string): Promise<DeepUnderstandingRun> {
  const response = await fetchJson<{ run: DeepUnderstandingRun }>(
    apiUrl(`/api/context-sources/understanding-runs/${encodeURIComponent(runId)}`),
  );
  return response.run;
}

export async function fetchLatestDeepUnderstandingRun(): Promise<DeepUnderstandingRun | null> {
  const response = await fetchJson<{ run: DeepUnderstandingRun | null }>(
    apiUrl('/api/context-sources/understanding-runs/latest'),
  );
  return response.run;
}

export async function cancelDeepUnderstandingRun(runId: string): Promise<DeepUnderstandingRun> {
  const response = await fetchJson<{ run: DeepUnderstandingRun }>(
    apiUrl(`/api/context-sources/understanding-runs/${encodeURIComponent(runId)}/cancel`),
    { method: 'POST' },
  );
  return response.run;
}

export async function confirmDeepUnderstandingRun(
  runId: string,
  input: DeepUnderstandingConfirmationInput,
): Promise<{ ok: boolean; confirmedAssertionIds: string[]; createdRuleIds: string[] }> {
  return fetchJson<{ ok: boolean; confirmedAssertionIds: string[]; createdRuleIds: string[] }>(
    apiUrl(`/api/context-sources/understanding-runs/${encodeURIComponent(runId)}/confirm`),
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export async function startWorkDiscoveryRun(rootPath: string, locale = currentUiLocale()): Promise<WorkDiscoveryRun> {
  const response = await fetchJson<{ run: WorkDiscoveryRun }>(apiUrl('/api/work-discovery/runs'), {
    method: 'POST',
    body: JSON.stringify({
      rootPath,
      source: 'onboarding_selected_directory',
      idempotencyKey: crypto.randomUUID(),
      locale,
    }),
  });
  return response.run;
}

export async function fetchWorkDiscoveryRun(runId: string): Promise<WorkDiscoveryRun> {
  const response = await fetchJson<{ run: WorkDiscoveryRun }>(apiUrl(`/api/work-discovery/runs/${encodeURIComponent(runId)}`));
  return response.run;
}

export async function cancelWorkDiscoveryRun(runId: string): Promise<WorkDiscoveryRun> {
  const response = await fetchJson<{ run: WorkDiscoveryRun }>(apiUrl(`/api/work-discovery/runs/${encodeURIComponent(runId)}/cancel`), {
    method: 'POST',
  });
  return response.run;
}

export async function retryWorkDiscoveryRun(runId: string): Promise<WorkDiscoveryRun> {
  const response = await fetchJson<{ run: WorkDiscoveryRun }>(apiUrl(`/api/work-discovery/runs/${encodeURIComponent(runId)}/retry`), {
    method: 'POST',
  });
  return response.run;
}

export async function submitWorkDiscoveryRecognitionFeedback(
  runId: string,
  decision: 'confirmed' | 'corrected' | 'different_goal' | 'dismissed',
  correctedIntent?: string,
): Promise<WorkDiscoveryRun> {
  const response = await fetchJson<{ run: WorkDiscoveryRun }>(apiUrl(
    `/api/work-discovery/runs/${encodeURIComponent(runId)}/recognition-feedback`,
  ), {
    method: 'POST',
    body: JSON.stringify({ decision, ...(correctedIntent ? { correctedIntent } : {}) }),
  });
  return response.run;
}

export async function selectWorkDiscoverySuggestion(runId: string, suggestionId: string): Promise<void> {
  await fetchJson(apiUrl(`/api/work-discovery/runs/${encodeURIComponent(runId)}/suggestions/${encodeURIComponent(suggestionId)}/select`), {
    method: 'POST',
  });
}
