import { createHash } from 'node:crypto';

import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type {
  CompactionAudit,
  CompactionHandover,
  CompactionHandoverItem,
  HandoverItemKind,
} from '../../session/compaction-types.js';
import type { TranscriptSourceEntry } from '../../storage/sqlite/transcript-repository.js';
import {
  getMemoryRecord,
  setMemoryRecordStatus,
  upsertMemoryRecord,
} from '../../storage/sqlite/memory-records-repository.js';
import type { MemoryKind, MemoryOriginClass } from './types.js';
import { resolveMemorySessionKind } from './turn-provenance.js';

const DURABLE_KINDS = new Set<HandoverItemKind>([
  'objective',
  'decision',
  'pending_user_ask',
  'todo',
  'constraint',
  'next_action',
]);
const RECALL_TOOL_RE = /^(?:memory_(?:search|get)|session_(?:search|recall))$/;

const MEMORY_KIND_BY_HANDOVER_KIND: Record<HandoverItemKind, MemoryKind> = {
  objective: 'long_term_goal',
  decision: 'derived_insight',
  pending_user_ask: 'open_question',
  todo: 'commitment',
  constraint: 'project_context',
  file_change: 'workspace_fact',
  tool_outcome: 'task_lesson',
  failure: 'task_lesson',
  current_state: 'current_state',
  next_action: 'commitment',
};

export interface PromoteCompactionLedgerInput {
  sessionKey: string;
  sessionId: string;
  sourceAgentId: string;
  workspaceId: string;
  projectId?: string;
  handover: CompactionHandover;
  audit: CompactionAudit;
  sourceEntries: readonly TranscriptSourceEntry[];
}

export interface PromoteCompactionLedgerResult {
  episodicRecordIds: string[];
  durableRecordIds: string[];
  rejectedRecordIds: string[];
}

function stableId(prefix: string, ...parts: string[]): string {
  const digest = createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 32);
  return `${prefix}:${digest}`;
}

function rowRole(entry: TranscriptSourceEntry): string | undefined {
  const row = entry.row as { role?: unknown };
  return typeof row.role === 'string' ? row.role : undefined;
}

function rowTurnId(entry: TranscriptSourceEntry | undefined): string | undefined {
  if (!entry) return undefined;
  const row = entry.row as { turnId?: unknown };
  return typeof row.turnId === 'string' && row.turnId.trim() ? row.turnId : undefined;
}

function toolNames(entry: TranscriptSourceEntry): string[] {
  const row = entry.row as { role?: unknown; toolName?: unknown; content?: unknown };
  const names: string[] = [];
  if (typeof row.toolName === 'string') names.push(row.toolName);
  if (row.role === 'assistant' && Array.isArray(row.content)) {
    for (const block of row.content) {
      if (!block || typeof block !== 'object') continue;
      const candidate = block as { type?: unknown; name?: unknown };
      if (candidate.type === 'toolCall' && typeof candidate.name === 'string') {
        names.push(candidate.name);
      }
    }
  }
  return names;
}

function hasAttachedSourceContext(entry: TranscriptSourceEntry): boolean {
  const row = entry.row as AgentMessage & { metadata?: unknown };
  if (!row.metadata || typeof row.metadata !== 'object' || Array.isArray(row.metadata)) return false;
  return Array.isArray((row.metadata as { sourceContexts?: unknown }).sourceContexts)
    && ((row.metadata as { sourceContexts: unknown[] }).sourceContexts.length > 0);
}

function classifyItemProvenance(
  item: CompactionHandoverItem,
  sourceById: ReadonlyMap<string, TranscriptSourceEntry>,
  entriesByTurn: ReadonlyMap<string, TranscriptSourceEntry[]>,
  entriesByRound: ReadonlyMap<string, TranscriptSourceEntry[]>,
): { originClass: MemoryOriginClass; derivedFromRecalledContext: boolean; observedAt: string } {
  const directSources = item.sources.flatMap((source) => {
    const entry = sourceById.get(source.entryId);
    return entry ? [entry] : [];
  });
  const expandedSources = new Map<string, TranscriptSourceEntry>();
  for (const entry of directSources) {
    expandedSources.set(entry.entryId, entry);
    const turnId = rowTurnId(entry);
    for (const peer of turnId ? entriesByTurn.get(turnId) ?? [] : []) {
      expandedSources.set(peer.entryId, peer);
    }
    for (const peer of entriesByRound.get(entry.entryId) ?? []) {
      expandedSources.set(peer.entryId, peer);
    }
  }
  const sources = [...expandedSources.values()];
  const names = sources.flatMap(toolNames);
  const tainted = directSources.length !== item.sources.length
    || sources.some((entry) => {
      const role = rowRole(entry);
      return role === 'tool' || role === 'toolResult' || role === 'system'
        || !role || hasAttachedSourceContext(entry);
    });
  const observedAtMs = Math.max(0, ...directSources.map((entry) => entry.createdAt));
  return {
    originClass: tainted ? 'untrusted' : 'agent',
    derivedFromRecalledContext: names.some((name) => RECALL_TOOL_RE.test(name)),
    observedAt: new Date(observedAtMs || Date.now()).toISOString(),
  };
}

function importanceFor(item: CompactionHandoverItem): number {
  if (item.kind === 'constraint' || item.kind === 'decision') return 0.82;
  if (item.kind === 'objective' || item.kind === 'pending_user_ask') return 0.75;
  if (item.kind === 'todo' || item.kind === 'next_action') return 0.68;
  return 0.5;
}

