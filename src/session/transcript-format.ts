/**
 * On-disk session transcript shape inspired by pi-mono coding-agent session files:
 * versioned document + stable id + optional compaction audit trail (vs only mutating messages).
 */

import { randomUUID } from 'node:crypto';

import type { AgentMessage } from '@mariozechner/pi-agent-core';

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
  messages: AgentMessage[];
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
  return {
    type: XOPC_SESSION_TRANSCRIPT_TYPE,
    version: o.version as number,
    id: o.id as string,
    createdAt,
    updatedAt,
    messages: o.messages as AgentMessage[],
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
 */
export function parseStoredTranscriptJson(raw: string): {
  messages: AgentMessage[];
  envelope: XopcSessionTranscriptV1 | null;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { messages: [], envelope: null };
  }

  if (Array.isArray(parsed)) {
    return { messages: parsed as AgentMessage[], envelope: null };
  }

  if (parsed && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>;
    const envelope = normalizeTranscriptEnvelope(o);
    if (envelope) {
      return { messages: envelope.messages, envelope };
    }
    if (Array.isArray(o.messages)) {
      return { messages: o.messages as AgentMessage[], envelope: null };
    }
  }

  return { messages: [], envelope: null };
}

export function buildTranscriptEnvelope(params: {
  messages: AgentMessage[];
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
    messages: params.messages,
  };
  if (compactions.length > 0) {
    doc.compactions = compactions;
  }
  return doc;
}
