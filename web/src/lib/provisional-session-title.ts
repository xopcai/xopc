import { extractUserMessagePlainText } from '@/features/chat/messages/user-message-plain-text';

const MAX_TITLE_LEN = 80;

export function sanitizeSessionTitle(raw: string): string {
  let s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  const lineBreak = s.indexOf('\n');
  if (lineBreak !== -1) s = s.slice(0, lineBreak).trim();
  if (s.length > MAX_TITLE_LEN) s = s.slice(0, MAX_TITLE_LEN - 1).trimEnd() + '…';
  return s;
}

function stripExpandedSkillBlockForTitle(text: string): string {
  const trimmed = text.trimStart();
  if (!/^##\s+Skill:\s*\S+/i.test(trimmed)) {
    return text;
  }

  const markerRe = /(?:^|\r?\n)\*\*Arguments\*\*:\s*/gi;
  let argsStart = -1;
  while (markerRe.exec(trimmed) !== null) {
    argsStart = markerRe.lastIndex;
  }

  if (argsStart !== -1) {
    const args = trimmed.slice(argsStart).trim();
    if (args) return args;
  }

  const firstLine = trimmed.split(/\r?\n/)[0]?.trim() ?? '';
  return firstLine.replace(/^##\s+Skill:\s*/i, '').trim();
}

function stripSkillCommandForTitle(text: string): string {
  const trimmed = text.trimStart();
  const match = trimmed.match(/^\/skill:([^\s]+)(?:\s+([\s\S]*))?$/i);
  if (!match) {
    return text;
  }
  const args = match[2]?.trim();
  return args || match[1]?.trim() || text;
}

/** Client-side provisional title from composer text (matches server `provisionalTitleFromUserText`). */
export function provisionalTitleFromUserText(raw: string): string | null {
  const text = stripSkillCommandForTitle(
    stripExpandedSkillBlockForTitle(extractUserMessagePlainText([{ type: 'text', text: raw }])),
  );
  const line = text.split(/\n/)[0]?.trim();
  if (!line) return null;
  const cleaned = sanitizeSessionTitle(line);
  return cleaned.length > 0 ? cleaned : null;
}

export function dispatchSessionTitleUpdated(sessionKey: string, name: string): void {
  const key = sessionKey.trim();
  const title = name.trim();
  if (!key || !title) return;
  window.dispatchEvent(
    new CustomEvent('session-updated', { detail: { key, name: title }, bubbles: true }),
  );
}

/** Notify sidebar to show / bump a session row (e.g. after new chat handoff). */
export function dispatchSidebarSessionFocus(sessionKey: string): void {
  const key = sessionKey.trim();
  if (!key) return;
  window.dispatchEvent(new CustomEvent('session-updated', { detail: { key }, bubbles: true }));
}
