import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import {
  CURRENT_SESSION_VERSION,
  type CompactionEntry,
  type CustomEntry,
  type SessionEntry,
  type SessionMessageEntry,
  SessionManager,
} from '@earendil-works/pi-coding-agent';

import { loadEntriesFromFile } from './load-jsonl-entries.js';
import { withTranscriptFileLock } from './transcript-file-lock.js';

import { emitSessionTranscriptUpdate } from '../transcript-events.js';
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

function transcriptRowsStrictPrefix(prev: TranscriptStoredRow[], merged: TranscriptStoredRow[]): boolean {
  if (merged.length < prev.length) {
    return false;
  }
  for (let i = 0; i < prev.length; i++) {
    if (JSON.stringify(prev[i]) !== JSON.stringify(merged[i])) {
      return false;
    }
  }
  return true;
}

async function writeTranscriptJsonlUnlocked(params: {
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

/**
 * Map the current session branch to the same {@link TranscriptStoredRow} projection as
 * {@link readTranscriptRowsFromFile} (messages + xopc context custom rows only).
 */
function branchPathToTranscriptRows(branch: SessionEntry[]): TranscriptStoredRow[] {
  const rows: TranscriptStoredRow[] = [];
  for (const e of branch) {
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

/**
 * Persist the in-memory {@link SessionManager} graph with an atomic rewrite of the JSONL file.
 * Ensures durability even when pi would otherwise defer `_persist` until the first assistant message.
 */
export async function writeAtomicSessionManagerSnapshot(
  sessionManager: SessionManager,
  absPath: string,
): Promise<void> {
  const header = sessionManager.getHeader();
  if (!header || header.type !== 'session') {
    throw new Error('SessionManager: missing session header for snapshot');
  }
  const entries = sessionManager.getEntries();
  const body = `${JSON.stringify(header)}\n${entries.map((e) => JSON.stringify(e)).join('\n')}\n`;
  await writeTextAtomic(absPath, body);
}

/**
 * Serialize transcript rows to a pi-coding-agent JSONL file (linear chain).
 * Always rewrites the file; guarded by a cross-process transcript lock.
 */
export async function writeTranscriptJsonl(params: {
  absPath: string;
  sessionId: string;
  cwd: string;
  rows: TranscriptStoredRow[];
  appendCompaction?: TranscriptCompactionRecord;
}): Promise<void> {
  await withTranscriptFileLock(params.absPath, async () => {
    await writeTranscriptJsonlUnlocked(params);
  });
}

/**
 * Persist merged transcript rows with append optimization (strict prefix → tail append).
 * Intended for hot paths that already merged prior rows with new LLM state.
 */
export async function persistMergedTranscriptRows(params: {
  absPath: string;
  sessionId: string;
  cwd: string;
  rows: TranscriptStoredRow[];
  appendCompaction?: TranscriptCompactionRecord;
}): Promise<void> {
  await withTranscriptFileLock(params.absPath, async () => {
    const prev = existsSync(params.absPath) ? await readTranscriptRowsFromFile(params.absPath) : [];
    if (
      params.appendCompaction ||
      params.rows.length <= prev.length ||
      !transcriptRowsStrictPrefix(prev, params.rows)
    ) {
      await writeTranscriptJsonlUnlocked(params);
      return;
    }
    const sessionDir = path.dirname(params.absPath);
    const sm = SessionManager.open(params.absPath, sessionDir, params.cwd);
    const branchRows = branchPathToTranscriptRows(sm.getBranch());
    if (JSON.stringify(branchRows) !== JSON.stringify(prev)) {
      await writeTranscriptJsonlUnlocked(params);
      return;
    }
    const tail = params.rows.slice(prev.length);
    for (const row of tail) {
      if (isTranscriptContextEntry(row)) {
        sm.appendCustomEntry(XOPC_CONTEXT_CUSTOM_TYPE, {
          kind: 'context',
          id: row.id,
          text: row.text,
          data: row.data,
          createdAt: row.createdAt,
        });
      } else {
        sm.appendMessage(row as Parameters<SessionManager['appendMessage']>[0]);
      }
    }
    await writeAtomicSessionManagerSnapshot(sm, params.absPath);
  });
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
/**
 * Append one `xopc:transcript-row` context entry via pi SessionManager (OpenClaw-aligned append path).
 */
/** Append one LLM message row via pi SessionManager (slash receipts, goals, etc.). */
export async function appendPiTranscriptMessage(params: {
  absPath: string;
  cwd: string;
  message: import('@earendil-works/pi-agent-core').AgentMessage;
  sessionKey?: string;
}): Promise<void> {
  await withTranscriptFileLock(params.absPath, async () => {
    const sessionDir = path.dirname(params.absPath);
    const sm = SessionManager.open(params.absPath, sessionDir, params.cwd);
    sm.appendMessage(params.message as Parameters<SessionManager['appendMessage']>[0]);
    await writeAtomicSessionManagerSnapshot(sm, params.absPath);
    emitSessionTranscriptUpdate({
      sessionFile: params.absPath,
      sessionKey: params.sessionKey,
    });
  });
}

export async function appendPiTranscriptContextEntry(params: {
  absPath: string;
  cwd: string;
  entry: XopcTranscriptContextEntry;
  sessionKey?: string;
}): Promise<void> {
  await withTranscriptFileLock(params.absPath, async () => {
    const sessionDir = path.dirname(params.absPath);
    const sm = SessionManager.open(params.absPath, sessionDir, params.cwd);
    sm.appendCustomEntry(XOPC_CONTEXT_CUSTOM_TYPE, {
      kind: 'context',
      id: params.entry.id,
      text: params.entry.text,
      data: params.entry.data,
      createdAt: params.entry.createdAt ?? new Date().toISOString(),
    });
    await writeAtomicSessionManagerSnapshot(sm, params.absPath);
    emitSessionTranscriptUpdate({
      sessionFile: params.absPath,
      sessionKey: params.sessionKey,
    });
  });
}

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
