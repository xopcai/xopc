/**
 * On-disk session transcript shape inspired by pi-mono coding-agent session files:
 * versioned document + stable id + optional compaction audit trail (vs only mutating messages).
 */

import { randomUUID } from 'node:crypto';

import type { AgentMessage } from '@mariozechner/pi-agent-core';

import {
  buildSessionContextForLlm,
  transcriptRowsFromJsonArray,
  type TranscriptStoredRow,
} from './session-context-for-llm.js';

export const XOPC_SESSION_TRANSCRIPT_TYPE = 'xopc_session_transcript' as const;

/** Bump when the envelope schema changes (load path must tolerate older versions). */
export const CURRENT_SESSION_TRANSCRIPT_VERSION = 1;

/** Record appended when context compaction runs (pi `CompactionEntry`-style audit). */
export interface TranscriptCompactionRecord {
  at: string;
  summary: string;
  firstKeptIndex: number;
  tokensBefore: number;
  tokensAfter: number;
}

export interface XopcSessionTranscriptV1 {
  type: typeof XOPC_SESSION_TRANSCRIPT_TYPE;
  version: number;
  /** Stable id for this transcript file (survives rewrites; like pi session header id). */
  id: string;
  createdAt: string;
  updatedAt: string;
  /**
   * Transcript rows: normal {@link AgentMessage} plus optional `kind: 'context'` entries
   * (see {@link buildSessionContextForLlm}).
   */
  messages: TranscriptStoredRow[];
  compactions?: TranscriptCompactionRecord[];
}

function normalizeTranscriptEnvelope(o: Record<string, unknown>): XopcSessionTranscriptV1 | null {
  if (
    o.type !== XOPC_SESSION_TRANSCRIPT_TYPE ||
    typeof o.version !== 'number' ||
    typeof o.id !== 'string' ||
    typeof o.updatedAt !== 'string' ||
    !Array.isArray(o.messages)
  ) {
    return null;
  }
  const updatedAt = o.updatedAt as string;
  const createdAt = typeof o.createdAt === 'string' ? o.createdAt : updatedAt;
  const rawCompactions = Array.isArray(o.compactions) ? o.compactions : [];
  const compactions = rawCompactions.filter(isCompactionRecord);
  const rows = transcriptRowsFromJsonArray(o.messages as unknown[]);
  return {
    type: XOPC_SESSION_TRANSCRIPT_TYPE,
    version: o.version as number,
    id: o.id as string,
    createdAt,
    updatedAt,
    messages: rows,
    ...(compactions.length > 0 ? { compactions } : {}),
  };
}

function isCompactionRecord(x: unknown): x is TranscriptCompactionRecord {
  if (!x || typeof x !== 'object') return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.at === 'string' &&
    typeof r.summary === 'string' &&
    typeof r.firstKeptIndex === 'number' &&
    typeof r.tokensBefore === 'number' &&
    typeof r.tokensAfter === 'number'
  );
}

/**
 * Parse stored transcript JSON: legacy bare `AgentMessage[]` or wrapped {@link XopcSessionTranscriptV1}.
 * `messages` is {@link buildSessionContextForLlm} of `rows` (LLM-only) for backward-compatible call sites.
 */
export function parseStoredTranscriptJson(raw: string): {
  rows: TranscriptStoredRow[];
  messages: AgentMessage[];
  envelope: XopcSessionTranscriptV1 | null;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { rows: [], messages: [], envelope: null };
  }

  if (Array.isArray(parsed)) {
    const rows = transcriptRowsFromJsonArray(parsed);
    const messages = buildSessionContextForLlm(rows);
    return { rows, messages, envelope: null };
  }

  if (parsed && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>;
    const envelope = normalizeTranscriptEnvelope(o);
    if (envelope) {
      const messages = buildSessionContextForLlm(envelope.messages);
      return { rows: envelope.messages, messages, envelope };
    }
    if (Array.isArray(o.messages)) {
      const rows = transcriptRowsFromJsonArray(o.messages as unknown[]);
      const messages = buildSessionContextForLlm(rows);
      return { rows, messages, envelope: null };
    }
  }

  return { rows: [], messages: [], envelope: null };
}

export function buildTranscriptEnvelope(params: {
  /** Full on-disk rows (LLM messages + optional `kind: 'context'`). */
  storedRows: TranscriptStoredRow[];
  previous: XopcSessionTranscriptV1 | null;
  appendCompaction?: TranscriptCompactionRecord;
}): XopcSessionTranscriptV1 {
  const now = new Date().toISOString();
  const id = params.previous?.id ?? randomUUID();
  const createdAt = params.previous?.createdAt ?? now;
  const compactions = [...(params.previous?.compactions ?? [])];
  if (params.appendCompaction) {
    compactions.push(params.appendCompaction);
  }

  const doc: XopcSessionTranscriptV1 = {
    type: XOPC_SESSION_TRANSCRIPT_TYPE,
    version: CURRENT_SESSION_TRANSCRIPT_VERSION,
    id,
    createdAt,
    updatedAt: now,
    messages: params.storedRows,
  };
  if (compactions.length > 0) {
    doc.compactions = compactions;
  }
  return doc;
}
