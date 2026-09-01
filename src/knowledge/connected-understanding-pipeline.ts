import type { UnderstandingCandidate, UnderstandingReviewResult } from '../agent/memory/understanding/types.js';
import type { MemoryManager } from '../agent/memory/manager.js';
import {
  clusterUnderstandingSignals,
  type UnderstandingSignal,
} from '../user-context/sources/signal-clustering.js';
import {
  listKnowledgeSourceItems,
} from '../storage/sqlite/index.js';
import type { KnowledgeSourceItem } from './types.js';
import {
  personIdForIdentity,
  personIdentityKey,
  rebuildUserPeopleIndex,
} from '../user-context/relationships/indexer.js';

export type ClaimObservation = {
  class: 'relationship' | 'project' | 'routine';
  key: string;
  value: Record<string, unknown>;
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

function normalizedRecord(item: KnowledgeSourceItem): Record<string, unknown> {
  if (!item.normalizedText) return {};
  try {
    const value = JSON.parse(item.normalizedText) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function textField(record: Record<string, unknown>, ...fields: string[]): string | undefined {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = value as Record<string, unknown>;
      for (const nestedField of ['name', 'full_name', 'fullName', 'title']) {
        const nestedValue = nested[nestedField];
        if (typeof nestedValue === 'string' && nestedValue.trim()) return nestedValue.trim();
      }
    }
  }
  return undefined;
}

function normalizeConversationTitle(value: string): string {
  return value.replace(/^(?:(?:re|fwd?|回复|转发)\s*[:：]\s*)+/i, '').trim();
}

function projectSignal(item: KnowledgeSourceItem): UnderstandingSignal | undefined {
  if (item.metadata.actorAttributed !== true) return undefined;
  const observationKind = item.metadata.observationKind;
  if (!['activity', 'message', 'calendar_event', 'external_task', 'document_metadata'].includes(String(observationKind))) {
    return undefined;
  }
  const record = normalizedRecord(item);
  const title = textField(record, 'subject', 'title', 'repository', 'project', 'fullName', 'full_name', 'name');
  const subjectKey = typeof item.metadata.subjectKey === 'string' && item.metadata.subjectKey.trim()
    ? item.metadata.subjectKey.trim()
    : undefined;
  const displayTitle = title ? normalizeConversationTitle(title) : subjectKey;
  if (!displayTitle) return undefined;
  return {
    evidenceRef: item.id,
    sourceId: item.sourceInstanceId,
    title: displayTitle,
    group: typeof item.metadata.toolkit === 'string' ? item.metadata.toolkit : undefined,
    subjectKey,
    occurredAt: eventTime(item),
  };
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
    personId: string;
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
      const identityKey = personIdentityKey(signal, item.sourceInstanceId);
      const personId = personIdForIdentity(signal, item.sourceInstanceId);
      if (!identityKey || !personId) continue;
      const entry = grouped.get(identityKey) ?? { label, personId, events: new Map() };
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
      key: `person:${entry.personId}`,
      value: { label: entry.label, personId: entry.personId },
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
  const recentItems = recent(items, 60);
  const byId = new Map(recentItems.map((item) => [item.id, item]));
  const signals = recentItems.map(projectSignal).filter((signal): signal is UnderstandingSignal => Boolean(signal));
  return clusterUnderstandingSignals(signals)
    .flatMap((cluster): ClaimObservation[] => {
      const events = new Map<string, KnowledgeSourceItem>();
      for (const signal of cluster.signals) {
        const item = byId.get(signal.evidenceRef);
        const eventKey = item && logicalEventKey(item);
        if (item && eventKey && !events.has(eventKey)) events.set(eventKey, item);
      }
      if (![...events.values()].some((item) => item.itemType !== 'calendar_event')) return [];
      return [{
        class: 'project',
        key: `project:${cluster.key}`,
        value: { label: cluster.title },
        items: [...events.values()],
        windowDays: 60,
      }];
    })
    .sort((left, right) => right.items.length - left.items.length)
    .slice(0, 8);
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

function confidenceFor(observation: ClaimObservation): number {
  const days = new Set(observation.items.map((item) => item.occurredAt?.slice(0, 10)).filter(Boolean)).size;
  return Math.min(0.92, 0.48 + Math.min(observation.items.length, 8) * 0.035 + Math.min(days, 5) * 0.045);
}

function isDurableObservation(observation: ClaimObservation): boolean {
  const days = new Set(observation.items.map((item) => item.occurredAt?.slice(0, 10)).filter(Boolean)).size;
  return observation.items.length >= 3 && days >= (observation.class === 'routine' ? 3 : 2);
}

export function renderConnectedObservation(observation: ClaimObservation): UnderstandingCandidate {
  const label = typeof observation.value.label === 'string' ? observation.value.label : '';
  const confidence = confidenceFor(observation);
  if (observation.class === 'relationship') {
    return {
      kind: 'relationship', content: `Frequently collaborates with ${label}.`, canonicalKey: `connected:${observation.key}`,
      payload: typeof observation.value.personId === 'string' ? { personId: observation.value.personId } : undefined,
      confidence, importance: 0.65, explicitness: 'inferred', durability: 'recurring',
      sensitivity: 'personal', disclosurePolicy: 'ask_before_reference',
    };
  }
  if (observation.class === 'project') {
    return {
      kind: 'project_context', content: `Recently contributed repeatedly to ${label}.`, canonicalKey: `connected:${observation.key}`,
      confidence, importance: 0.72, explicitness: 'inferred', durability: 'recurring',
      sensitivity: 'personal', disclosurePolicy: 'referenceable',
    };
  }
  const weekday = Number(observation.value.weekday);
  const hour = Number(observation.value.hour);
  const weekdayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][weekday] ?? 'Unknown';
  return {
    kind: 'routine', content: `Often has calendar activity on ${weekdayName} around ${String(hour).padStart(2, '0')}:00 UTC.`,
    canonicalKey: `connected:${observation.key}`, confidence, importance: 0.58,
    explicitness: 'inferred', durability: 'recurring', sensitivity: 'personal', disclosurePolicy: 'referenceable',
  };
}

export class ConnectedUnderstandingPipeline {
  constructor(private readonly memoryManager: MemoryManager) {}

  async process(agentId: string, extractionRunId: string): Promise<UnderstandingReviewResult> {
    rebuildUserPeopleIndex();
    const items = listKnowledgeSourceItems({ agentId, includeDeleted: false, limit: 500 });
    const observations = deriveConnectedClaimObservations(items);
    const totals: UnderstandingReviewResult = {
      proposed: observations.length, created: 0, deduplicated: 0, rejected: 0, createdRecords: [],
    };
    for (const observation of observations) {
      if (!isDurableObservation(observation)) continue;
      const sourceInstanceIds = [...new Set(observation.items.map((item) => item.sourceInstanceId))];
      const result = await this.memoryManager.applyUnderstandingCandidates([renderConnectedObservation(observation)], {
        sourceItemIds: observation.items.map((item) => item.id).slice(0, 20),
        sourceText: JSON.stringify({
          independentEvidenceCount: observation.items.length,
          activeDays: new Set(observation.items.map((item) => item.occurredAt?.slice(0, 10))).size,
          windowDays: observation.windowDays,
        }),
        source: {
          provider: 'connected-sources',
          ...(sourceInstanceIds.length === 1 ? { sourceInstanceId: sourceInstanceIds[0] } : {}),
        },
        reviewSource: 'background',
        extractionRunId,
      });
      totals.created += result.created;
      totals.deduplicated += result.deduplicated;
      totals.rejected += result.rejected;
      totals.createdRecords.push(...result.createdRecords);
      totals.writeOutputs = [...(totals.writeOutputs ?? []), ...(result.writeOutputs ?? [])];
    }
    return totals;
  }
}
