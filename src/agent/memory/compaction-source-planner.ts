import type { AgentMessage } from '@earendil-works/pi-agent-core';

import {
  buildSessionContextForLlm,
  isRuntimeOnlyTranscriptMessage,
  isTranscriptCompactionEntry,
  isTranscriptContextEntry,
  isTranscriptCustomMessageEntry,
  isTranscriptCustomStateEntry,
  isTranscriptLabelEntry,
  isTranscriptMetadataEntry,
  isTranscriptSummaryMessageEntry,
} from '../../session/session-context-for-llm.js';
import type { TranscriptSourceEntry } from '../../storage/sqlite/transcript-repository.js';
import { estimateMessagesTokens, estimateTextTokens } from './context-budget.js';

export interface CompactionSourcePlan {
  sourceEntries: TranscriptSourceEntry[];
  keptEntries: TranscriptSourceEntry[];
  keptMessages: AgentMessage[];
  allMessages: AgentMessage[];
  sourceThroughSeq: number;
}

function isModelSource(entry: TranscriptSourceEntry): boolean {
  const row = entry.row;
  return !isTranscriptCompactionEntry(row)
    && !isTranscriptContextEntry(row)
    && !isTranscriptCustomStateEntry(row)
    && !isTranscriptSummaryMessageEntry(row)
    && !isTranscriptLabelEntry(row)
    && !isTranscriptMetadataEntry(row)
    && !isRuntimeOnlyTranscriptMessage(row);
}

function isTurnStart(entry: TranscriptSourceEntry): boolean {
  const row = entry.row as { role?: unknown };
  return row.role === 'user' || isTranscriptCustomMessageEntry(entry.row);
}

function estimateEntryTokens(entry: TranscriptSourceEntry): number {
  try {
    return estimateTextTokens(JSON.stringify(entry.row)) + 12;
  } catch {
    return 12;
  }
}

function findNthTurnFromEnd(entries: readonly TranscriptSourceEntry[], count: number): number {
  let found = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (!isTurnStart(entries[index]!)) continue;
    found += 1;
    if (found === count) return index;
  }
  return 0;
}

function findTurnAtOrBefore(entries: readonly TranscriptSourceEntry[], start: number): number {
  for (let index = Math.min(start, entries.length - 1); index >= 0; index -= 1) {
    if (isTurnStart(entries[index]!)) return index;
  }
  return 0;
}

function findRecentTokenBoundary(entries: readonly TranscriptSourceEntry[], keepRecentTokens: number): number {
  let tokens = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    tokens += estimateEntryTokens(entries[index]!);
    if (tokens >= keepRecentTokens) return findTurnAtOrBefore(entries, index);
  }
  return 0;
}

export function planCompactionSource(params: {
  entries: readonly TranscriptSourceEntry[];
  minMessagesBeforeCompact: number;
  recentTurnsPreserve: number;
  keepRecentTokens: number;
  force: boolean;
}): CompactionSourcePlan | null {
  const rawEntries = params.entries.filter(isModelSource);
  const allMessages = buildSessionContextForLlm(rawEntries.map((entry) => entry.row));
  if ((!params.force && allMessages.length < params.minMessagesBeforeCompact)
    || (params.force && allMessages.length < 2)) {
    return null;
  }

  const turnBoundary = findNthTurnFromEnd(rawEntries, params.recentTurnsPreserve);
  const tokenBoundary = findRecentTokenBoundary(rawEntries, params.keepRecentTokens);
  let splitAt = Math.min(turnBoundary, tokenBoundary);
  if (splitAt <= 0 && params.force) splitAt = findNthTurnFromEnd(rawEntries, 1);
  if (splitAt <= 0) return null;

  const sourceEntries = rawEntries.slice(0, splitAt);
  const keptEntries = rawEntries.slice(splitAt);
  const keptMessages = buildSessionContextForLlm(keptEntries.map((entry) => entry.row));
  if (sourceEntries.length === 0 || keptMessages.length === 0) return null;
  return {
    sourceEntries,
    keptEntries,
    keptMessages,
    allMessages,
    sourceThroughSeq: sourceEntries.at(-1)!.seq,
  };
}

export function estimateCompactionSourceTokens(plan: CompactionSourcePlan): {
  before: number;
  kept: number;
} {
  return {
    before: estimateMessagesTokens(plan.allMessages),
    kept: estimateMessagesTokens(plan.keptMessages),
  };
}
