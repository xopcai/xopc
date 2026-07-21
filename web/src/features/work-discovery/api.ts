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

export type WorkDiscoveryResult = {
  projectSummary: string;
  currentState: string;
  uncertainties: string[];
  suggestions: WorkDiscoverySuggestion[];
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
    generatedAt: number;
  };
  provider: string;
  remoteModel: boolean;
  policyVersion: number;
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
