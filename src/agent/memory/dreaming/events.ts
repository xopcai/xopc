import fs from 'node:fs/promises';
import path from 'node:path';

import { DREAMING_DIR_RELATIVE, DREAMING_EVENTS_LOG_RELATIVE, type DreamingPhaseId } from './constants.js';

// ── Event types ────────────────────────────────────────────────────────

export type DreamingEventBase = {
  timestamp: string;
  phase: DreamingPhaseId;
  ok: boolean;
  reason: string;
  durationMs: number;
};

export type DreamingLightEvent = DreamingEventBase & {
  phase: 'light';
  scannedEntries: number;
  newSignals: number;
  deduped: number;
};

export type DreamingDeepEvent = DreamingEventBase & {
  phase: 'deep';
  candidates: number;
  applied: number;
};

export type DreamingRemEvent = DreamingEventBase & {
  phase: 'rem';
  patternsDiscovered: number;
  entriesAnalyzed: number;
};

export type DreamingEvent = DreamingLightEvent | DreamingDeepEvent | DreamingRemEvent;

// ── Write ──────────────────────────────────────────────────────────────

/**
 * Append a single event line to an agent's `memories/.dreams/events.jsonl`.
 * Creates the directory and file if they don't exist.
 * Failures are silently ignored so audit logging never blocks execution.
 */
export async function appendDreamingEvent(dreamingRoot: string, event: DreamingEvent): Promise<void> {
  try {
    const dirPath = path.join(dreamingRoot, DREAMING_DIR_RELATIVE);
    await fs.mkdir(dirPath, { recursive: true });
    const filePath = path.join(dreamingRoot, DREAMING_EVENTS_LOG_RELATIVE);
    const line = JSON.stringify(event) + '\n';
    await fs.appendFile(filePath, line, 'utf-8');
  } catch {
    // Audit logging must not block or throw.
  }
}

// ── Read ───────────────────────────────────────────────────────────────

/**
 * Read the most recent N events from the events log.
 * Returns newest-first. If the file doesn't exist, returns an empty array.
 */
export async function readDreamingEvents(
  dreamingRoot: string,
  limit = 50,
): Promise<DreamingEvent[]> {
  const filePath = path.join(dreamingRoot, DREAMING_EVENTS_LOG_RELATIVE);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT') return [];
    throw err;
  }

  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  // Take the last `limit` lines (newest entries are at the end).
  const tail = lines.slice(-Math.abs(limit));

  const events: DreamingEvent[] = [];
  for (const line of tail) {
    try {
      const parsed = JSON.parse(line) as DreamingEvent;
      if (parsed && typeof parsed === 'object' && parsed.timestamp && parsed.phase) {
        events.push(parsed);
      }
    } catch {
      // Skip malformed lines.
    }
  }

  // Return newest first.
  events.reverse();
  return events;
}
