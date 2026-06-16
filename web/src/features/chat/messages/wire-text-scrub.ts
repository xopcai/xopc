// Text scrubbing applied to persisted user-message content so the UI re-renders
// the original wire form (rather than the server-expanded skill/file bodies).

const STARTUP_CONTEXT_MARKER = '[Startup context loaded by runtime]';
const STARTUP_MEMORY_TRUNCATED = '...[additional startup memory truncated]...';
const STARTUP_MEMORY_END = 'END_QUOTED_NOTES';

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

/**
 * Session stores the server-expanded skill body (see SkillManager.buildSkillBlock).
 * Collapse back to wire form for UI: `/skill:name` and optional trailing args from `**Arguments**:`.
 */
export function collapseExpandedSkillBlockForDisplay(text: string): string {
  if (typeof text !== 'string' || !text.includes('## Skill:')) {
    return text;
  }
  const nameMatch = text.match(/## Skill:\s*([^\s\r\n]+)/);
  if (!nameMatch) {
    return text;
  }
  const name = nameMatch[1] ?? '';
  if (!name) {
    return text;
  }
  const argMatches = [...text.matchAll(/\*\*Arguments\*\*:\s*([^\r\n]+)/g)];
  const args =
    argMatches.length > 0 ? (argMatches[argMatches.length - 1]?.[1] ?? '').trim() : '';
  return args ? `/skill:${name} ${args}` : `/skill:${name}`;
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

/** Remove persisted media claim-check lines from bubble text (thumbnails use `media[]`). */
export function stripMediaAttachedClaimCheck(text: string): string {
  if (!text.includes('[media attached:') && !text.includes('xopc-media-uri:')) return text;
  return text
    .replace(
      /\s*\[media attached:[^\]]+\]\s*\r?\nxopc-media-uri:[^\r\n]+\r?\n\s*xopc-media-path:[^\r\n]+(?:\r?\n\s*Use the read_media tool[^\r\n]*)?/g,
      '',
    )
    .replace(/\s*\[media attached:[^\]]+\]\s*/g, ' ')
    .replace(/\s*xopc-media-uri:[^\r\n]+/g, '')
    .replace(/\s*xopc-media-path:[^\r\n]+/g, '')
    .replace(/\s*Use the read_media tool[^\r\n]*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Full user-bubble scrub for persisted transcript text. */
export function stripUserMessageForDisplay(text: string): string {
  let out = stripStartupContextForDisplay(text);
  out = stripExpandedAtFileBlocks(out);
  out = stripMediaAttachedClaimCheck(out);
  return collapseExpandedSkillBlockForDisplay(out);
}

/** Remove persisted inbound machine lines from bubble text (attachments show separately). */
export function stripInboundFileMachineText(text: string): string {
  if (!text.includes('xopc-path:')) return text;
  let out = text;
  // Multiline (canonical persist format)
  out = out.replace(
    /\s*\[File:[^\]]+\]\s*\r?\nxopc-path:rel:[^\r\n]+\r?\n\s*xopc-path:abs:[^\r\n]+/g,
    '',
  );
  // Single line (e.g. markdown collapsed whitespace)
  out = out.replace(/\s*\[File:[^\]]+\]\s+xopc-path:rel:\S+\s+xopc-path:abs:\S+/g, '');
  out = out.replace(/\s*\[File:[^\]]+\]\s*xopc-path:rel:\S+\s*xopc-path:abs:\S+/g, '');
  return out.replace(/\n{3,}/g, '\n\n').trim();
}
