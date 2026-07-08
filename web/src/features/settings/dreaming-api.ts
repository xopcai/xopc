import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type DreamingPhaseId = 'light' | 'deep' | 'rem';

/** Gateway payload shape for an agent's memories/.dreams/last-run.json. */
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
  memoriesDir: string;
  config: {
    enabled: boolean;
    frequency: string;
    timezone: string;
    phases: {
      light: { enabled: boolean; cron: string; lookbackDays: number; limit: number; dedupeSimilarity: number };
      deep: { enabled: boolean; cron: string; minScore: number; minRecallCount: number; minUniqueQueries: number; limit: number; recencyHalfLifeDays: number; maxAgeDays: number };
      rem: { enabled: boolean; cron: string; lookbackDays: number; limit: number; minPatternStrength: number };
    };
    deep: { minScore: number; minRecallCount: number; minUniqueQueries: number; limit: number };
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

function dreamingQuery(agentId?: string, extra?: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  if (agentId) params.set('agentId', agentId);
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value !== undefined) params.set(key, String(value));
  }
  const q = params.toString();
  return q ? `?${q}` : '';
}

export function dreamingSwrKey(agentId?: string): string {
  return apiUrl(`/api/dreaming${dreamingQuery(agentId)}`);
}

export async function fetchDreamingStatus(keyOrAgentId?: string): Promise<DreamingGatewayStatus> {
  const url = keyOrAgentId?.startsWith('/api/') || keyOrAgentId?.includes('/api/dreaming')
    ? keyOrAgentId
    : dreamingSwrKey(keyOrAgentId);
  const res = await fetchJson<{ ok?: boolean; payload?: DreamingGatewayStatus }>(url);
  if (!res.payload) throw new Error('Missing payload');
  return res.payload;
}

export async function postDreamingAction(action: 'reset_store' | 'clear_lock', agentId?: string): Promise<void> {
  await fetchJson(apiUrl('/api/dreaming/action'), { method: 'POST', body: JSON.stringify({ action, agentId }) });
}

export async function postDreamingRunNow(
  phase: DreamingPhaseId = 'deep',
  agentId?: string,
): Promise<{ agentId?: string; phase: DreamingPhaseId; result: unknown }> {
  const res = await fetchJson<{ ok?: boolean; payload?: { agentId?: string; phase?: string; result?: unknown } }>(
    apiUrl('/api/dreaming/run'),
    { method: 'POST', body: JSON.stringify({ phase, agentId }) },
  );
  if (res.ok === false || !res.payload) throw new Error('Failed to run dreaming phase');
  const returnedPhase = res.payload.phase;
  return {
    agentId: typeof res.payload.agentId === 'string' ? res.payload.agentId : undefined,
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

export async function fetchDreamingPreview(limit?: number, agentId?: string): Promise<DreamingPreviewResponse> {
  const res = await fetchJson<{ ok?: boolean; payload?: DreamingPreviewResponse }>(
    apiUrl(`/api/dreaming/preview${dreamingQuery(agentId, typeof limit === 'number' && Number.isFinite(limit) ? { limit } : undefined)}`),
  );
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

export async function fetchDreamingEvents(limit = 50, agentId?: string): Promise<DreamingEvent[]> {
  const res = await fetchJson<{ ok?: boolean; payload?: { events: DreamingEvent[] } }>(
    apiUrl(`/api/dreaming/events${dreamingQuery(agentId, { limit })}`),
  );
  return res.payload?.events ?? [];
}
