/** Regex to match `/skill:name` tokens (name is non-whitespace). */
const SLASH_TOKEN_RE = /\/skill:\S+/g;

export interface SlashTokenSegment {
  text: string;
  isPill: boolean;
  start: number;
  end: number;
}

/** Parse the draft into segments: plain text and pill tokens. */
export function parseSlashTokens(text: string): SlashTokenSegment[] {
  const segments: SlashTokenSegment[] = [];
  let lastIndex = 0;

  const regex = new RegExp(SLASH_TOKEN_RE.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        text: text.slice(lastIndex, match.index),
        isPill: false,
        start: lastIndex,
        end: match.index,
      });
    }
    segments.push({
      text: match[0],
      isPill: true,
      start: match.index,
      end: match.index + match[0].length,
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({
      text: text.slice(lastIndex),
      isPill: false,
      start: lastIndex,
      end: text.length,
    });
  }

  return segments;
}

/**
 * Given a cursor position, check if it's immediately after a pill token.
 * Returns the token range to delete, or null.
 */
export function findPillTokenEndingAtCursor(
  text: string,
  cursor: number,
): { start: number; end: number } | null {
  const regex = new RegExp(SLASH_TOKEN_RE.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const tokenEnd = match.index + match[0].length;
    if (tokenEnd === cursor) {
      return { start: match.index, end: tokenEnd };
    }
  }
  return null;
}
