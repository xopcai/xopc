export type UnclosedInlineCodeSpan = {
  start: number;
  delimiterLength: number;
};

type Fence = {
  marker: '`' | '~';
  length: number;
};

function isEscaped(text: string, index: number): boolean {
  let precedingBackslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    precedingBackslashes += 1;
  }
  return precedingBackslashes % 2 === 1;
}

function fenceRun(line: string): { marker: '`' | '~'; length: number; rest: string } | null {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  const delimiter = match?.[1];
  if (!delimiter || !match) return null;
  return {
    marker: delimiter[0] as '`' | '~',
    length: delimiter.length,
    rest: match[2] ?? '',
  };
}

/**
 * Locate an inline-code delimiter that has not yet been closed. Fenced code is
 * ignored because Marked can render an unfinished fence without exposing its
 * opening marker as ordinary prose.
 */
export function findUnclosedInlineCodeSpan(text: string): UnclosedInlineCodeSpan | null {
  let fence: Fence | null = null;
  let inline: UnclosedInlineCodeSpan | null = null;
  let offset = 0;

  for (const segment of text.match(/[^\n]*(?:\n|$)/g) ?? []) {
    if (!segment) continue;
    const line = segment.endsWith('\n') ? segment.slice(0, -1) : segment;

    if (!inline) {
      const run = fenceRun(line);
      if (run) {
        if (!fence) {
          // Backtick fence info strings cannot contain another backtick.
          if (run.marker === '~' || !run.rest.includes('`')) {
            fence = { marker: run.marker, length: run.length };
            offset += segment.length;
            continue;
          }
        } else if (
          run.marker === fence.marker
          && run.length >= fence.length
          && !run.rest.trim()
        ) {
          fence = null;
          offset += segment.length;
          continue;
        }
      }
    }

    if (!fence) {
      for (let cursor = 0; cursor < line.length;) {
        if (line[cursor] !== '`' || isEscaped(line, cursor)) {
          cursor += 1;
          continue;
        }
        let runEnd = cursor + 1;
        while (line[runEnd] === '`') runEnd += 1;
        const delimiterLength = runEnd - cursor;
        if (!inline) {
          inline = { start: offset + cursor, delimiterLength };
        } else if (inline.delimiterLength === delimiterLength) {
          inline = null;
        }
        cursor = runEnd;
      }
    }

    offset += segment.length;
  }

  return fence ? null : inline;
}

/** Keep a character-limit truncation from cutting through an inline code span. */
export function markdownSafeTruncationEnd(
  text: string,
  preferredEnd: number,
  maxExtension = 160,
): number {
  if (preferredEnd >= text.length) return text.length;
  const open = findUnclosedInlineCodeSpan(text.slice(0, preferredEnd));
  if (!open) return preferredEnd;

  for (let cursor = preferredEnd; cursor < text.length;) {
    if (text[cursor] !== '`' || isEscaped(text, cursor)) {
      cursor += 1;
      continue;
    }
    let runEnd = cursor + 1;
    while (text[runEnd] === '`') runEnd += 1;
    if (runEnd - cursor === open.delimiterLength && runEnd - preferredEnd <= maxExtension) {
      return runEnd;
    }
    cursor = runEnd;
  }

  return open.start;
}
