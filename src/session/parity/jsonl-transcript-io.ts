import { randomUUID } from 'node:crypto';

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import {
  CURRENT_SESSION_VERSION,
  type CompactionEntry,
  type CustomEntry,
  type SessionMessageEntry,
} from '@earendil-works/pi-coding-agent';

import { loadEntriesFromFile } from './load-jsonl-entries.js';

import { writeTextAtomic } from '../../infra/write-file-atomic.js';
import type { TranscriptCompactionRecord } from '../transcript-format.js';
import {
  buildSessionContextForLlm,
  isTranscriptContextEntry,
  type TranscriptStoredRow,
  type XopcTranscriptContextEntry,
} from '../session-context-for-llm.js';

/** Custom JSONL entry for persisted-only context rows. */
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

/**
 * Serialize transcript rows to a pi-coding-agent JSONL file (linear chain).
 */
export async function writeTranscriptJsonl(params: {
  absPath: string;
  sessionId: string;
  cwd: string;
  rows: TranscriptStoredRow[];
  appendCompaction?: TranscriptCompactionRecord;
}): Promise<void> {
  const byId = new Set<string>();
  const lines: string[] = [];
  const header = {
    type: 'session' as const,
    version: CURRENT_SESSION_VERSION,
    id: params.sessionId,
    timestamp: new Date().toISOString(),
    cwd: params.cwd,
  };
  lines.push(JSON.stringify(header));

  let parentId: string | null = null;
  for (const row of params.rows) {
    if (isTranscriptContextEntry(row)) {
      const e = contextRowToCustomEntry(row, parentId, byId);
      byId.add(e.id);
      lines.push(JSON.stringify(e));
      parentId = e.id;
    } else {
      const e = agentMessageToEntry(row, parentId, byId);
      byId.add(e.id);
      lines.push(JSON.stringify(e));
      parentId = e.id;
    }
  }

  if (params.appendCompaction) {
    const e = compactionRecordToEntry(params.appendCompaction, parentId, byId);
    byId.add(e.id);
    lines.push(JSON.stringify(e));
  }

  const body = `${lines.join('\n')}\n`;
  await writeTextAtomic(params.absPath, body);
}

function customEntryToContextRow(entry: CustomEntry): XopcTranscriptContextEntry | null {
  if (entry.customType !== XOPC_CONTEXT_CUSTOM_TYPE || !entry.data || typeof entry.data !== 'object') {
    return null;
  }
  const d = entry.data as Record<string, unknown>;
  if (d.kind !== 'context') {
    return null;
  }
  return {
    kind: 'context',
    id: typeof d.id === 'string' ? d.id : undefined,
    text: typeof d.text === 'string' ? d.text : undefined,
    data:
      d.data && typeof d.data === 'object' && !Array.isArray(d.data)
        ? (d.data as Record<string, unknown>)
        : undefined,
    createdAt: typeof d.createdAt === 'string' ? d.createdAt : entry.timestamp,
  };
}

/**
 * Load full transcript rows from a JSONL path (pi session file).
 */
export async function readTranscriptRowsFromFile(absPath: string): Promise<TranscriptStoredRow[]> {
  const entries = loadEntriesFromFile(absPath);
  const rows: TranscriptStoredRow[] = [];
  for (const e of entries) {
    if (e.type === 'session') {
      continue;
    }
    if (e.type === 'message' && 'message' in e && e.message) {
      rows.push(e.message as AgentMessage);
      continue;
    }
    if (e.type === 'custom') {
      const ctx = customEntryToContextRow(e as CustomEntry);
      if (ctx) {
        rows.push(ctx);
      }
    }
  }
  return rows;
}

export function rowsToLlmMessages(rows: TranscriptStoredRow[]): AgentMessage[] {
  return buildSessionContextForLlm(rows);
}
