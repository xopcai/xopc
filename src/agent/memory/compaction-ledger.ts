import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  HANDOVER_ITEM_KINDS,
  type CompactionHandover,
  type CompactionHandoverItem,
  type HandoverItemKind,
} from '../../session/compaction-types.js';
import type { TranscriptSourceEntry } from '../../storage/sqlite/transcript-repository.js';

export type {
  CompactionAudit,
  CompactionHandover,
  CompactionHandoverItem,
  HandoverItemKind,
} from '../../session/compaction-types.js';

export const MAX_HANDOVER_ITEMS = 120;
const MAX_HANDOVER_DELTA_ITEMS = 480;
const MAX_SOURCE_REFS_PER_ITEM = 12;

const COMPLETED_KIND_BUDGET: Record<HandoverItemKind, number> = {
  objective: 4,
  decision: 24,
  pending_user_ask: 2,
  todo: 4,
  constraint: 4,
  file_change: 28,
  tool_outcome: 24,
  failure: 8,
  current_state: 12,
  next_action: 4,
};

const ACTIVE_KIND_PRIORITY: Record<HandoverItemKind, number> = {
  pending_user_ask: 10,
  objective: 9,
  constraint: 8,
  decision: 7,
  failure: 6,
  todo: 5,
  next_action: 4,
  current_state: 3,
  file_change: 2,
  tool_outcome: 1,
};

const RawHandoverUpsertSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  kind: z.enum(HANDOVER_ITEM_KINDS),
  text: z.string().trim().min(1).max(2_000),
  status: z.enum(['active', 'completed', 'superseded']),
  sourceSeqs: z.array(z.number().int().positive()).min(1),
  identifiers: z.array(z.string().max(256)).max(20).default([]),
}).strict();

const RawHandoverDeltaSchema = z.object({
  // The model may overproduce. Accept a bounded superset and deterministically
  // consolidate it below instead of turning a recoverable response into a
  // failed compaction.
  upserts: z.array(RawHandoverUpsertSchema).max(MAX_HANDOVER_DELTA_ITEMS),
}).strict();

function extractJsonObject(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) return fenced;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Compaction model did not return a JSON object');
  return text.slice(start, end + 1);
}

function normalizeSemanticText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?。！？]+$/u, '');
}

