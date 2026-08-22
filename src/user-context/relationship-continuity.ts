import { createHash } from 'node:crypto';

import {
  createContextEvidence,
  createUnderstanding,
  linkUnderstandingEvidence,
  listUnderstandings,
} from '../storage/sqlite/index.js';
import type { UserUnderstanding } from './domain.js';

export interface RelationshipFollowUpRequest {
  subject: string;
  validFrom?: number;
}

const CHINESE_FOLLOW_UP_PATTERN = /^(?:请|记得|麻烦|帮我)?\s*(?:明天|下周|之后|到时候)?\s*(?:提醒我|问问我|跟进一下|跟进)(?:关于)?[：:，,\s]*(.+)$/;
const ENGLISH_FOLLOW_UP_PATTERN = /^(?:please\s+)?(?:remember to\s+)?(?:(?:tomorrow|next week|later)\s+)?(?:follow up with me|check in with me|ask me)(?: about)?[,\s:]+(.+)$/i;

function normalizeFollowUpSubject(value: string | undefined): string | null {
  const subject = value?.trim();
  if (!subject || subject.length > 240) return null;
  if (/^(?:的|地|得|以及|并且|和|与|、|，|。|；|：)/.test(subject)) return null;
  return subject;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 20);
}

export function extractExplicitRelationshipFollowUp(
  message: string,
  nowMs = Date.now(),
): RelationshipFollowUpRequest | null {
  const text = message.trim();
  const match = text.match(CHINESE_FOLLOW_UP_PATTERN) ?? text.match(ENGLISH_FOLLOW_UP_PATTERN);
  const subject = normalizeFollowUpSubject(match?.[1]);
  if (!subject) return null;
  const delayMs = /明天|tomorrow/i.test(text)
    ? 86_400_000
    : /下周|next week/i.test(text) ? 7 * 86_400_000 : 0;
  return { subject, ...(delayMs ? { validFrom: nowMs + delayMs } : {}) };
}

export function recordExplicitRelationshipFollowUp(input: {
  sessionKey: string;
  message: string;
  nowMs?: number;
}): UserUnderstanding | null {
  const request = extractExplicitRelationshipFollowUp(input.message, input.nowMs);
  if (!request) return null;
  const canonicalKey = `relationship-follow-up:${hash(request.subject.toLocaleLowerCase())}`;
  const existing = listUnderstandings().find((item) =>
    item.canonicalKey === canonicalKey && item.scope.type === 'global'
    && item.status !== 'rejected' && item.status !== 'archived');
  if (existing) return existing;
  const understanding = createUnderstanding({
    kind: 'relationship', canonicalKey, status: 'active', scope: { type: 'global' },
    explicitness: 'explicit', durability: 'recurring', sensitivity: 'normal',
    disclosurePolicy: 'referenceable', confidence: 1, statement: request.subject,
    ...(request.validFrom ? { validFrom: request.validFrom } : {}),
    createdBy: 'user', changeReason: 'Explicit follow-up request',
  });
  const evidence = createContextEvidence({
    sourceType: 'conversation',
    sourceRef: `session:${input.sessionKey}:follow-up:${hash(input.message)}`,
    redactedExcerpt: input.message.slice(0, 600), trustLevel: 'owner',
    observedAt: input.nowMs ?? Date.now(),
  });
  linkUnderstandingEvidence(understanding.versionId, evidence.id, 'supports', 1);
  return understanding;
}
