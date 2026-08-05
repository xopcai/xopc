import type { UnderstandingCandidate, UnderstandingReviewResult } from '../agent/memory/understanding/types.js';
import type { MemoryManager } from '../agent/memory/manager.js';
import {
  linkUserClaimMemoryRecord,
  listKnowledgeSourceItems,
  reinforceUserClaim,
  resolveUserEntity,
  type UserClaim,
  type UserClaimClass,
} from '../storage/sqlite/index.js';
import type { KnowledgeSourceItem } from './types.js';

export type ClaimObservation = {
  class: UserClaimClass;
  key: string;
  value: Record<string, unknown>;
  subject?: Parameters<typeof resolveUserEntity>[0];
  items: KnowledgeSourceItem[];
  windowDays: number;
};

function logicalEventKey(item: KnowledgeSourceItem): string | undefined {
  const value = item.metadata.logicalEventKey;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function eventTime(item: KnowledgeSourceItem): number | undefined {
  if (!item.occurredAt) return undefined;
  const value = Date.parse(item.occurredAt);
  return Number.isFinite(value) ? value : undefined;
}

function recent(items: KnowledgeSourceItem[], days: number): KnowledgeSourceItem[] {
  const now = Date.now();
  const cutoff = now - days * 86_400_000;
  return items.filter((item) => {
    const time = eventTime(item);
    return time !== undefined && time >= cutoff && time <= now + 300_000 && logicalEventKey(item);
  });
}

function person(value: unknown): { name?: string; email?: string; username?: string } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const read = (field: string) => typeof row[field] === 'string' && row[field].trim()
    ? row[field].trim().slice(0, 160)
    : undefined;
  const result = { name: read('name'), email: read('email'), username: read('username') };
  return result.name || result.email || result.username ? result : undefined;
}

function relationshipObservations(items: KnowledgeSourceItem[]): ClaimObservation[] {
  const grouped = new Map<string, {
    label: string;
    handles: Parameters<typeof resolveUserEntity>[0]['handles'];
    events: Map<string, KnowledgeSourceItem>;
  }>();
  for (const item of recent(items, 90)) {
    if (item.metadata.actorAttributed !== true) continue;
    const owners = new Set(Array.isArray(item.metadata.ownerIdentities)
      ? item.metadata.ownerIdentities.filter((value): value is string => typeof value === 'string').map((value) => value.toLowerCase())
      : []);
    const values = item.metadata.personEntities;
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      const signal = person(value);
      if (!signal) continue;
      const strongIdentity = (signal.email ?? signal.username)?.toLowerCase();
      if (strongIdentity && owners.has(strongIdentity)) continue;
      const label = signal.name ?? signal.email ?? signal.username!;
      const handles = [
        ...(signal.email ? [{ type: 'email' as const, value: signal.email, sourceScope: 'global', verified: true }] : []),
        ...(signal.username ? [{
          type: 'provider_user' as const, value: signal.username,
          sourceScope: String(item.metadata.toolkit ?? item.sourceInstanceId), verified: true,
        }] : []),
        ...(signal.name ? [{
          type: 'display_name' as const, value: signal.name, sourceScope: item.sourceInstanceId, verified: false,
        }] : []),
      ];
      const identityKey = signal.email?.toLowerCase()
        ?? `${String(item.metadata.toolkit ?? item.sourceInstanceId)}:${signal.username?.toLowerCase() ?? signal.name?.toLowerCase()}`;
      const entry = grouped.get(identityKey) ?? { label, handles, events: new Map() };
      const eventKey = logicalEventKey(item)!;
      if (!entry.events.has(eventKey)) entry.events.set(eventKey, item);
      grouped.set(identityKey, entry);
    }
  }
  return [...grouped.values()]
    .sort((left, right) => right.events.size - left.events.size)
    .slice(0, 8)
    .map((entry) => ({
      class: 'relationship',
      key: 'person',
      value: { label: entry.label },
      subject: { type: 'person', canonicalLabel: entry.label, handles: entry.handles },
      items: [...entry.events.values()],
      windowDays: 90,
    }));
}

function routineObservations(items: KnowledgeSourceItem[]): ClaimObservation[] {
  const slots = new Map<string, Map<string, KnowledgeSourceItem>>();
  for (const item of recent(items, 120).filter((candidate) => candidate.itemType === 'calendar_event')) {
    const date = new Date(item.occurredAt!);
    const slot = `${date.getUTCDay()}:${date.getUTCHours()}`;
    const events = slots.get(slot) ?? new Map<string, KnowledgeSourceItem>();
    const eventKey = logicalEventKey(item)!;
    if (!events.has(eventKey)) events.set(eventKey, item);
    slots.set(slot, events);
  }
  return [...slots.entries()]
    .sort((left, right) => right[1].size - left[1].size)
    .slice(0, 4)
    .map(([slot, events]) => {
      const [weekday, hour] = slot.split(':').map(Number);
      return {
        class: 'routine' as const,
        key: `calendar-slot:${slot}`,
        value: { weekday, hour, timezone: 'UTC' },
        items: [...events.values()],
        windowDays: 120,
      };
    });
}

