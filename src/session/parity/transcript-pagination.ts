import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { TranscriptStoredRow, XopcTranscriptContextEntry } from '../session-context-for-llm.js';
import { XOPC_CONTEXT_CUSTOM_TYPE } from './jsonl-transcript-io.js';

export type TranscriptPageOptions = {
  limit: number;
  /** Exclusive end index into display message rows (default: total). */
  beforeIndex?: number;
  /** Tail offset (used when `beforeIndex` is omitted). */
  offset?: number;
};

export type TranscriptPageResult = {
  rows: TranscriptStoredRow[];
  total: number;
  startIndex: number;
  endIndex: number;
};

type ParsedLine = {
  line: string;
  kind: 'session' | 'message' | 'context' | 'other';
};

function classifyLine(line: string): ParsedLine['kind'] {
  const trimmed = line.trim();
  if (!trimmed) {
    return 'other';
  }
  if (trimmed.includes('"type":"session"') || trimmed.includes('"type": "session"')) {
    return 'session';
  }
  if (trimmed.includes('"type":"message"') || trimmed.includes('"type": "message"')) {
    return 'message';
  }
  if (trimmed.includes(`"${XOPC_CONTEXT_CUSTOM_TYPE}"`) || trimmed.includes('"type":"custom"')) {
    return 'context';
  }
  return 'other';
}

function parseStoredRow(line: string, kind: ParsedLine['kind']): TranscriptStoredRow | null {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (kind === 'message' && parsed.message) {
      return parsed.message as AgentMessage;
    }
    if (kind === 'context' && parsed.type === 'custom') {
      const data = parsed.data as Record<string, unknown> | undefined;
      if (!data || data.kind !== 'context') {
        return null;
      }
      return {
        kind: 'context',
        id: typeof data.id === 'string' ? data.id : undefined,
        text: typeof data.text === 'string' ? data.text : undefined,
        data: data.data as Record<string, unknown> | undefined,
        createdAt: typeof data.createdAt === 'string' ? data.createdAt : undefined,
      } satisfies XopcTranscriptContextEntry;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Count persisted pi `type: message` rows (excludes context custom rows).
 */
export async function countTranscriptMessageRows(absPath: string): Promise<number> {
  if (!existsSync(absPath)) {
    return 0;
  }
  const content = await readFile(absPath, 'utf8');
  let count = 0;
  for (const line of content.split('\n')) {
    const kind = classifyLine(line);
    if (kind === 'message') {
      count += 1;
    }
  }
  return count;
}

function isCompactionSummaryLine(line: string): boolean {
  return line.includes('[Previous conversation summary]');
}

/**
 * Read a page of display messages from transcript tail (newest page when cursors omitted).
 */
export async function readDisplayMessagePageFromTranscriptFile(
  absPath: string,
  options: TranscriptPageOptions,
): Promise<TranscriptPageResult & { messages: AgentMessage[] }> {
  if (!existsSync(absPath)) {
    return { rows: [], messages: [], total: 0, startIndex: 0, endIndex: 0 };
  }

  const limit = Math.max(1, Math.trunc(options.limit));
  const content = await readFile(absPath, 'utf8');
  const displayLines: ParsedLine[] = [];
  for (const line of content.split('\n')) {
    const kind = classifyLine(line);
    if (kind !== 'message') {
      continue;
    }
    if (isCompactionSummaryLine(line)) {
      continue;
    }
    displayLines.push({ line, kind });
  }

  const total = displayLines.length;
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const endExclusive =
    options.beforeIndex !== undefined
      ? Math.min(total, Math.max(0, Math.trunc(options.beforeIndex)))
      : Math.max(0, total - offset);
  const startInclusive = Math.max(0, endExclusive - limit);
  const slice = displayLines.slice(startInclusive, endExclusive);
  const rows: TranscriptStoredRow[] = [];
  const messages: AgentMessage[] = [];
  for (const item of slice) {
    const row = parseStoredRow(item.line, item.kind);
    if (row && typeof (row as AgentMessage).role === 'string') {
      rows.push(row);
      messages.push(row as AgentMessage);
    }
  }

  return {
    rows,
    messages,
    total,
    startIndex: startInclusive,
    endIndex: endExclusive,
  };
}

/**
 * Read a page of transcript rows from the tail (newest page when `beforeIndex` omitted).
 */
export async function readTranscriptRowsPageFromFile(
  absPath: string,
  options: TranscriptPageOptions,
): Promise<TranscriptPageResult> {
  if (!existsSync(absPath)) {
    return { rows: [], total: 0, startIndex: 0, endIndex: 0 };
  }

  const limit = Math.max(1, Math.trunc(options.limit));
  const content = await readFile(absPath, 'utf8');
  const parsedLines: ParsedLine[] = [];
  for (const line of content.split('\n')) {
    const kind = classifyLine(line);
    if (kind === 'session' || kind === 'other') {
      continue;
    }
    parsedLines.push({ line, kind });
  }

  const total = parsedLines.length;
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const endExclusive =
    options.beforeIndex !== undefined
      ? Math.min(total, Math.max(0, Math.trunc(options.beforeIndex)))
      : Math.max(0, total - offset);
  const startInclusive = Math.max(0, endExclusive - limit);
  const slice = parsedLines.slice(startInclusive, endExclusive);
  const rows: TranscriptStoredRow[] = [];
  for (const item of slice) {
    const row = parseStoredRow(item.line, item.kind);
    if (row) {
      rows.push(row);
    }
  }

  return {
    rows,
    total,
    startIndex: startInclusive,
    endIndex: endExclusive,
  };
}
