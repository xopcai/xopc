const ENVELOPE_TIMESTAMP_PREFIX_RE = /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}[^\]]*\]\s*/u;
const USER_CONTEXT_TAGS = [
  'user-profile',
  'active-focuses',
  'collaboration-contract',
  'user-context',
] as const;

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
    || USER_CONTEXT_TAGS.some((tag) => text.startsWith(`<${tag}>`));
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
    const tag = USER_CONTEXT_TAGS.find((candidate) => remaining.startsWith(`<${candidate}>`));
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
