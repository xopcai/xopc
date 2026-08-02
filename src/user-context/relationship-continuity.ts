import type { MemoryRecord } from '../agent/memory/types.js';
import { listMemoryRecords, upsertMemoryRecord } from '../storage/sqlite/index.js';

export const RELATIONSHIP_FOLLOW_UP_TAG = 'relationship:follow-up';

export interface RelationshipFollowUpRequest {
  subject: string;
  reviewAfter?: string;
}

export function extractExplicitRelationshipFollowUp(
  message: string,
  nowMs = Date.now(),
): RelationshipFollowUpRequest | null {
  const text = message.trim();
  const match = text.match(/(?:请|记得)?(?:明天|下周|之后|到时候)?(?:提醒我|问问我|跟进一下|跟进)(?:关于)?[：:，,\s]*(.+)/)
    ?? text.match(/(?:remember to )?(?:follow up with me|check in with me|ask me)(?: about)?[,:\s]+(.+)/i);
  const subject = match?.[1]?.trim();
  if (!subject || subject.length > 240) return null;
  const delayMs = /明天|tomorrow/i.test(text)
    ? 24 * 60 * 60 * 1_000
    : /下周|next week/i.test(text)
      ? 7 * 24 * 60 * 60 * 1_000
      : 0;
  return {
    subject,
    ...(delayMs ? { reviewAfter: new Date(nowMs + delayMs).toISOString() } : {}),
  };
}

export function recordExplicitRelationshipFollowUp(input: {
  sessionKey: string;
  sourceAgentId: string;
  message: string;
  nowMs?: number;
}): MemoryRecord | null {
  const request = extractExplicitRelationshipFollowUp(input.message, input.nowMs);
  if (!request) return null;
  const existing = listMemoryRecords({ kind: 'commitment', status: 'active', limit: 200 })
    .find((record) => record.tags?.includes(RELATIONSHIP_FOLLOW_UP_TAG)
      && record.content === request.subject);
  if (existing) return existing;
  return upsertMemoryRecord({
    providerId: 'builtin',
    kind: 'commitment',
    sourceAgentId: input.sourceAgentId,
    sessionKey: input.sessionKey,
    content: request.subject,
    source: { provider: 'builtin' },
    tags: [RELATIONSHIP_FOLLOW_UP_TAG],
    status: 'active',
    explicitness: 'explicit',
    durability: 'recurring',
    importance: 0.8,
    disclosurePolicy: 'referenceable',
    ...(request.reviewAfter ? { reviewAfter: request.reviewAfter } : {}),
    nowMs: input.nowMs,
  });
}

export function buildRelationshipContinuityPrompt(
  records: MemoryRecord[],
  nowMs = Date.now(),
): string {
  const due = records
    .filter((record) => record.status === 'active')
    .filter((record) => record.tags?.includes(RELATIONSHIP_FOLLOW_UP_TAG))
    .filter((record) => !record.reviewAfter || Date.parse(record.reviewAfter) <= nowMs)
    .slice(0, 3);
  if (!due.length) return '';
  return [
    '## Relationship continuity',
    'The user explicitly asked for these follow-ups. Check in naturally when relevant; do not pretend to know an outcome.',
    ...due.map((record) => `- ${record.content}`),
  ].join('\n');
}
