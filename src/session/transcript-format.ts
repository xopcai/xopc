/**
 * API-level transcript summary types (authoritative storage is SQLite `transcript_entries`).
 */

import type {
  TranscriptStoredRow,
  XopcTranscriptCompactionEntry,
} from './session-context-for-llm.js';

export const XOPC_SESSION_TRANSCRIPT_TYPE = 'xopc_session_transcript' as const;

export const CURRENT_SESSION_TRANSCRIPT_VERSION = 1;

/** Record appended when context compaction runs (mirrors pi `CompactionEntry` audit fields). */
export type TranscriptCompactionRecord = Omit<XopcTranscriptCompactionEntry, 'type'>;

/** Synthetic document shape returned by {@link SessionStore.loadTranscriptDocument} for API parity. */
export interface XopcSessionTranscriptV1 {
  type: typeof XOPC_SESSION_TRANSCRIPT_TYPE;
  version: number;
  id: string;
  createdAt: string;
  updatedAt: string;
  messages: TranscriptStoredRow[];
  compactions?: TranscriptCompactionRecord[];
}
