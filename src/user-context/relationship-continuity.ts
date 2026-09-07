import { createHash } from 'node:crypto';

import { createContextEvidence } from '../storage/sqlite/context-evidence-repository.js';
import { reconcileAssertion, type UserAssertion } from '../user-model/index.js';

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
}): UserAssertion | null {
  const now = input.nowMs ?? Date.now();
  const request = extractExplicitRelationshipFollowUp(input.message, now);
  if (!request) return null;
  const key = hash(request.subject.toLocaleLowerCase());
  const evidence = createContextEvidence({
    sourceType: 'conversation',
    sourceRef: `session:${input.sessionKey}:follow-up:${hash(input.message)}`,
    redactedExcerpt: input.message.slice(0, 600),
    trustLevel: 'owner',
    observedAt: now,
  });
  return reconcileAssertion({
    subject: { type: 'topic', id: key },
    predicate: `relationship.follow_up.${key}`,
    cardinality: 'single',
    scope: { type: 'global' },
    kind: 'relationship',
    value: request.subject,
    normalizedValue: request.subject.toLocaleLowerCase(),
    statement: request.subject,
    authority: 'user_explicit',
    confidence: 1,
    declaredImportance: 0.8,
    inferredImportance: 0.8,
    consequence: 'medium',
    actionability: 1,
    volatility: 'slow',
    sensitivity: 'normal',
    disclosurePolicy: 'referenceable',
    ...(request.validFrom ? { validFrom: request.validFrom } : {}),
    observedAt: now,
    createdBy: 'user',
    evidenceId: evidence.id,
    evidenceConfidence: 1,
  }, now).assertion;
}
