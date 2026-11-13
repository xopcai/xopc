import {
  isTranscriptCustomMessageEntry,
  type TranscriptStoredRow,
} from './session-context-for-llm.js';

function isVisibleUserRow(row: TranscriptStoredRow): boolean {
  if (isTranscriptCustomMessageEntry(row)) {
    return row.display !== false;
  }
  return (row as { role?: unknown }).role === 'user';
}

/** Raw transcript range for one UI-visible user turn. */
export function computeTranscriptUserRoundDeleteRange(
  rows: readonly TranscriptStoredRow[],
  target: number | { steerId: string },
): { startIndex: number; count: number } | null {
  if (typeof target === 'number' && (!Number.isInteger(target) || target < 0)) {
    return null;
  }

  let userCount = 0;
  let startIndex = -1;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    if (!isVisibleUserRow(row)) continue;
    const { role, metadata } = row as { role?: unknown; metadata?: { steered?: boolean; clientMessageId?: string } };
    if (typeof target === 'number' ? userCount === target
      : role === 'user' && metadata?.steered === true && metadata.clientMessageId === target.steerId) {
      startIndex = index;
      break;
    }
    userCount += 1;
  }
  if (startIndex < 0) return null;

  let end = startIndex + 1;
  while (end < rows.length && !isVisibleUserRow(rows[end]!)) {
    end += 1;
  }
  return { startIndex, count: end - startIndex };
}
