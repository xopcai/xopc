import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type TracingConfig = {
  enabled: boolean; capture: 'metadata' | 'redacted' | 'detailed'; detailedUntil?: number;
  local: { retentionDays: number; maxStoreMiB: number; maxTraces: number; maxSpans: number; maxTraceKiB: number; maxWriteMiBPerMinute: number };
  langfuse: { enabled: boolean; baseUrl: string };
};
export type TraceRecord = { traceId: string; spanId: string; parentSpanId?: string; name: string; type: string; startedAt: number; endedAt?: number; status: string; partialReason?: string; stats?: { generations: number; tokens: number; knownCostUsd: number; unknownCostCalls: number }; attributes: Record<string, string | number | boolean> };
export type TraceDetail = { trace: TraceRecord; spans: TraceRecord[] };
export type TraceSettings = { config: TracingConfig; credentials: { publicKeyConfigured: boolean; secretKeyConfigured: boolean; publicKeySource: string; secretKeySource: string; baseUrlSource: string } };
export type TraceStatus = {
  local: { physicalBytes?: number; bytes?: number; traces?: number; spans?: number; dropped?: number; queueDropped?: number; paused?: boolean; unavailable?: boolean; lastError?: string };
  langfuse: { state: string; pending: number; dropped: number; lastSuccess?: number; lastFailure?: number; lastError?: string };
};
export const traceUrl = (path: string) => apiUrl(`/api/observability/${path}`);
export async function traceRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  return fetchJson<T>(traceUrl(path), { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
