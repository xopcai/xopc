import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

/** Gateway payload shape for memory/.dreams/last-run.json (deep sweep). */
export type DreamingLastRunRecord = {
  version: 2;
  phase: 'deep';
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  ok: boolean;
  reason: string;
  errorMessage?: string;
  config: {
    enabled: boolean;
    minScore: number;
    minRecallCount: number;
    limit: number;
  };
  memoryPath: string;
  deep: {
    candidatesRanked: number;
    applied: number;
    skipped: {
      alreadyPromotedKey: number;
      rehydrateFailed: number;
      contaminated: number;
      hashDuplicate: number;
    };
  };
};

export type DreamingGatewayStatus = {
  workspaceDir: string;
  config: {
    enabled: boolean;
    frequency: string;
    timezone: string;
    deep: { minScore: number; minRecallCount: number; limit: number };
  };
  storePath: string;
  store: {
    version: number;
    updatedAt: string;
    entryCount: number;
    promotedCount: number;
    lastPromotedAt: string | null;
  };
  lock: | { locked: false } | { locked: true; path: string; content: string; mtimeMs?: number };
  lastRun:
    | { exists: false }
    | { exists: true; path: string; raw: unknown; record: DreamingLastRunRecord | null; parseError: string | null };
};

export function dreamingSwrKey(): string {
  return apiUrl('/api/dreaming');
}

export async function fetchDreamingStatus(): Promise<DreamingGatewayStatus> {
  const res = await fetchJson<{ ok?: boolean; payload?: DreamingGatewayStatus }>(dreamingSwrKey());
  if (!res.payload) throw new Error('Missing payload');
  return res.payload;
}

export async function postDreamingAction(action: 'reset_store' | 'clear_lock'): Promise<void> {
  await fetchJson(apiUrl('/api/dreaming/action'), { method: 'POST', body: JSON.stringify({ action }) });
}

export async function postDreamingRunNow(): Promise<{ triggered: boolean; jobId: string }> {
  const res = await fetchJson<{ ok?: boolean; payload?: { triggered?: boolean; jobId?: string } }>(
    apiUrl('/api/dreaming/run'),
    { method: 'POST', body: JSON.stringify({}) },
  );
  const triggered = Boolean(res.payload?.triggered);
  const jobId = typeof res.payload?.jobId === 'string' ? res.payload.jobId : '';
  if (!triggered || !jobId) throw new Error('Failed to trigger');
  return { triggered, jobId };
}

export type DreamingPreviewItem = {
  key: string;
  hash: string;
  snippet: string;
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  avgScore: number;
  recallCount: number;
  alreadyPromotedByKey: boolean;
  alreadyPromotedByHash: boolean;
  skippedReason: string | null;
};

export type DreamingPreviewResponse = {
  ok: boolean;
  reason: string;
  items: DreamingPreviewItem[];
  memoryPath: string;
};

export async function fetchDreamingPreview(limit?: number): Promise<DreamingPreviewResponse> {
  const q = typeof limit === 'number' && Number.isFinite(limit) ? `?limit=${encodeURIComponent(String(limit))}` : '';
  const res = await fetchJson<{ ok?: boolean; payload?: DreamingPreviewResponse }>(apiUrl(`/api/dreaming/preview${q}`));
  if (!res.payload) throw new Error('Missing payload');
  return res.payload;
}

