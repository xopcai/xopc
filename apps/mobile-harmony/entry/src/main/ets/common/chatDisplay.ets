const ENVELOPE_TIMESTAMP_PREFIX_RE = /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}[^\]]*\]\s*/u;
const USER_CONTEXT_TAGS = [
  'user-profile',
  'active-focuses',
  'collaboration-contract',
  'user-context',
];

function stripLeadingTaggedBlock(text: string, tag: string): string | null {
  const opening = `<${tag}>`;
  if (!text.startsWith(opening)) return null;
  const closing = `</${tag}>`;
  const closingIndex = text.indexOf(closing, opening.length);
  if (closingIndex < 0) return null;
  return text.slice(closingIndex + closing.length).trimStart();
}

function beginsWithGeneratedTurnPayload(text: string): boolean {
  return ENVELOPE_TIMESTAMP_PREFIX_RE.test(text)
    || text.startsWith('<source_contexts>')
    || USER_CONTEXT_TAGS.some((tag: string): boolean => text.startsWith(`<${tag}>`));
}

/** Remove frozen source snapshots while preserving the wrapped user-authored message. */
export function stripSourceContextsEnvelope(text: string): string {
  if (!text.includes('<source_contexts>')) return text;
  const withoutContexts = text
    .replace(/^\s*<source_contexts>[\s\S]*?<\/source_contexts>\s*/u, '')
    .trimStart();
  const wrappedUserMessage = withoutContexts.match(/^<user_message>\r?\n([\s\S]*)\r?\n<\/user_message>\s*$/u);
  return wrappedUserMessage?.[1] ?? withoutContexts;
}

/**
 * Restore a model-facing user message to its client-facing text.
 * Generated profile/memory blocks require the runtime timestamp anchor, which
 * keeps equivalent user-authored XML visible.
 */
export function stripRuntimeUserMessageEnvelope(text: string): string {
  let remaining = text;
  const taskStripped = stripLeadingTaggedBlock(remaining.trimStart(), 'xopc_task_execution');
  if (taskStripped !== null && beginsWithGeneratedTurnPayload(taskStripped)) {
    remaining = taskStripped;
  }

  remaining = stripSourceContextsEnvelope(remaining);

  const beforeUserContext = remaining;
  let removedUserContext = false;
  remaining = remaining.trimStart();
  while (true) {
    const tag = USER_CONTEXT_TAGS.find((candidate: string): boolean => remaining.startsWith(`<${candidate}>`));
    if (!tag) break;
    const next = stripLeadingTaggedBlock(remaining, tag);
    if (next === null) {
      remaining = beforeUserContext;
      removedUserContext = false;
      break;
    }
    remaining = next;
    removedUserContext = true;
  }
  if (removedUserContext && !ENVELOPE_TIMESTAMP_PREFIX_RE.test(remaining)) {
    remaining = beforeUserContext;
  }

  return remaining.replace(ENVELOPE_TIMESTAMP_PREFIX_RE, '');
}

/** Remove model-only media claim-check lines from client-facing user text. */
export function stripMediaClaimCheck(text: string): string {
  if (!text.includes('[media attached:') && !text.includes('xopc-media-uri:')) {
    return text;
  }
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

// Text scrubbing applied to persisted user-message content so the UI re-renders
// the original wire form (rather than the server-expanded skill/file bodies).



const STARTUP_CONTEXT_MARKER = '[Startup context loaded by runtime]';

export function extractMarkdownCodeBlocks(text: string): string {
  return Array.from(text.matchAll(/```[\w-]*\n?([\s\S]*?)```/g))
    .map((match: RegExpMatchArray): string => match[1]?.trim() ?? '')
    .filter((part: string): boolean => !!part).join('\n\n');
}
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

/** Remove all model-only turn envelopes shared by gateway, Web, TUI, and mobile. */
export function stripRuntimeContextForDisplay(text: string): string {
  return stripRuntimeUserMessageEnvelope(stripStartupContextForDisplay(text));
}

function joinDisplayParts(...parts: string[]): string {
  return parts.filter((p: string): boolean => p.length > 0).join('\n\n');
}

/**
 * Session stores the server-expanded skill body (see SkillManager.buildSkillBlock).
 * Collapse the expanded block back to wire form (`/skill:name` + optional args) while
 * preserving any user text before or after the skill block.
 */
export function collapseExpandedSkillBlockForDisplay(text: string): string {
  if (typeof text !== 'string' || !text.includes('## Skill:')) {
    return text;
  }

  const blockStart = text.indexOf('## Skill:');
  if (blockStart < 0) {
    return text;
  }

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

  const argMatches = Array.from(skillSection.matchAll(/\*\*Arguments\*\*:\s*([^\r\n]+)/g));
  const args =
    argMatches.length > 0 ? (argMatches[argMatches.length - 1]?.[1] ?? '').trim() : '';
  const wireToken = args ? `/skill:${name} ${args}` : `/skill:${name}`;

  let skillBlockEnd = skillSection.length;
  if (argMatches.length > 0) {
    const lastArg = argMatches[argMatches.length - 1]!;
    skillBlockEnd = (lastArg.index ?? 0) + lastArg[0].length;
  }

  const suffix = skillSection.slice(skillBlockEnd).replace(/^\s+/, '');
  return joinDisplayParts(prefix, wireToken, suffix);
}

/**
 * Remove `<file path="…">…</file>` blocks prepended by `expandAtFileMentionsInPlainText`
 * when the server persists the expanded @file: content into the session transcript.
 */
export function stripExpandedAtFileBlocks(text: string): string {
  if (!text.includes('<file path=')) return text;
  return text
    .replace(/<file\s+path="[^"]*">\r?\n[\s\S]*?<\/file>(?:\r?\n)*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const IMAGE_UNDERSTANDING_CONTEXT_RE =
  /(?:\n{2,})?\[(?:Image description:|\d+ image\(s\) attached(?:; no image-capable model is available to describe them\.| but could not be described:))[\s\S]*\]\s*$/;

/** Remove model-only image understanding text from the visible user bubble. */
export function stripImageUnderstandingContext(text: string): string {
  return text.replace(IMAGE_UNDERSTANDING_CONTEXT_RE, '').trimEnd();
}

/** Full user-bubble scrub for persisted transcript text. */
export function stripUserMessageForDisplay(text: string): string {
  let out = stripRuntimeContextForDisplay(text);
  out = stripExpandedAtFileBlocks(out);
  out = stripMediaClaimCheck(out);
  out = stripImageUnderstandingContext(out);
  return collapseExpandedSkillBlockForDisplay(out);
}
