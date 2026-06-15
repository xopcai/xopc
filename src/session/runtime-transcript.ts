import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { type CustomEntry } from '@earendil-works/pi-coding-agent';

import { resolveStateDir } from '../config/paths-state.js';
import { writeTextAtomic } from '../infra/write-file-atomic.js';
import { loadEntriesFromFile } from './load-jsonl-entries.js';
import type { TranscriptCompactionRecord } from './transcript-format.js';
import {
  isTranscriptContextEntry,
  type TranscriptStoredRow,
  type XopcTranscriptContextEntry,
} from './session-context-for-llm.js';
import { storedRowsToFileEntries, XOPC_CONTEXT_CUSTOM_TYPE } from './stored-rows-to-file-entries.js';

export { XOPC_CONTEXT_CUSTOM_TYPE };

export function resolveRuntimeTranscriptDir(): string {
  return join(resolveStateDir(), 'runtime', 'transcripts');
}

export function resolveRuntimeTranscriptPath(transcriptId: string): string {
  return join(resolveRuntimeTranscriptDir(), `${transcriptId}.jsonl`);
}

export function readRuntimeTranscriptRows(absPath: string): TranscriptStoredRow[] {
  const entries = loadEntriesFromFile(absPath);
  const rows: TranscriptStoredRow[] = [];
  for (const entry of entries) {
    if (entry.type === 'message' && 'message' in entry && entry.message) {
      rows.push(entry.message as AgentMessage);
      continue;
    }
    if (entry.type === 'custom') {
      const custom = entry as CustomEntry;
      if (custom.customType !== XOPC_CONTEXT_CUSTOM_TYPE || !custom.data || typeof custom.data !== 'object') {
        continue;
      }
      const d = custom.data as Record<string, unknown>;
      if (d.kind !== 'context') {
        continue;
      }
      rows.push({
        kind: 'context',
        id: typeof d.id === 'string' ? d.id : undefined,
        text: typeof d.text === 'string' ? d.text : undefined,
        data:
          d.data && typeof d.data === 'object' && !Array.isArray(d.data)
            ? (d.data as Record<string, unknown>)
            : undefined,
        createdAt: typeof d.createdAt === 'string' ? d.createdAt : custom.timestamp,
      } satisfies XopcTranscriptContextEntry);
    }
  }
  return rows;
}

/** @deprecated Runtime JSONL cache removed in Phase 4; retained for tests/helpers only. */
export async function hydrateRuntimeTranscriptFile(params: {
  absPath: string;
  sessionId: string;
  cwd: string;
  rows: TranscriptStoredRow[];
}): Promise<void> {
  await mkdir(dirname(params.absPath), { recursive: true });
  await writeRuntimeTranscriptJsonl(params);
}

/** @deprecated Runtime JSONL cache removed in Phase 4; retained for tests/helpers only. */
export async function writeRuntimeTranscriptJsonl(params: {
  absPath: string;
  sessionId: string;
  cwd: string;
  rows: TranscriptStoredRow[];
  appendCompaction?: TranscriptCompactionRecord;
}): Promise<void> {
  await mkdir(dirname(params.absPath), { recursive: true });
  const entries = storedRowsToFileEntries(params);
  const lines = entries.map((entry) => JSON.stringify(entry));
  await writeTextAtomic(params.absPath, `${lines.join('\n')}\n`);
}
