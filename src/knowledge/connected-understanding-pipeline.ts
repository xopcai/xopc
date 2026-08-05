import { createHash } from 'node:crypto';

import type { UnderstandingCandidate, UnderstandingReviewResult } from '../agent/memory/understanding/types.js';
import type { MemoryManager } from '../agent/memory/manager.js';
import { listKnowledgeSourceItems } from '../storage/sqlite/index.js';
import type { KnowledgeSourceItem } from './types.js';

type CandidateWithEvidence = {
  candidate: UnderstandingCandidate;
  sourceItemIds: string[];
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

function relationshipCandidates(items: KnowledgeSourceItem[]): CandidateWithEvidence[] {
  const evidence = new Map<string, { label: string; ids: Set<string> }>();
  for (const item of items) {
    const people = item.metadata.personEntities;
    if (!Array.isArray(people)) continue;
    for (const person of people) {
      const identity = identityForPerson(person);
      if (!identity) continue;
      const entry = evidence.get(identity.key) ?? { label: identity.label, ids: new Set<string>() };
      entry.ids.add(item.id);
      evidence.set(identity.key, entry);
    }
  }
  return [...evidence.values()]
    .filter(({ ids }) => ids.size >= 2)
    .sort((left, right) => right.ids.size - left.ids.size)
    .slice(0, 4)
    .map(({ label, ids }) => ({
      candidate: {
        kind: 'relationship',
        content: `Frequently collaborates with ${label}.`,
        canonicalKey: key('relationship', label),
        confidence: Math.min(0.9, 0.62 + ids.size * 0.04),
        importance: 0.65,
        explicitness: 'inferred',
        durability: 'recurring',
        sensitivity: 'personal',
        disclosurePolicy: 'ask_before_reference',
        tags: ['connected-source', 'relationship-signal'],
      },
      sourceItemIds: [...ids].slice(0, 20),
    }));
}

const PROJECT_FIELDS = new Set(['project', 'project_name', 'repository', 'repo', 'full_name', 'workspace', 'team', 'channel']);

function projectSignals(value: unknown, depth = 0): string[] {
  if (depth > 4 || !value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((item) => projectSignals(item, depth + 1));
  const record = value as Record<string, unknown>;
  const signals: string[] = [];
  for (const [field, nested] of Object.entries(record)) {
    if (PROJECT_FIELDS.has(field.toLowerCase())) {
      if (typeof nested === 'string' && nested.trim()) signals.push(nested.trim().slice(0, 160));
      else if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        const row = nested as Record<string, unknown>;
        const label = [row.full_name, row.name, row.title, row.slug].find((item) => typeof item === 'string');
        if (typeof label === 'string' && label.trim()) signals.push(label.trim().slice(0, 160));
      }
    }
    signals.push(...projectSignals(nested, depth + 1));
  }
  return signals;
}

function projectCandidates(items: KnowledgeSourceItem[]): CandidateWithEvidence[] {
  const evidence = new Map<string, { label: string; ids: Set<string> }>();
  for (const item of items) {
    let parsed: unknown;
    try { parsed = item.normalizedText ? JSON.parse(item.normalizedText) : undefined; } catch { parsed = undefined; }
    for (const label of projectSignals(parsed)) {
      const normalized = label.toLowerCase();
      const entry = evidence.get(normalized) ?? { label, ids: new Set<string>() };
      entry.ids.add(item.id);
      evidence.set(normalized, entry);
    }
  }
  return [...evidence.values()]
    .filter(({ ids }) => ids.size >= 2)
    .sort((left, right) => right.ids.size - left.ids.size)
    .slice(0, 4)
    .map(({ label, ids }) => ({
      candidate: {
        kind: 'project_context',
        content: `Current connected work frequently involves ${label}.`,
        canonicalKey: key('project_context', label),
        confidence: Math.min(0.9, 0.64 + ids.size * 0.04),
        importance: 0.72,
        explicitness: 'inferred',
        durability: 'recurring',
        sensitivity: 'personal',
        disclosurePolicy: 'referenceable',
        tags: ['user-understanding', 'connected-source', 'project-signal'],
      },
      sourceItemIds: [...ids].slice(0, 20),
    }));
}

function routineCandidates(items: KnowledgeSourceItem[]): CandidateWithEvidence[] {
  const calendar = items.filter((item) => item.itemType === 'calendar_event' && item.occurredAt);
  const slots = new Map<string, KnowledgeSourceItem[]>();
  for (const item of calendar) {
    const date = new Date(item.occurredAt!);
    const slot = `${date.getUTCDay()}:${date.getUTCHours()}`;
    const rows = slots.get(slot) ?? [];
    rows.push(item);
    slots.set(slot, rows);
  }
  const best = [...slots.entries()].sort((left, right) => right[1].length - left[1].length)[0];
  if (!best || best[1].length < 3) return [];
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
  }];
}

export function deriveConnectedUnderstandingCandidates(items: KnowledgeSourceItem[]): CandidateWithEvidence[] {
  const active = items.filter((item) => (
    !item.deletedAt
    && item.synthesisPipeline === 'connected_knowledge'
    && item.sensitivity !== 'secret'
    && item.sensitivity !== 'regulated'
  ));
  return [...relationshipCandidates(active), ...routineCandidates(active), ...projectCandidates(active)].slice(0, 12);
}

export class ConnectedUnderstandingPipeline {
  constructor(private readonly memoryManager: MemoryManager) {}

  async process(sourceInstanceId: string, connectorId: string, agentId: string): Promise<UnderstandingReviewResult> {
    const items = listKnowledgeSourceItems({ includeDeleted: false, limit: 500 });
    const groups = deriveConnectedUnderstandingCandidates(items);
    const totals: UnderstandingReviewResult = {
      proposed: 0,
      created: 0,
      deduplicated: 0,
      rejected: 0,
      createdRecords: [],
    };
    for (const group of groups) {
      const evidenceSources = new Set(items
        .filter((item) => group.sourceItemIds.includes(item.id))
        .map((item) => item.sourceInstanceId));
      const result = await this.memoryManager.applyUnderstandingCandidates([group.candidate], {
        agentId,
        sourceItemIds: group.sourceItemIds,
        sourceText: `Derived from ${group.sourceItemIds.length} connected source items.`,
        source: evidenceSources.size > 1
          ? { provider: 'connected-sources' }
          : { provider: connectorId, sourceInstanceId },
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
