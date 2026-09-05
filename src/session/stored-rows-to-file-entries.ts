import { randomUUID } from 'node:crypto';

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import {
  CURRENT_SESSION_VERSION,
  type CompactionEntry,
  type CustomEntry,
  type CustomMessageEntry,
  type FileEntry,
  type SessionMessageEntry,
} from '@earendil-works/pi-coding-agent';

import type { TranscriptCompactionRecord } from './transcript-format.js';
import { VOICE_CALL_TYPE, VOICE_TRANSCRIPT_TYPE, voiceTranscriptMessage } from './voice-transcript.js';
import {
  isTranscriptContextEntry,
  isTranscriptCustomMessageEntry,
  isTranscriptCustomStateEntry,
  type TranscriptStoredRow,
  type XopcTranscriptContextEntry,
  type XopcTranscriptCustomMessageEntry,
  type XopcTranscriptCustomMessageFileEntry,
  type XopcTranscriptCustomStateEntry,
} from './session-context-for-llm.js';

export const XOPC_CONTEXT_CUSTOM_TYPE = 'xopc:transcript-row';

function generateShortId(byId: Set<string>): string {
  for (let i = 0; i < 100; i++) {
    const id = randomUUID().slice(0, 8);
    if (!byId.has(id)) {
      return id;
    }
  }
  return randomUUID();
}

function contextRowToCustomEntry(
  row: XopcTranscriptContextEntry,
  parentId: string | null,
  byId: Set<string>,
): CustomEntry {
  return {
    type: 'custom',
    customType: XOPC_CONTEXT_CUSTOM_TYPE,
    id: generateShortId(byId),
    parentId,
    timestamp: row.createdAt ?? new Date().toISOString(),
    data: {
      kind: 'context',
      id: row.id,
      text: row.text,
      data: row.data,
      createdAt: row.createdAt,
    },
  };
}

function customStateRowToCustomEntry(
  row: XopcTranscriptCustomStateEntry,
  parentId: string | null,
  byId: Set<string>,
): CustomEntry {
  return {
    type: 'custom',
    customType: row.customType?.trim() || 'xopc:custom',
    id: generateShortId(byId),
    parentId,
    timestamp: typeof row.timestamp === 'string' ? row.timestamp : new Date().toISOString(),
    data: row.data,
  };
}

function customMessageRowToEntry(
  row: XopcTranscriptCustomMessageEntry | XopcTranscriptCustomMessageFileEntry,
  parentId: string | null,
  byId: Set<string>,
): CustomMessageEntry {
  return {
    type: 'custom_message',
    customType: row.customType?.trim() || 'xopc:custom-message',
    id: generateShortId(byId),
    parentId,
    timestamp: typeof row.timestamp === 'string'
      ? row.timestamp
      : typeof row.timestamp === 'number'
        ? new Date(row.timestamp).toISOString()
        : new Date().toISOString(),
    content: typeof row.content === 'string' || Array.isArray(row.content)
      ? row.content as CustomMessageEntry['content']
      : '',
    display: row.display ?? true,
    details: row.details,
  };
}

function compactionRecordToEntry(
  rec: TranscriptCompactionRecord,
  parentId: string | null,
  byId: Set<string>,
): CompactionEntry {
  return {
    type: 'compaction',
    id: generateShortId(byId),
    parentId,
    timestamp: rec.at,
    summary: rec.summary,
    firstKeptEntryId: String(rec.firstKeptIndex),
    tokensBefore: rec.tokensBefore,
    details: { tokensAfter: rec.tokensAfter, xopc: true },
    fromHook: true,
  };
}

function agentMessageToEntry(
  msg: AgentMessage,
  parentId: string | null,
  byId: Set<string>,
): SessionMessageEntry {
  return {
    type: 'message',
    id: generateShortId(byId),
    parentId,
    timestamp: new Date().toISOString(),
    message: msg,
  };
}

/** Convert SQLite transcript rows into pi-coding-agent JSONL file entries (header + tree). */
export function storedRowsToFileEntries(params: {
  sessionId: string;
  cwd: string;
  rows: TranscriptStoredRow[];
  appendCompaction?: TranscriptCompactionRecord;
}): FileEntry[] {
  const byId = new Set<string>();
  const entries: FileEntry[] = [
    {
      type: 'session',
      version: CURRENT_SESSION_VERSION,
      id: params.sessionId,
      timestamp: new Date().toISOString(),
      cwd: params.cwd,
    },
  ];

  let parentId: string | null = null;
  for (const row of params.rows) {
    if (isTranscriptContextEntry(row)) {
      const entry = contextRowToCustomEntry(row, parentId, byId);
      byId.add(entry.id);
      entries.push(entry);
      parentId = entry.id;
      continue;
    }
    if (isTranscriptCustomStateEntry(row)) {
      const entry = customStateRowToCustomEntry(row, parentId, byId);
      byId.add(entry.id);
      entries.push(entry);
      parentId = entry.id;
      continue;
    }
    if (isTranscriptCustomMessageEntry(row)) {
      if (row.customType === VOICE_CALL_TYPE) continue;
      const voiceMessage = row.customType === VOICE_TRANSCRIPT_TYPE ? voiceTranscriptMessage(row) : null;
      if (row.customType === VOICE_TRANSCRIPT_TYPE && !voiceMessage) continue;
      const entry = voiceMessage ? agentMessageToEntry(voiceMessage, parentId, byId) : customMessageRowToEntry(row, parentId, byId);
      byId.add(entry.id);
      entries.push(entry);
      parentId = entry.id;
      continue;
    }
    if ((row as { type?: string }).type === 'compaction') {
      const entry = compactionRecordToEntry(row as unknown as TranscriptCompactionRecord, parentId, byId);
      byId.add(entry.id);
      entries.push(entry);
      parentId = entry.id;
      continue;
    }
    const entry = agentMessageToEntry(row as AgentMessage, parentId, byId);
    byId.add(entry.id);
    entries.push(entry);
    parentId = entry.id;
  }

  if (params.appendCompaction) {
    const entry = compactionRecordToEntry(params.appendCompaction, parentId, byId);
    byId.add(entry.id);
    entries.push(entry);
  }

  return entries;
}
