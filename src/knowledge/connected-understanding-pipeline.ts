import { createHash } from 'node:crypto';

import type { UnderstandingCandidate, UnderstandingReviewResult } from '../agent/memory/understanding/types.js';
import type { MemoryManager } from '../agent/memory/manager.js';
import { listKnowledgeSourceItems } from '../storage/sqlite/index.js';
import type { KnowledgeSourceItem } from './types.js';

type CandidateWithEvidence = {
  candidate: UnderstandingCandidate;
  sourceItemIds: string[];
  evidenceBasis: { eventCount: number; activeDays: number; windowDays: number };
};

function key(kind: UnderstandingCandidate['kind'], value: string): string {
  return `${kind}:connected:${createHash('sha256').update(value.toLowerCase()).digest('hex').slice(0, 20)}`;
}

function identityForPerson(value: unknown): { key: string; label: string } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const person = value as Record<string, unknown>;
  const read = (field: string) => typeof person[field] === 'string' ? person[field].trim().slice(0, 160) : '';
  const name = read('name');
  const email = read('email');
  const username = read('username');
  const identity = email || username || name;
  return identity ? { key: identity.toLowerCase(), label: name || email || username } : undefined;
}

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
  const cutoff = Date.now() - days * 86_400_000;
  return items.filter((item) => {
    const time = eventTime(item);
    return time !== undefined && time >= cutoff && time <= Date.now() + 300_000 && logicalEventKey(item);
  });
}

function eventDay(item: KnowledgeSourceItem): string {
  return new Date(item.occurredAt!).toISOString().slice(0, 10);
}

function signalConfidence(eventCount: number, activeDays: number): number {
  return Math.min(0.9, 0.55 + Math.min(eventCount, 8) * 0.03 + Math.min(activeDays, 5) * 0.04);
}

function relationshipCandidates(items: KnowledgeSourceItem[]): CandidateWithEvidence[] {
  const evidence = new Map<string, { label: string; events: Map<string, KnowledgeSourceItem> }>();
  for (const item of recent(items, 90)) {
    if (item.metadata.actorAttributed !== true) continue;
    const eventKey = logicalEventKey(item)!;
    const owners = new Set(Array.isArray(item.metadata.ownerIdentities)
      ? item.metadata.ownerIdentities.filter((value): value is string => typeof value === 'string')
      : []);
    const people = item.metadata.personEntities;
    if (!Array.isArray(people)) continue;
    for (const person of people) {
      const identity = identityForPerson(person);
      if (!identity || owners.has(identity.key)) continue;
      const entry = evidence.get(identity.key) ?? { label: identity.label, events: new Map<string, KnowledgeSourceItem>() };
      if (!entry.events.has(eventKey)) entry.events.set(eventKey, item);
      evidence.set(identity.key, entry);
    }
  }
  return [...evidence.values()]
    .filter(({ events }) => events.size >= 3 && new Set([...events.values()].map(eventDay)).size >= 2)
    .sort((left, right) => right.events.size - left.events.size)
    .slice(0, 4)
    .map(({ label, events }) => {
      const rows = [...events.values()];
      const activeDays = new Set(rows.map(eventDay)).size;
      return {
      candidate: {
        kind: 'relationship',
        content: `Frequently collaborates with ${label}.`,
        canonicalKey: key('relationship', label),
        confidence: signalConfidence(events.size, activeDays),
        importance: 0.65,
        explicitness: 'inferred',
        durability: 'recurring',
        sensitivity: 'personal',
        disclosurePolicy: 'ask_before_reference',
        tags: ['connected-source', 'relationship-signal'],
      },
      sourceItemIds: rows.map((item) => item.id).slice(0, 20),
      evidenceBasis: { eventCount: events.size, activeDays, windowDays: 90 },
    };
    });
}

