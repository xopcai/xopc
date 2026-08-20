import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type DreamingPhaseId = 'light' | 'deep' | 'rem';

export type DreamingGatewayStatus = {
  agentId: string;
  memory: Record<string, unknown>;
  workspaceDir: string;
  dreamingRoot: string;
  config: {
    enabled: boolean;
    frequency: string;
    timezone: string;
    promotionWritePolicy: { decision: 'allow' | 'confirm' | 'deny'; reason: string };
    phases: {
      light: { enabled: boolean; cron: string; lookbackDays: number; limit: number };
      deep: { enabled: boolean; cron: string; minScore: number; minRecallCount: number; minUniqueQueries: number; limit: number; recencyHalfLifeDays: number; maxAgeDays: number };
      rem: { enabled: boolean; cron: string; lookbackDays: number; limit: number; minPatternStrength: number };
    };
    deep: { minScore: number; minRecallCount: number; minUniqueQueries: number; limit: number };
  };
  storePath: string;
  store: {
    signalCount: number;
    dreamingSignalCount: number;
    lastSignalAt: string | null;
  };
  traces: Array<{
    traceId: string;
    phase: string;
    resultCount?: number;
    selectedRecordIds: string[];
    error?: string;
    durationMs: number;
    createdAt: string;
  }>;
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
  recordId: string;
  content: string;
  score: number;
  avgScore: number;
  recallCount: number;
  uniqueQueries: number;
  recencyDecay: number;
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
