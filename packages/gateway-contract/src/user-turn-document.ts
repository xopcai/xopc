export const USER_TURN_DOCUMENT_VERSION = 1 as const;

const CONTEXT_REF_TOKEN_PREFIX = '@xopc-ref:';
const CONTEXT_REF_ID_PATTERN = '[A-Za-z0-9_-]{1,64}';
const CONTEXT_REF_TOKEN_RE = new RegExp(`${CONTEXT_REF_TOKEN_PREFIX}(${CONTEXT_REF_ID_PATTERN})`, 'g');

export type UserTurnDocumentPart =
  | { type: 'text'; text: string }
  | { type: 'context_ref'; refId: string };

export interface UserTurnDocument {
  version: typeof USER_TURN_DOCUMENT_VERSION;
  parts: UserTurnDocumentPart[];
}

export function contextRefWireToken(refId: string): string {
  if (!new RegExp(`^${CONTEXT_REF_ID_PATTERN}$`).test(refId)) {
    throw new Error('Invalid context reference id');
  }
  return `${CONTEXT_REF_TOKEN_PREFIX}${refId}`;
}

export function contextRefWireTokenRe(): RegExp {
  return new RegExp(CONTEXT_REF_TOKEN_RE.source, 'g');
}

export function parseUserTurnDocument(wire: string): UserTurnDocument | null {
  const parts: UserTurnDocumentPart[] = [];
  const re = contextRefWireTokenRe();
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(wire)) !== null) {
    if (match.index > last) parts.push({ type: 'text', text: wire.slice(last, match.index) });
    parts.push({ type: 'context_ref', refId: match[1] ?? '' });
    last = match.index + match[0].length;
  }
  if (parts.length === 0) return null;
  if (last < wire.length) parts.push({ type: 'text', text: wire.slice(last) });
  return { version: USER_TURN_DOCUMENT_VERSION, parts };
}

export function userTurnDocumentRefIds(document: UserTurnDocument): string[] {
  return document.parts.flatMap((part) => part.type === 'context_ref' ? [part.refId] : []);
}

export function renderUserTurnDocument(
  document: UserTurnDocument,
  resolveLabel: (refId: string) => string | null | undefined,
): string {
  return document.parts.map((part) => {
    if (part.type === 'text') return part.text;
    const title = resolveLabel(part.refId)?.trim();
    return title ? `@${title}` : '';
  }).join('');
}

export function serializeUserTurnDocument(document: UserTurnDocument): string {
  return document.parts.map((part) => part.type === 'text'
    ? part.text
    : contextRefWireToken(part.refId)).join('');
}

export function isUserTurnDocument(value: unknown): value is UserTurnDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (row.version !== USER_TURN_DOCUMENT_VERSION || !Array.isArray(row.parts)) return false;
  return row.parts.every((part) => {
    if (!part || typeof part !== 'object' || Array.isArray(part)) return false;
    const candidate = part as Record<string, unknown>;
    return candidate.type === 'text'
      ? typeof candidate.text === 'string'
      : candidate.type === 'context_ref'
        && typeof candidate.refId === 'string'
        && new RegExp(`^${CONTEXT_REF_ID_PATTERN}$`).test(candidate.refId);
  });
}