function routineCandidates(items: KnowledgeSourceItem[]): CandidateWithEvidence[] {
  const calendar = recent(items, 120).filter((item) => item.itemType === 'calendar_event');
  const slots = new Map<string, KnowledgeSourceItem[]>();
  const seen = new Set<string>();
  for (const item of calendar) {
    const eventKey = logicalEventKey(item)!;
    if (seen.has(eventKey)) continue;
    seen.add(eventKey);
    const date = new Date(item.occurredAt!);
    const slot = `${date.getUTCDay()}:${date.getUTCHours()}`;
    const rows = slots.get(slot) ?? [];
    rows.push(item);
    slots.set(slot, rows);
  }
  const best = [...slots.entries()].sort((left, right) => right[1].length - left[1].length)[0];
  if (!best || best[1].length < 3 || new Set(best[1].map(eventDay)).size < 3) return [];
  const [weekday, hour] = best[0].split(':').map(Number);
  const weekdayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][weekday!];
  return [{
    candidate: {
      kind: 'routine',
      content: `Often has calendar activity on ${weekdayName} around ${String(hour).padStart(2, '0')}:00 UTC.`,
      canonicalKey: key('routine', best[0]),
      confidence: Math.min(0.86, 0.62 + best[1].length * 0.03),
      importance: 0.58,
      explicitness: 'inferred',
      durability: 'recurring',
      sensitivity: 'personal',
      disclosurePolicy: 'referenceable',
      tags: ['connected-source', 'calendar-pattern'],
    },
    sourceItemIds: best[1].map((item) => item.id).slice(0, 20),
    evidenceBasis: { eventCount: best[1].length, activeDays: new Set(best[1].map(eventDay)).size, windowDays: 120 },
  }];
}

function projectActivityCandidates(items: KnowledgeSourceItem[]): CandidateWithEvidence[] {
  const grouped = new Map<string, Map<string, KnowledgeSourceItem>>();
  for (const item of recent(items, 60)) {
    if (item.metadata.observationKind !== 'activity' || item.metadata.actorAttributed !== true) continue;
    const subject = typeof item.metadata.subjectKey === 'string' ? item.metadata.subjectKey.trim() : '';
    if (!subject) continue;
    const activities = grouped.get(subject) ?? new Map<string, KnowledgeSourceItem>();
    activities.set(logicalEventKey(item)!, item);
    grouped.set(subject, activities);
  }
  const candidates: CandidateWithEvidence[] = [];
  for (const [subject, activities] of grouped) {
    const rows = [...activities.values()];
    const activeDays = new Set(rows.map(eventDay)).size;
    if (rows.length < 3 || activeDays < 2) continue;
    candidates.push({
      candidate: {
        kind: 'project_context',
        content: `Recently contributed repeatedly to ${subject}.`,
        canonicalKey: key('project_context', subject),
        confidence: signalConfidence(rows.length, activeDays),
        importance: 0.72,
        explicitness: 'inferred',
        durability: 'recurring',
        sensitivity: 'personal',
        disclosurePolicy: 'referenceable',
        tags: ['connected-source', 'attributed-project-activity'],
      },
      sourceItemIds: rows.map((item) => item.id).slice(0, 20),
      evidenceBasis: { eventCount: rows.length, activeDays, windowDays: 60 },
    });
  }
  return candidates.slice(0, 4);
}

export function deriveConnectedUnderstandingCandidates(items: KnowledgeSourceItem[]): CandidateWithEvidence[] {
  const active = items.filter((item) => (
    !item.deletedAt
    && item.synthesisPipeline === 'connected_knowledge'
    && item.sensitivity !== 'secret'
    && item.sensitivity !== 'regulated'
  ));
  return [...relationshipCandidates(active), ...routineCandidates(active), ...projectActivityCandidates(active)].slice(0, 12);
}

export class ConnectedUnderstandingPipeline {
  constructor(private readonly memoryManager: MemoryManager) {}

  async process(sourceInstanceId: string, connectorId: string, agentId: string): Promise<UnderstandingReviewResult> {
    const items = listKnowledgeSourceItems({ sourceInstanceId, includeDeleted: false, limit: 500 });
    const groups = deriveConnectedUnderstandingCandidates(items);
    const totals: UnderstandingReviewResult = {
      proposed: 0,
      created: 0,
      deduplicated: 0,
      rejected: 0,
      createdRecords: [],
    };
    for (const group of groups) {
      const result = await this.memoryManager.applyUnderstandingCandidates([group.candidate], {
        agentId,
        sourceItemIds: group.sourceItemIds,
        sourceText: JSON.stringify(group.evidenceBasis),
        source: { provider: connectorId, sourceInstanceId },
        reviewSource: 'background',
      });
      totals.proposed += result.proposed;
      totals.created += result.created;
      totals.deduplicated += result.deduplicated;
      totals.rejected += result.rejected;
      totals.createdRecords.push(...result.createdRecords);
    }
    return totals;
  }
}
