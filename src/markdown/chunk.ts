/**
 * Text chunking utilities for markdown processing
 *
 * Provides fence-aware text splitting for Telegram message limits.
 */

import { findFenceSpanAt, isSafeFenceBreak, parseFenceSpans } from "./fences.js";

/**
 * Split text into chunks that fit within a character limit.
 * Tries to break at natural boundaries (newlines, word boundaries).
 */
export function chunkText(text: string, limit: number): string[] {
  if (!text) {
    return [];
  }
  if (limit <= 0) {
    return [text];
  }
  if (text.length <= limit) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > limit) {
    const window = remaining.slice(0, limit);

    // Try to find a good break point
    const breakIdx = findBreakPoint(window, remaining, limit);

    let rawChunk = remaining.slice(0, breakIdx);
    if (!rawChunk) {
      // Force break at limit if no good breakpoint found
      rawChunk = remaining.slice(0, limit);
      chunks.push(rawChunk);
      remaining = remaining.slice(limit);
      continue;
    }

    const brokeOnSeparator = breakIdx < remaining.length && /\s/.test(remaining[breakIdx]);
    const nextStart = Math.min(remaining.length, breakIdx + (brokeOnSeparator ? 1 : 0));
    let next = remaining.slice(nextStart);

    // Strip leading newlines from next chunk
    next = stripLeadingNewlines(next);

    chunks.push(rawChunk);
    remaining = next;
  }

  if (remaining.length) {
    chunks.push(remaining);
  }

  return chunks;
}

/**
 * Find a good break point in the window, considering fence boundaries.
 */
function findBreakPoint(window: string, remaining: string, limit: number): number {
  const spans = parseFenceSpans(remaining);

  // Scan for breakpoints
  let lastNewline = -1;
  let lastWhitespace = -1;

  for (let i = 0; i < window.length; i++) {
    if (!isSafeFenceBreak(spans, i)) {
      continue;
    }

    const char = window[i];
    if (char === "\n") {
      lastNewline = i;
    } else if (/\s/.test(char)) {
      lastWhitespace = i;
    }
  }

  // Prefer newline, then whitespace, then force at limit
  if (lastNewline > 0) {
    return lastNewline;
  }
  if (lastWhitespace > 0) {
    return lastWhitespace;
  }

  // Check if we're inside a fence
  const fence = findFenceSpanAt(spans, limit);
  if (fence) {
    // Try to break at the end of the fence's opening line
    const fenceEnd = fence.start + fence.openLine.length;
    if (fenceEnd < limit && fenceEnd > 0) {
      return fenceEnd;
    }
  }

  return limit;
}

function stripLeadingNewlines(value: string): string {
  let i = 0;
  while (i < value.length && value[i] === "\n") {
    i++;
  }
  return i > 0 ? value.slice(i) : value;
}
