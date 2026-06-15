/**
 * Transcript rows persisted on disk may include non-LLM entries (e.g. `kind: 'context'`).
 * {@link buildSessionContextForLlm} is the single choke point for provider-facing history.
 *
 * Do not pass raw on-disk JSONL rows into pi-agent / providers — always run
 * {@link buildSessionContextForLlm} first (or use {@link SessionStore.loadMessages}, which already does).
 */

import type { AgentMessage } from '@earendil-works/pi-agent-core';

/** Persisted-only row: never sent to the model as a chat message. */
export interface XopcTranscriptContextEntry {
  kind: 'context';
  id?: string;
  /** Short human-readable line for UIs / logs. */
  text?: string;
  /** Structured payload (tool summaries, delivery metadata, etc.). */
  data?: Record<string, unknown>;
  createdAt?: string;
}

export type TranscriptStoredRow = AgentMessage | XopcTranscriptContextEntry;

export function isTranscriptContextEntry(x: unknown): x is XopcTranscriptContextEntry {
  if (!x || typeof x !== 'object') return false;
  return (x as Record<string, unknown>).kind === 'context';
}

const LLM_ROLES = new Set(['user', 'assistant', 'system', 'tool', 'toolResult']);

function isLikelyAgentMessage(x: unknown): x is AgentMessage {
  if (!x || typeof x !== 'object') return false;
  const role = (x as Record<string, unknown>).role;
  return typeof role === 'string' && LLM_ROLES.has(role);
}

/**
 * Normalize a JSON array from on-disk transcript into stored rows (drops unrecognized objects).
 */
export function transcriptRowsFromJsonArray(arr: unknown[]): TranscriptStoredRow[] {
  const out: TranscriptStoredRow[] = [];
  for (const x of arr) {
    if (isTranscriptContextEntry(x)) {
      out.push(x);
      continue;
    }
    if (isLikelyAgentMessage(x)) {
      out.push(x);
    }
  }
  return out;
}

/** Messages only — what providers and pi-agent should see. */
export function buildSessionContextForLlm(rows: TranscriptStoredRow[]): AgentMessage[] {
  const out: AgentMessage[] = [];
  for (const r of rows) {
    if (isTranscriptContextEntry(r)) {
      continue;
    }
    if ((r as { type?: string }).type === 'compaction') {
      continue;
    }
    if (isLikelyAgentMessage(r)) {
      out.push(r);
    }
  }
  return out;
}

/**
 * When persisting LLM messages, keep prior `kind: 'context'` rows in their relative positions:
 * each non-context slot in the previous file is replaced by the next incoming LLM message;
 * trailing new LLM rows are appended. Extra old LLM rows are dropped if the new list is shorter.
 */
export function mergeLlmMessagesPreservingContextRows(
  prevRows: TranscriptStoredRow[],
  llmMessages: AgentMessage[],
): TranscriptStoredRow[] {
  let i = 0;
  const out: TranscriptStoredRow[] = [];
  for (const r of prevRows) {
    if (isTranscriptContextEntry(r)) {
      out.push(r);
    } else {
      if (i < llmMessages.length) {
        out.push(llmMessages[i]);
        i += 1;
      }
    }
  }
  while (i < llmMessages.length) {
    out.push(llmMessages[i]);
    i += 1;
  }
  return out;
}
