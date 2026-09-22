import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  HANDOVER_ITEM_KINDS,
  type CompactionHandover,
  type HandoverItemKind,
} from '../../session/compaction-types.js';
import type { TranscriptSourceEntry } from '../../storage/sqlite/transcript-repository.js';

export type {
  CompactionAudit,
  CompactionHandover,
  CompactionHandoverItem,
  HandoverItemKind,
} from '../../session/compaction-types.js';

const MAX_HANDOVER_ITEMS = 120;

const RawHandoverUpsertSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  kind: z.enum(HANDOVER_ITEM_KINDS),
  text: z.string().trim().min(1).max(2_000),
  status: z.enum(['active', 'completed', 'superseded']),
  sourceSeqs: z.array(z.number().int().positive()).min(1),
  identifiers: z.array(z.string().max(256)).max(20).default([]),
}).strict();

const RawHandoverDeltaSchema = z.object({
  upserts: z.array(RawHandoverUpsertSchema).max(MAX_HANDOVER_ITEMS),
}).strict();

function extractJsonObject(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) return fenced;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Compaction model did not return a JSON object');
  return text.slice(start, end + 1);
}

function itemId(kind: HandoverItemKind, text: string, seqs: readonly number[]): string {
  return createHash('sha256')
    .update(`${kind}\0${text.trim()}\0${[...seqs].sort((a, b) => a - b).join(',')}`)
    .digest('hex')
    .slice(0, 20);
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
  const seenIds = new Set<string>();
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
    const id = item.id ?? itemId(item.kind, text, seqs);
    if (item.id && !items.has(item.id)) {
      throw new Error(`Compaction handover updates unknown item ${item.id}`);
    }
    if (seenIds.has(id)) throw new Error(`Compaction handover repeats item ${id}`);
    seenIds.add(id);
    items.set(id, {
      id,
      kind: item.kind,
      text,
      status: item.status,
      sources,
      identifiers: [...new Set(item.identifiers.map((value) => value.trim()).filter(Boolean))],
    });
  }

  const retained = [...items.values()].filter((item) => item.status !== 'superseded');
  if (retained.length > MAX_HANDOVER_ITEMS) {
    throw new Error(`Compaction handover exceeds ${MAX_HANDOVER_ITEMS} durable items`);
  }

  return {
    version: 1,
    sourceThroughSeq: params.sourceThroughSeq,
    ...(params.previousBoundaryId ? { previousBoundaryId: params.previousBoundaryId } : {}),
    items: retained,
  };
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
  return {
    items: handover?.items.map((item) => ({
      id: item.id,
      kind: item.kind,
      text: item.text,
      status: item.status,
      sourceSeqs: item.sources.map((source) => source.seq),
      identifiers: item.identifiers,
    })) ?? [],
  };
}
