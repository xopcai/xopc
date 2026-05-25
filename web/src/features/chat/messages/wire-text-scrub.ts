// Text scrubbing applied to persisted user-message content so the UI re-renders
// the original wire form (rather than the server-expanded skill/file bodies).

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
