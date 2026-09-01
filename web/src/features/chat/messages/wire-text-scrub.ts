// Text scrubbing applied to persisted user-message content so the UI re-renders
// the original wire form (rather than the server-expanded skill/file bodies).

import {
  stripMediaClaimCheck,
  stripRuntimeUserMessageEnvelope,
  stripSourceContextsEnvelope,
} from '@xopcai/gateway-contract';

const STARTUP_CONTEXT_MARKER = '[Startup context loaded by runtime]';
const STARTUP_MEMORY_TRUNCATED = '...[additional startup memory truncated]...';
const STARTUP_MEMORY_END = 'END_QUOTED_NOTES';

function joinDisplayParts(...parts: string[]): string {
  return parts.filter((part) => part.length > 0).join('\n\n');
}

/**
 * Remove runtime-injected startup daily-memory prelude from persisted user text.
 * The LLM still receives the prelude; the chat bubble should show only the user's words.
 */
export function stripStartupContextForDisplay(text: string): string {
  if (!text.includes(STARTUP_CONTEXT_MARKER)) {
    return text;
  }
  const trimmed = text.replace(/^\uFEFF/, '');
  if (!trimmed.startsWith(STARTUP_CONTEXT_MARKER)) {
    return text;
  }

  let cutIndex = -1;
  const lastEndNotes = trimmed.lastIndexOf(STARTUP_MEMORY_END);
  if (lastEndNotes >= 0) {
    cutIndex = lastEndNotes + STARTUP_MEMORY_END.length;
  } else {
    const truncIdx = trimmed.indexOf(STARTUP_MEMORY_TRUNCATED);
    if (truncIdx >= 0) {
      cutIndex = truncIdx + STARTUP_MEMORY_TRUNCATED.length;
    }
  }

  if (cutIndex < 0) {
    const afterMarker = trimmed.slice(STARTUP_CONTEXT_MARKER.length);
    const doubleNewline = afterMarker.indexOf('\n\n');
    if (doubleNewline >= 0) {
      return afterMarker.slice(doubleNewline + 2).replace(/^\s+/, '');
    }
    return text;
  }

  return trimmed.slice(cutIndex).replace(/^\s+/, '');
}

/** Collapse an expanded skill block back to its wire form without dropping surrounding user text. */
export function collapseExpandedSkillBlockForDisplay(text: string): string {
  if (typeof text !== 'string' || !text.includes('## Skill:')) {
    return text;
  }

  const blockStart = text.indexOf('## Skill:');
  const prefix = text.slice(0, blockStart).replace(/\s+$/, '');
  const skillSection = text.slice(blockStart);
  const nameMatch = skillSection.match(/## Skill:\s*([^\s\r\n]+)/);
  if (!nameMatch) {
    return text;
  }
  const name = nameMatch[1] ?? '';
  if (!name) {
    return text;
  }
  const argMatches = [...skillSection.matchAll(/\*\*Arguments\*\*:\s*([^\r\n]+)/g)];
  const args =
    argMatches.length > 0 ? (argMatches[argMatches.length - 1]?.[1] ?? '').trim() : '';
  const wireToken = args ? `/skill:${name} ${args}` : `/skill:${name}`;

  let blockEnd = skillSection.length;
  if (argMatches.length > 0) {
    const lastArgument = argMatches[argMatches.length - 1];
    blockEnd = (lastArgument.index ?? 0) + lastArgument[0].length;
  }
  const suffix = skillSection.slice(blockEnd).replace(/^\s+/, '');
  return joinDisplayParts(prefix, wireToken, suffix);
}

/**
 * Remove `<file path="…">…</file>` blocks prepended by `expandAtFileMentionsInPlainText`
 * when the server persists the expanded @file: content into the session transcript.
 * The original `@file:` wire tokens are kept so `UserMessageSegments` can render pills.
 */
export function stripExpandedAtFileBlocks(text: string): string {
  if (!text.includes('<file path=')) return text;
  return text
    .replace(/<file\s+path="[^"]*">\r?\n[\s\S]*?<\/file>(?:\r?\n)*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Full user-bubble scrub for persisted transcript text. */
export function stripUserMessageForDisplay(text: string): string {
  let out = stripStartupContextForDisplay(text);
  out = stripRuntimeUserMessageEnvelope(out);
  out = stripExpandedAtFileBlocks(out);
  out = stripMediaClaimCheck(out);
  out = stripImageUnderstandingContext(out);
  return collapseExpandedSkillBlockForDisplay(out);
}

/** Remove message-level source snapshots; summary refs are rendered as chips from metadata. */
export function stripSourceContextsForDisplay(text: string): string {
  return stripSourceContextsEnvelope(text);
}

const IMAGE_UNDERSTANDING_CONTEXT_RE =
  /(?:\n{2,})?\[(?:Image description:|\d+ image\(s\) attached(?:; no image-capable model is available to describe them\.| but could not be described:))[\s\S]*\]\s*$/;

export function stripImageUnderstandingContext(text: string): string {
  return text.replace(IMAGE_UNDERSTANDING_CONTEXT_RE, '').trimEnd();
}
