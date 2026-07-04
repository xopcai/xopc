import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type DreamingPhaseId = 'light' | 'deep' | 'rem';

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

/** Lightweight last-run payload for light / rem phases. */
export type PhaseLastRun =
  | { exists: false }
  | { exists: true; path: string; raw: unknown };

export type DreamingGatewayStatus = {
  agentId: string;
  memory: Record<string, unknown>;
  workspaceDir: string;
  config: {
    enabled: boolean;
    frequency: string;
    timezone: string;
    phases: {
      light: { enabled: boolean; cron: string; lookbackDays: number; limit: number; dedupeSimilarity: number };
      deep: { enabled: boolean; cron: string; minScore: number; minRecallCount: number; minUniqueQueries: number; limit: number; recencyHalfLifeDays: number; maxAgeDays: number };
      rem: { enabled: boolean; cron: string; lookbackDays: number; limit: number; minPatternStrength: number };
    };
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
  lightLastRun: PhaseLastRun;
  remLastRun: PhaseLastRun;
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

export async function postDreamingRunNow(phase: DreamingPhaseId = 'deep'): Promise<{ phase: DreamingPhaseId; result: unknown }> {
  const res = await fetchJson<{ ok?: boolean; payload?: { phase?: string; result?: unknown } }>(
    apiUrl('/api/dreaming/run'),
    { method: 'POST', body: JSON.stringify({ phase }) },
  );
  if (res.ok === false || !res.payload) throw new Error('Failed to run dreaming phase');
  const returnedPhase = res.payload.phase;
  return {
    phase: returnedPhase === 'light' || returnedPhase === 'deep' || returnedPhase === 'rem' ? returnedPhase : phase,
    result: res.payload.result,
  };
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
  recencyDecay: number;
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

// ── Event audit log ────────────────────────────────────────────────────

export type DreamingEvent = {
  timestamp: string;
  phase: DreamingPhaseId;
  ok: boolean;
  reason: string;
  durationMs: number;
  // Light-specific
  scannedEntries?: number;
  newSignals?: number;
  deduped?: number;
  // Deep-specific
  candidates?: number;
  applied?: number;
  // REM-specific
  patternsDiscovered?: number;
  entriesAnalyzed?: number;
};

export async function fetchDreamingEvents(limit = 50): Promise<DreamingEvent[]> {
  const q = `?limit=${encodeURIComponent(String(limit))}`;
  const res = await fetchJson<{ ok?: boolean; payload?: { events: DreamingEvent[] } }>(apiUrl(`/api/dreaming/events${q}`));
  return res.payload?.events ?? [];
}