export function promoteCompactionLedger(
  input: PromoteCompactionLedgerInput,
): PromoteCompactionLedgerResult {
  const sourceById = new Map(input.sourceEntries.map((entry) => [entry.entryId, entry]));
  const entriesByTurn = new Map<string, TranscriptSourceEntry[]>();
  const entriesByRound = new Map<string, TranscriptSourceEntry[]>();
  let currentRound: TranscriptSourceEntry[] = [];
  const flushRound = () => {
    for (const entry of currentRound) entriesByRound.set(entry.entryId, currentRound);
  };
  for (const entry of input.sourceEntries) {
    const role = rowRole(entry);
    if (role === 'user') {
      flushRound();
      currentRound = [];
    }
    if (role === 'user' || role === 'assistant' || role === 'tool' || role === 'toolResult') {
      currentRound.push(entry);
    }
    const turnId = rowTurnId(entry);
    if (!turnId) continue;
    const entries = entriesByTurn.get(turnId) ?? [];
    entries.push(entry);
    entriesByTurn.set(turnId, entries);
  }
  flushRound();

  const result: PromoteCompactionLedgerResult = {
    episodicRecordIds: [],
    durableRecordIds: [],
    rejectedRecordIds: [],
  };
  const sessionKind = resolveMemorySessionKind(input.sessionKey);

  for (const item of input.handover.items) {
    const episodeId = stableId('compaction-episode', input.sessionId, item.id);
    const classified = classifyItemProvenance(item, sourceById, entriesByTurn, entriesByRound);
    const originClass: MemoryOriginClass = sessionKind === 'automation'
      || sessionKind === 'workflow'
      || sessionKind === 'background'
      ? 'system'
      : sessionKind === 'group'
        ? 'untrusted'
        : classified.originClass;
    const active = item.status === 'active';
    upsertMemoryRecord({
      id: episodeId,
      providerId: 'compaction-ledger',
      kind: MEMORY_KIND_BY_HANDOVER_KIND[item.kind],
      sourceAgentId: input.sourceAgentId,
      workspaceId: input.workspaceId,
      sessionKey: input.sessionKey,
      projectId: input.projectId,
      content: item.text,
      canonicalKey: `compaction:${input.sessionId}:${item.id}`,
      source: {
        provider: 'compaction-ledger',
        sessionEntryId: item.sources[0]?.entryId,
      },
      confidence: input.audit.status === 'passed' ? 0.82 : 0.65,
      tags: ['compaction', 'episodic', item.kind, item.status],
      status: active ? 'candidate' : 'archived',
      sensitivity: 'normal',
      explicitness: 'inferred',
      durability: 'ephemeral',
      importance: importanceFor(item),
      disclosurePolicy: 'referenceable',
      evidence: item.sources.map((source) => ({
        sessionKey: input.sessionKey,
        turnId: rowTurnId(sourceById.get(source.entryId)),
        relation: 'derived_from',
        sourceText: `[transcript:${source.seq}] ${item.text}`,
        observedAt: classified.observedAt,
      })),
      originClass,
      sessionKind,
      observedAt: classified.observedAt,
      sourceSessionId: input.sessionKey,
      supersedesKey: item.id,
      derivedFromRecalledContext: classified.derivedFromRecalledContext,
    });
    result.episodicRecordIds.push(episodeId);

    const durableId = stableId('compaction-durable', input.workspaceId, input.projectId ?? '', item.kind, item.text);
    const promotable = active
      && input.audit.status === 'passed'
      && sessionKind === 'interactive'
      && originClass === 'agent'
      && !classified.derivedFromRecalledContext
      && DURABLE_KINDS.has(item.kind);
    if (!promotable) {
      const existingDurable = !active ? getMemoryRecord(durableId) : null;
      if (existingDurable?.provenance.sourceSessionId === input.sessionKey) {
        setMemoryRecordStatus(durableId, 'archived');
      }
      result.rejectedRecordIds.push(episodeId);
      continue;
    }

    upsertMemoryRecord({
      id: durableId,
      providerId: 'compaction-ledger',
      kind: MEMORY_KIND_BY_HANDOVER_KIND[item.kind],
      sourceAgentId: input.sourceAgentId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      content: item.text,
      canonicalKey: `durable:${item.kind}:${stableId('fact', item.text)}`,
      source: { provider: 'compaction-ledger', sessionEntryId: item.sources[0]?.entryId },
      confidence: 0.82,
      tags: ['compaction', 'durable', item.kind],
      status: 'active',
      sensitivity: 'normal',
      explicitness: 'inferred',
      durability: 'durable',
      importance: importanceFor(item),
      disclosurePolicy: 'referenceable',
      evidence: [{
        sessionKey: input.sessionKey,
        turnId: item.sources[0]
          ? rowTurnId(sourceById.get(item.sources[0].entryId))
          : undefined,
        relation: 'derived_from',
        sourceText: item.text,
        observedAt: classified.observedAt,
      }],
      supersedesRecordId: episodeId,
      originClass: 'agent',
      sessionKind,
      observedAt: classified.observedAt,
      sourceSessionId: input.sessionKey,
      supersedesKey: item.id,
      derivedFromRecalledContext: false,
    });
    result.durableRecordIds.push(durableId);
  }

  return result;
}
