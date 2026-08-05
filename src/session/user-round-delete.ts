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
  userRoundIndex: number,
): { startIndex: number; count: number } | null {
  if (!Number.isInteger(userRoundIndex) || userRoundIndex < 0 || rows.length === 0) {
    return null;
  }

  let userCount = 0;
  let startIndex = -1;
  for (let index = 0; index < rows.length; index += 1) {
    if (!isVisibleUserRow(rows[index]!)) continue;
    if (userCount === userRoundIndex) {
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
