import type { MemoryRecord, MemoryStatus } from './types.js';

export type MemoryStabilityBand = 'strong' | 'working' | 'fragile';

const DAY_MS = 86_400_000;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function reviewIntervalDays(record: Pick<MemoryRecord, 'durability' | 'explicitness'>): number {
  if (record.durability === 'ephemeral') return 14;
  if (record.durability === 'recurring') return record.explicitness === 'explicit' ? 120 : 60;
  if (record.explicitness === 'explicit') return 365;
  if (record.explicitness === 'observed') return 180;
  return 90;
}

export function nextMemoryReviewAt(
  record: Pick<MemoryRecord, 'durability' | 'explicitness'>,
  fromMs = Date.now(),
): string {
  return new Date(fromMs + reviewIntervalDays(record) * DAY_MS).toISOString();
}

export function resolveMemoryStability(record: MemoryRecord, nowMs = Date.now()): {
  score: number;
  band: MemoryStabilityBand;
  reviewAt: string;
  reviewDue: boolean;
  expired: boolean;
} {
  const confidence = clamp01(record.confidence ?? 0.5);
  const explicitness = record.explicitness === 'explicit' ? 1 : record.explicitness === 'observed' ? 0.7 : 0.45;
  const durability = record.durability === 'durable' ? 1 : record.durability === 'recurring' ? 0.85 : 0.55;
  const evidence = record.evidence ?? [];
  const evidenceConfidence = evidence.length > 0
    ? evidence.reduce((sum, item) => sum + clamp01(item.confidence ?? confidence), 0) / evidence.length
    : confidence * 0.8;
  const evidenceStrength = clamp01(evidenceConfidence * 0.75 + Math.min(evidence.length, 4) * 0.0625);
  const updatedAtMs = Date.parse(record.updatedAt);
  const ageDays = Number.isFinite(updatedAtMs) ? Math.max(0, (nowMs - updatedAtMs) / DAY_MS) : 0;
  const halfLifeDays = record.durability === 'ephemeral' ? 21 : record.durability === 'recurring' ? 120 : 365;
  const freshnessFloor = record.explicitness === 'explicit' ? 0.72 : record.explicitness === 'observed' ? 0.48 : 0.28;
  const freshness = freshnessFloor + (1 - freshnessFloor) * Math.pow(0.5, ageDays / halfLifeDays);
  const raw = confidence * 0.32
    + explicitness * 0.2
    + clamp01(record.importance) * 0.16
    + durability * 0.14
    + evidenceStrength * 0.18;
  const score = Math.round(clamp01(raw * freshness) * 1000) / 1000;
  const band: MemoryStabilityBand = score >= 0.75 ? 'strong' : score >= 0.5 ? 'working' : 'fragile';
  const inferredReviewAt = nextMemoryReviewAt(record, Number.isFinite(updatedAtMs) ? updatedAtMs : nowMs);
  const reviewAt = record.reviewAfter && Number.isFinite(Date.parse(record.reviewAfter))
    ? record.reviewAfter
    : inferredReviewAt;
  const expired = Boolean(
    (record.expiresAt && Date.parse(record.expiresAt) <= nowMs)
    || (record.validTo && Date.parse(record.validTo) <= nowMs),
  );
  const reviewDue = record.status === 'candidate'
    || record.status === 'needs_review'
    || record.status === 'stale'
    || Date.parse(reviewAt) <= nowMs;
  return { score, band, reviewAt, reviewDue, expired };
}

export function effectiveMemoryStatus(record: MemoryRecord, nowMs = Date.now()): MemoryStatus {
  const lifecycle = resolveMemoryStability(record, nowMs);
  if (lifecycle.expired && record.status === 'active') return 'stale';
  if (lifecycle.reviewDue && record.status === 'active') return 'needs_review';
  return record.status ?? 'active';
}