function projectObservations(items: KnowledgeSourceItem[]): ClaimObservation[] {
  const grouped = new Map<string, { label: string; events: Map<string, KnowledgeSourceItem> }>();
  for (const item of recent(items, 60)) {
    if (item.metadata.observationKind !== 'activity' || item.metadata.actorAttributed !== true) continue;
    const subject = typeof item.metadata.subjectKey === 'string' ? item.metadata.subjectKey.trim() : '';
    if (!subject) continue;
    const entry = grouped.get(subject.toLowerCase()) ?? { label: subject, events: new Map<string, KnowledgeSourceItem>() };
    const events = entry.events;
    const eventKey = logicalEventKey(item)!;
    if (!events.has(eventKey)) events.set(eventKey, item);
    grouped.set(subject.toLowerCase(), entry);
  }
  return [...grouped.entries()]
    .sort((left, right) => right[1].events.size - left[1].events.size)
    .slice(0, 8)
    .map(([, entry]) => {
      const { label: subject, events } = entry;
      return {
        class: 'project' as const,
        key: 'project',
        value: { label: subject },
        subject: {
          type: 'project' as const,
          canonicalLabel: subject,
          handles: [{ type: 'provider_user' as const, value: subject, sourceScope: 'project', verified: true }],
        },
        items: [...events.values()],
        windowDays: 60,
      };
    });
}

export function deriveConnectedClaimObservations(items: KnowledgeSourceItem[]): ClaimObservation[] {
  const active = items.filter((item) => (
    !item.deletedAt
    && item.synthesisPipeline === 'connected_knowledge'
    && item.sensitivity !== 'secret'
    && item.sensitivity !== 'regulated'
    && item.metadata.observationKind !== 'inventory'
  ));
  return [...relationshipObservations(active), ...routineObservations(active), ...projectObservations(active)];
}

export function renderUserClaim(claim: UserClaim): UnderstandingCandidate {
  const label = typeof claim.value.label === 'string' ? claim.value.label : '';
  if (claim.class === 'relationship') {
    return {
      kind: 'relationship', content: `Frequently collaborates with ${label}.`, canonicalKey: `claim:${claim.id}`,
      confidence: claim.confidence, importance: 0.65, explicitness: 'inferred', durability: 'recurring',
      sensitivity: 'personal', disclosurePolicy: 'ask_before_reference', tags: ['connected-source', 'structured-claim'],
    };
  }
  if (claim.class === 'project') {
    return {
      kind: 'project_context', content: `Recently contributed repeatedly to ${label}.`, canonicalKey: `claim:${claim.id}`,
      confidence: claim.confidence, importance: 0.72, explicitness: 'inferred', durability: 'recurring',
      sensitivity: 'personal', disclosurePolicy: 'referenceable', tags: ['connected-source', 'structured-claim'],
    };
  }
  const weekday = Number(claim.value.weekday);
  const hour = Number(claim.value.hour);
  const weekdayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][weekday] ?? 'Unknown';
  return {
    kind: 'routine', content: `Often has calendar activity on ${weekdayName} around ${String(hour).padStart(2, '0')}:00 UTC.`,
    canonicalKey: `claim:${claim.id}`, confidence: claim.confidence, importance: 0.58,
    explicitness: 'inferred', durability: 'recurring', sensitivity: 'personal', disclosurePolicy: 'referenceable',
    tags: ['connected-source', 'structured-claim'],
  };
}

export class ConnectedUnderstandingPipeline {
  constructor(private readonly memoryManager: MemoryManager) {}

  async process(sourceInstanceId: string, connectorId: string, agentId: string): Promise<UnderstandingReviewResult> {
    const items = listKnowledgeSourceItems({ sourceInstanceId, includeDeleted: false, limit: 500 });
    const observations = deriveConnectedClaimObservations(items);
    const totals: UnderstandingReviewResult = {
      proposed: observations.length, created: 0, deduplicated: 0, rejected: 0, createdRecords: [],
    };
    for (const observation of observations) {
      const subject = observation.subject ? resolveUserEntity(observation.subject) : undefined;
      const claim = reinforceUserClaim({
        agentId,
        class: observation.class,
        key: subject ? `${observation.key}:${subject.id}` : observation.key,
        subjectEntityId: subject?.id,
        value: observation.value,
        evidence: observation.items.map((item) => ({
          logicalEventKey: logicalEventKey(item)!,
          sourceItemId: item.id,
          sourceInstanceId: item.sourceInstanceId,
          relation: 'supports',
          observedAt: item.occurredAt!,
        })),
      });
      if (claim.state !== 'active') continue;
      const result = await this.memoryManager.applyUnderstandingCandidates([renderUserClaim(claim)], {
        agentId,
        sourceItemIds: observation.items.map((item) => item.id).slice(0, 20),
        sourceText: JSON.stringify({
          claimId: claim.id,
          independentEvidenceCount: claim.independentEvidenceCount,
          activeDays: claim.activeDayCount,
          windowDays: observation.windowDays,
        }),
        source: { provider: connectorId, sourceInstanceId },
        reviewSource: 'background',
      });
      const memoryRecordId = result.createdRecords[0]?.id;
      if (memoryRecordId) linkUserClaimMemoryRecord(claim.id, memoryRecordId);
      totals.created += result.created;
      totals.deduplicated += result.deduplicated;
      totals.rejected += result.rejected;
      totals.createdRecords.push(...result.createdRecords);
    }
    return totals;
  }
}
