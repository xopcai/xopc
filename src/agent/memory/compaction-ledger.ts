import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  HANDOVER_ITEM_KINDS,
  type CompactionAudit,
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

const RawHandoverItemSchema = z.object({
  kind: z.enum(HANDOVER_ITEM_KINDS),
  text: z.string().min(1),
  status: z.enum(['active', 'completed', 'superseded']),
  sourceSeqs: z.array(z.number().int().positive()).min(1),
  identifiers: z.array(z.string()).default([]),
}).strict();

const RawHandoverSchema = z.object({
  items: z.array(RawHandoverItemSchema).max(120),
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

export function parseCompactionHandover(params: {
  text: string;
  sourceThroughSeq: number;
  previousBoundaryId?: string;
  allowedSources: readonly TranscriptSourceEntry[];
}): CompactionHandover {
  const parsed = RawHandoverSchema.parse(JSON.parse(extractJsonObject(params.text)));
  const sourceBySeq = new Map(params.allowedSources.map((source) => [source.seq, source]));
  const items = parsed.items.map((item): CompactionHandoverItem => {
    const seqs = [...new Set(item.sourceSeqs)].sort((a, b) => a - b);
    const sources = seqs.map((seq) => {
      const source = sourceBySeq.get(seq);
      if (!source || seq > params.sourceThroughSeq) {
        throw new Error(`Compaction handover references unavailable source seq ${seq}`);
      }
      return { entryId: source.entryId, seq };
    });
    const text = item.text.trim();
    return {
      id: itemId(item.kind, text, seqs),
      kind: item.kind,
      text,
      status: item.status,
      sources,
      identifiers: [...new Set(item.identifiers.map((value) => value.trim()).filter(Boolean))],
    };
  });

  return {
    version: 1,
    sourceThroughSeq: params.sourceThroughSeq,
    ...(params.previousBoundaryId ? { previousBoundaryId: params.previousBoundaryId } : {}),
    items: [...new Map(items.map((item) => [item.id, item])).values()],
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
  const active = handover.items.filter((item) => item.status === 'active');
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
      kind: item.kind,
      text: item.text,
      status: item.status,
      sourceSeqs: item.sources.map((source) => source.seq),
      identifiers: item.identifiers,
    })) ?? [],
  };
}
