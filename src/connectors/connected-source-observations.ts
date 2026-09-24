import type { KnowledgeSourceItem } from '../knowledge/types.js';
import { recordUserModelObservation, type UserModelObservation } from '../user-model/index.js';
import type { UnderstandingConsentReceipt } from '../user-context/sources/types.js';

const DAY_MS = 86_400_000;

function timestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function observationShape(toolkit: string, item: KnowledgeSourceItem): {
  domain: UserModelObservation['domain']; type: string; value: Record<string, unknown>;
} | undefined {
  const occurredAt = timestamp(item.occurredAt) ?? timestamp(item.sourceUpdatedAt);
  const common = { itemType: item.itemType, ...(occurredAt === undefined ? {} : { occurredAt }) };
  if (toolkit === 'gmail') return { domain: 'behavior', type: 'sent_message_activity', value: common };
  if (toolkit === 'googlecalendar') return { domain: 'goals', type: 'calendar_commitment', value: common };
  if (toolkit === 'github') return { domain: 'capabilities', type: 'authored_code_activity', value: common };
  if (toolkit === 'linear') return { domain: 'goals', type: 'assigned_work_activity', value: common };
  if (toolkit === 'googledrive') return { domain: 'digital_life', type: 'document_activity', value: common };
  return undefined;
}

/** Stores content-free, owner-attributed observations before optional model analysis. */
export function recordConnectedSourceObservations(input: {
  items: KnowledgeSourceItem[];
  consent?: UnderstandingConsentReceipt;
  sourceGrantId?: string;
  nowMs?: number;
}): UserModelObservation[] {
  if (!input.consent || !input.sourceGrantId) return [];
  const now = input.nowMs ?? Date.now();
  return input.items.flatMap((item) => {
    if (item.metadata.actorAttributed !== true) return [];
    const toolkit = typeof item.metadata.toolkit === 'string' ? item.metadata.toolkit : '';
    const shape = observationShape(toolkit, item);
    if (!shape || !input.consent!.allowedDomains.includes(shape.domain)
      || input.consent!.deniedDomains.includes(shape.domain)) return [];
    const observedAt = timestamp(item.occurredAt) ?? timestamp(item.sourceUpdatedAt) ?? now;
    const value = {
      ...(input.consent!.allowedFields.includes('status') ? { itemType: shape.value.itemType } : {}),
      ...(input.consent!.allowedFields.includes('timestamps') && shape.value.occurredAt !== undefined
        ? { occurredAt: shape.value.occurredAt }
        : {}),
    };
    if (!Object.keys(value).length) return [];
    return [recordUserModelObservation({
      domain: shape.domain, type: shape.type, subject: { type: 'user', id: 'self' },
      value, context: { toolkit, collectionScope: item.collectionScope },
      sensitivityCategories: [], ownerAttribution: 'user', observedAt,
      deleteAfter: Math.max(now, observedAt) + input.consent!.rawRetentionDays * DAY_MS,
      sourceGrantId: input.sourceGrantId, sourceItemId: item.id,
      contentHash: `connected:${item.sourceInstanceId}:${item.contentHash}:${shape.type}`,
    })];
  });
}
