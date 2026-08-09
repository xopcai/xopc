import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type WorkDiscoveryStatus = 'queued' | 'probing' | 'analyzing' | 'completed' | 'failed' | 'canceled';
export type WorkDiscoveryStage = 'folder_structure' | 'recent_progress' | 'next_steps';

export type WorkDiscoverySuggestion = {
  id: string;
  actionType: 'summarize_recent_work' | 'inspect_related_tests' | 'plan_next_step';
  title: string;
  rationale: string;
  evidence: Array<{ path?: string; observation: string }>;
  actionPrompt: string;
  confidence: 'high' | 'medium' | 'low';
  expectedOutcome: string;
  estimatedMinutes: number;
  risk: 'analysis' | 'command' | 'file_write';
  verification: string[];
};

export type WorkDiscoveryProfileCandidate = {
  id: string;
  memoryRecordId?: string;
  category: 'role' | 'focus' | 'technology' | 'workflow' | 'preference';
  statement: string;
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];
  status: 'pending' | 'accepted' | 'edited' | 'rejected';
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
};

export type WorkDiscoveryResult = {
  projectSummary: string;
  currentState: string;
  uncertainties: string[];
  suggestions: WorkDiscoverySuggestion[];
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
  sessionKey: string;
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
  source: 'existing_project' | 'approved_directory' | 'common_work_root' | 'personal_work_root';
  projectId?: string;
  projectKind: 'coding' | 'general' | 'unknown';
  projectKindConfidence: number;
  score: number;
  lastActiveAt?: number;
  branch?: string;
  changedFileCount: number;
  evidence: string[];
};

export async function fetchWorkDiscoveryOnboarding() {
  return fetchJson<{
    enabled: boolean;
    state: { status: 'not_started' | 'in_progress' | 'completed' | 'dismissed'; activeRunId?: string };
  }>(apiUrl('/api/onboarding/work-discovery'));
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

export async function discoverWorkDiscoveryCandidates(): Promise<WorkDiscoveryCandidate[]> {
  const response = await fetchJson<{ candidates: WorkDiscoveryCandidate[] }>(apiUrl('/api/work-discovery/candidates'), {
    method: 'POST',
  });
  return response.candidates;
}

export type WorkDiscoveryDirectorySource = {
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
};

export async function fetchWorkDiscoveryDirectorySources(): Promise<WorkDiscoveryDirectorySource[]> {
  const response = await fetchJson<{ sources: WorkDiscoveryDirectorySource[] }>(apiUrl('/api/work-discovery/sources/directories'));
  return response.sources;
}

export async function grantWorkDiscoveryDirectory(rootPath: string): Promise<WorkDiscoveryDirectorySource> {
  const response = await fetchJson<{ source: WorkDiscoveryDirectorySource }>(apiUrl('/api/work-discovery/sources/directories'), {
    method: 'POST',
    body: JSON.stringify({ rootPath }),
  });
  return response.source;
}

export async function revokeWorkDiscoveryDirectory(sourceId: string): Promise<void> {
  await fetchJson(apiUrl(`/api/work-discovery/sources/directories/${encodeURIComponent(sourceId)}`), { method: 'DELETE' });
}

export async function rescanWorkDiscoveryDirectory(sourceId: string): Promise<WorkDiscoveryRun> {
  const response = await fetchJson<{ run: WorkDiscoveryRun }>(apiUrl(
    `/api/work-discovery/sources/directories/${encodeURIComponent(sourceId)}/runs`,
  ), {
    method: 'POST',
    body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
  });
  return response.run;
}

export async function refreshWorkDiscoveryDirectoryIfChanged(sourceId: string): Promise<{
  changed: boolean;
  run?: WorkDiscoveryRun;
}> {
  return fetchJson(apiUrl(
    `/api/work-discovery/sources/directories/${encodeURIComponent(sourceId)}/refresh-if-changed`,
  ), {
    method: 'POST',
    body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
  });
}

export async function importPersonalContextForWorkDiscovery(items: Array<{
  id: string;
  source: 'apple_notes' | 'calendar' | 'reminders';
  title: string;
  group?: string;
  createdAt?: number;
  modifiedAt?: number;
  startsAt?: number;
  endsAt?: number;
  content?: string;
}>, runId?: string): Promise<{
  profileCandidates: WorkDiscoveryProfileCandidate[];
  workThreads: WorkUnderstandingThread[];
}> {
  return fetchJson<{
    profileCandidates: WorkDiscoveryProfileCandidate[];
    workThreads: WorkUnderstandingThread[];
  }>(
    apiUrl('/api/work-discovery/personal-context/import'),
    { method: 'POST', body: JSON.stringify({ items, ...(runId ? { runId } : {}) }) },
  );
}

export async function updatePersonalContextWorkDiscoveryProfile(
  decisions: Array<{ memoryRecordId: string; status: 'accepted' | 'rejected' }>,
): Promise<void> {
  await fetchJson(apiUrl('/api/work-discovery/personal-context/profile'), {
    method: 'POST',
    body: JSON.stringify({ decisions }),
  });
}

export async function startWorkDiscoveryRun(rootPath: string): Promise<WorkDiscoveryRun> {
  const response = await fetchJson<{ run: WorkDiscoveryRun }>(apiUrl('/api/work-discovery/runs'), {
    method: 'POST',
    body: JSON.stringify({
      rootPath,
      source: 'onboarding_selected_directory',
      idempotencyKey: crypto.randomUUID(),
    }),
  });
  return response.run;
}

export async function startQuickWorkDiscoveryRun(): Promise<WorkDiscoveryRun> {
  const response = await fetchJson<{ run: WorkDiscoveryRun }>(apiUrl('/api/work-discovery/quick-runs'), {
    method: 'POST',
    body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
  });
  return response.run;
}

export async function updateWorkDiscoveryProfile(
  runId: string,
  decisions: Array<{ id: string; status: 'accepted' | 'edited' | 'rejected'; statement?: string }>,
): Promise<WorkDiscoveryRun> {
  const response = await fetchJson<{ run: WorkDiscoveryRun }>(apiUrl(
    `/api/work-discovery/runs/${encodeURIComponent(runId)}/profile`,
  ), {
    method: 'POST',
    body: JSON.stringify({ decisions }),
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
    body: JSON.stringify({ decision, correctedIntent }),
  });
  return response.run;
}

export async function selectWorkDiscoverySuggestion(runId: string, suggestionId: string): Promise<void> {
  await fetchJson(apiUrl(
    `/api/work-discovery/runs/${encodeURIComponent(runId)}/suggestions/${encodeURIComponent(suggestionId)}/select`,
  ), { method: 'POST' });
}