function normalizeIdentifiers(identifiers: readonly string[]): string[] {
  return [...new Set(identifiers
    .map((value) => value.normalize('NFKC').trim())
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function semanticKey(item: Pick<CompactionHandoverItem, 'kind' | 'text' | 'identifiers'>): string {
  return `${item.kind}\0${normalizeSemanticText(item.text)}\0${normalizeIdentifiers(item.identifiers).join('\0')}`;
}

function itemId(kind: HandoverItemKind, text: string, identifiers: readonly string[]): string {
  return createHash('sha256')
    .update(`${kind}\0${normalizeSemanticText(text)}\0${normalizeIdentifiers(identifiers).join('\0')}`)
    .digest('hex')
    .slice(0, 20);
}

function newestSourceSeq(item: CompactionHandoverItem): number {
  return item.sources.reduce((latest, source) => Math.max(latest, source.seq), 0);
}

function mergeSources(
  previous: readonly CompactionHandoverItem['sources'][number][],
  incoming: readonly CompactionHandoverItem['sources'][number][],
): CompactionHandoverItem['sources'] {
  const bySeq = new Map(previous.map((source) => [source.seq, source]));
  for (const source of incoming) bySeq.set(source.seq, source);
  const sorted = [...bySeq.values()].sort((left, right) => left.seq - right.seq);
  if (sorted.length <= MAX_SOURCE_REFS_PER_ITEM) return sorted;
  return [sorted[0]!, ...sorted.slice(-(MAX_SOURCE_REFS_PER_ITEM - 1))];
}

function mergeSemanticDuplicate(
  previous: CompactionHandoverItem,
  incoming: CompactionHandoverItem,
): CompactionHandoverItem {
  const incomingIsNewer = newestSourceSeq(incoming) >= newestSourceSeq(previous);
  const latest = incomingIsNewer ? incoming : previous;
  return {
    ...latest,
    // Keep the first durable id so future model updates remain valid even when
    // this merges a legacy source-sequence-based id with the stable id format.
    id: previous.id,
    sources: mergeSources(previous.sources, incoming.sources),
    identifiers: normalizeIdentifiers([...previous.identifiers, ...incoming.identifiers]).slice(0, 20),
  };
}

function compareRetentionPriority(left: CompactionHandoverItem, right: CompactionHandoverItem): number {
  const status = Number(right.status === 'active') - Number(left.status === 'active');
  if (status !== 0) return status;
  const kind = ACTIVE_KIND_PRIORITY[right.kind] - ACTIVE_KIND_PRIORITY[left.kind];
  if (kind !== 0) return kind;
  const recency = newestSourceSeq(right) - newestSourceSeq(left);
  if (recency !== 0) return recency;
  return left.id.localeCompare(right.id);
}

function consolidateItems(items: readonly CompactionHandoverItem[]): CompactionHandoverItem[] {
  const bySemanticKey = new Map<string, CompactionHandoverItem>();
  const keyOrder: string[] = [];
  for (const item of items) {
    if (item.status === 'superseded') continue;
    const key = semanticKey(item);
    const existing = bySemanticKey.get(key);
    if (existing) {
      bySemanticKey.set(key, mergeSemanticDuplicate(existing, item));
    } else {
      keyOrder.push(key);
      bySemanticKey.set(key, {
        ...item,
        sources: mergeSources([], item.sources),
        identifiers: normalizeIdentifiers(item.identifiers).slice(0, 20),
      });
    }
  }

  const deduplicated = keyOrder.map((key) => bySemanticKey.get(key)!);
  const completedByKind = new Map<HandoverItemKind, CompactionHandoverItem[]>();
  for (const item of deduplicated) {
    if (item.status !== 'completed') continue;
    const group = completedByKind.get(item.kind) ?? [];
    group.push(item);
    completedByKind.set(item.kind, group);
  }
  const allowedCompleted = new Set<string>();
  for (const [kind, group] of completedByKind) {
    group.sort((left, right) => newestSourceSeq(right) - newestSourceSeq(left) || left.id.localeCompare(right.id));
    for (const item of group.slice(0, COMPLETED_KIND_BUDGET[kind])) allowedCompleted.add(item.id);
  }

  const perKindBounded = deduplicated.filter((item) =>
    item.status === 'active' || allowedCompleted.has(item.id));
  if (perKindBounded.length <= MAX_HANDOVER_ITEMS) return perKindBounded;

  const retainedIds = new Set(
    [...perKindBounded]
      .sort(compareRetentionPriority)
      .slice(0, MAX_HANDOVER_ITEMS)
      .map((item) => item.id),
  );
  return perKindBounded.filter((item) => retainedIds.has(item.id));
}

/** Normalize legacy or model-produced ledgers into the bounded durable form. */
export function consolidateCompactionHandover(handover: CompactionHandover): CompactionHandover {
  return { ...handover, items: consolidateItems(handover.items) };
}

/** Apply a bounded model-produced delta to the trusted local handover. */
export function applyCompactionHandoverDelta(params: {
  text: string;
  sourceThroughSeq: number;
  previousBoundaryId?: string;
  allowedSources: readonly TranscriptSourceEntry[];
  current?: CompactionHandover;
}): CompactionHandover {
  const parsed = RawHandoverDeltaSchema.parse(JSON.parse(extractJsonObject(params.text)));
  const sourceBySeq = new Map<number, { entryId: string; seq: number }>(
    params.allowedSources.map((source) => [source.seq, { entryId: source.entryId, seq: source.seq }]),
  );
  for (const item of params.current?.items ?? []) {
    for (const source of item.sources) sourceBySeq.set(source.seq, source);
  }
  const items = new Map((params.current?.items ?? []).map((item) => [item.id, item]));
  for (const item of parsed.upserts) {
    const seqs = [...new Set(item.sourceSeqs)].sort((a, b) => a - b);
    const sources = seqs.map((seq) => {
      const source = sourceBySeq.get(seq);
      if (!source || seq > params.sourceThroughSeq) {
        throw new Error(`Compaction handover references unavailable source seq ${seq}`);
      }
      return source;
    });
    const text = item.text.trim();
    const identifiers = normalizeIdentifiers(item.identifiers);
    const id = item.id ?? itemId(item.kind, text, identifiers);
    if (item.id && !items.has(item.id)) {
      throw new Error(`Compaction handover updates unknown item ${item.id}`);
    }
    const previousItem = items.get(id);
    items.set(id, {
      id,
      kind: item.kind,
      text,
      status: item.status,
      sources: mergeSources(previousItem?.sources ?? [], sources),
      identifiers: normalizeIdentifiers([
        ...(previousItem?.identifiers ?? []),
        ...identifiers,
      ]).slice(0, 20),
    });
  }

  return consolidateCompactionHandover({
    version: 1,
    sourceThroughSeq: params.sourceThroughSeq,
    ...(params.previousBoundaryId ? { previousBoundaryId: params.previousBoundaryId } : {}),
    items: [...items.values()],
  });
}

const SUMMARY_GROUPS: Array<{ heading: string; kinds: HandoverItemKind[] }> = [
  { heading: 'Decisions', kinds: ['objective', 'decision'] },
  { heading: 'Pending user asks', kinds: ['pending_user_ask'] },
  { heading: 'Open TODOs', kinds: ['todo', 'next_action'] },
  { heading: 'Constraints and rules', kinds: ['constraint'] },
  { heading: 'Tool operations and results', kinds: ['file_change', 'tool_outcome', 'failure'] },
  { heading: 'Recent state', kinds: ['current_state'] },
];

export function renderCompactionHandover(handover: CompactionHandover): string {
  const completedFacts = new Set<HandoverItemKind>(['file_change', 'tool_outcome', 'current_state', 'decision']);
  const active = handover.items.filter((item) => item.status === 'active'
    || (item.status === 'completed' && completedFacts.has(item.kind)));
  const sections = SUMMARY_GROUPS.map(({ heading, kinds }) => {
    const items = active.filter((item) => kinds.includes(item.kind));
    return `## ${heading}\n${items.length > 0 ? items.map((item) => `- ${item.text}`).join('\n') : 'None'}`;
  });
  const identifiers = [...new Set(active.flatMap((item) => item.identifiers))];
  sections.splice(
    4,
    0,
    `## Exact identifiers\n${identifiers.length > 0 ? identifiers.map((value) => `- \`${value}\``).join('\n') : 'None'}`,
  );
  return sections.join('\n\n');
}

export function handoverForPrompt(handover: CompactionHandover | undefined): object {
  const bounded = handover ? consolidateCompactionHandover(handover) : undefined;
  return {
    maxItems: MAX_HANDOVER_ITEMS,
    items: bounded?.items.map((item) => ({
      id: item.id,
      kind: item.kind,
      text: item.text,
      status: item.status,
      sourceSeqs: item.sources.map((source) => source.seq),
      identifiers: item.identifiers,
    })) ?? [],
  };
}
