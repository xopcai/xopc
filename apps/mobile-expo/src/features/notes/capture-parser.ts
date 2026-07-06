/**
 * Smart content parsing for quick capture input.
 *
 * Detects:
 *  - Todo patterns: lines starting with "- [ ]", "[ ]", "- ", "* ", or "todo:" prefix
 *  - URLs: http(s)://... patterns
 *  - Plain text (default)
 *
 * Returns a suggested NoteKind so the server can categorize appropriately.
 */
import type { NoteKind } from '../../query/notes';

export type ParsedCaptureIntent = {
  kind: NoteKind;
  text: string;
  /** True if text contains at least one checkbox/todo pattern. */
  hasTodos: boolean;
  /** True if text contains at least one URL. */
  hasLinks: boolean;
};

const TODO_LINE_PATTERN = /^(\s*[-*]\s*\[[ x]?\]|\s*[-*]\s+|todo:\s*)/im;
const URL_PATTERN = /https?:\/\/[^\s<>)"']+/i;

/**
 * Analyze raw capture text and infer the note kind.
 * Does NOT mutate the text — just classifies it.
 */
export function parseCaptureIntent(rawText: string): ParsedCaptureIntent {
  const text = rawText.trim();
  if (!text) {
    return { kind: 'thought', text, hasTodos: false, hasLinks: false };
  }

  const hasTodos = TODO_LINE_PATTERN.test(text);
  const hasLinks = URL_PATTERN.test(text);

  let kind: NoteKind = 'thought';
  if (hasTodos) {
    kind = 'todo';
  } else if (hasLinks && text.split('\n').length <= 2) {
    // Single URL or URL + short description → bookmark
    kind = 'bookmark';
  }

  return { kind, text, hasTodos, hasLinks };
}

/**
 * Return the i18n key suffix for the capture intent badge.
 * Returns null if no special detection (plain thought).
 * Caller should use this to look up the localized label, e.g. `m.notesPage[key]`.
 */
export function captureIntentBadgeKey(intent: ParsedCaptureIntent): 'kindTodo' | 'kindBookmark' | null {
  if (intent.kind === 'todo') return 'kindTodo';
  if (intent.kind === 'bookmark') return 'kindBookmark';
  return null;
}
