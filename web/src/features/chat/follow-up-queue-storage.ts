import type { FollowUpSuggestionId } from '@/features/chat/follow-up-suggestions';
import type { PendingFollowUp, PendingFollowUpAttachment } from '@/features/chat/pending-follow-up.types';

const STORAGE_PREFIX = 'xopc.chat.followUpQueue:v1:';

const KNOWN_SUGGESTION_IDS = new Set<string>([
  'code_error_handling',
  'code_refactor',
  'code_explain',
  'code_optimize',
  'web_more_details',
  'web_find_sources',
  'date_shorter_summary',
  'date_main_risks',
  'email_make_formal',
  'email_shorten',
  'generic_simpler_terms',
  'generic_concrete_example',
  'generic_bullet_points',
  'generic_create_table',
  'what_next',
]);

function coerceStoredSuggestionIds(raw: unknown): FollowUpSuggestionId[] {
  if (!Array.isArray(raw)) return [];
  const out: FollowUpSuggestionId[] = [];
  for (const x of raw) {
    if (typeof x === 'string' && KNOWN_SUGGESTION_IDS.has(x)) {
      out.push(x as FollowUpSuggestionId);
    }
  }
  return out;
}

export type FollowUpQueueSnapshot = {
  pending: PendingFollowUp[];
  suggestions: FollowUpSuggestionId[];
  editingId: string | null;
};

function storageKey(sessionKey: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(sessionKey.trim())}`;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function parseAttachment(x: unknown): PendingFollowUpAttachment | null {
  if (!isRecord(x)) return null;
  const type = x.type;
  if (typeof type !== 'string' || !type.trim()) return null;
  const out: PendingFollowUpAttachment = { type: type.trim() };
  if (typeof x.mimeType === 'string') out.mimeType = x.mimeType;
  if (typeof x.name === 'string') out.name = x.name;
  if (typeof x.size === 'number' && Number.isFinite(x.size)) out.size = x.size;
  if (typeof x.workspaceRelativePath === 'string') out.workspaceRelativePath = x.workspaceRelativePath;
  if (typeof x.durationSeconds === 'number' && Number.isFinite(x.durationSeconds)) {
    out.durationSeconds = x.durationSeconds;
  }
  return out;
}

function parsePendingFollowUps(raw: unknown): PendingFollowUp[] {
  if (!Array.isArray(raw)) return [];
  const out: PendingFollowUp[] = [];
  for (const row of raw) {
    if (!isRecord(row)) continue;
    const id = row.id;
    const text = row.text;
    if (typeof id !== 'string' || !id.trim()) continue;
    if (typeof text !== 'string') continue;
    const item: PendingFollowUp = { id: id.trim(), text };
    if (typeof row.thinkingLevel === 'string' && row.thinkingLevel.trim()) {
      item.thinkingLevel = row.thinkingLevel.trim();
    }
    if (Array.isArray(row.attachments)) {
      const atts = row.attachments.map(parseAttachment).filter(Boolean) as PendingFollowUpAttachment[];
      if (atts.length) item.attachments = atts;
    }
    out.push(item);
    if (out.length >= 50) break;
  }
  return out;
}

/**
 * Shape safe for localStorage: never persist inline `data` (base64).
 * Rows may still carry `workspaceRelativePath` / metadata so session-backed files survive refresh.
 */
export function sanitizeFollowUpQueueSnapshot(snap: FollowUpQueueSnapshot): FollowUpQueueSnapshot {
  return {
    editingId: snap.editingId,
    suggestions: [...snap.suggestions],
    pending: snap.pending.map((row) => ({
      ...row,
      attachments: row.attachments?.map((a) => {
        const { data: _d, ...rest } = a;
        return rest;
      }),
    })),
  };
}

export function readFollowUpQueueSnapshot(sessionKey: string): FollowUpQueueSnapshot | null {
  const sk = sessionKey?.trim();
  if (!sk || typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(storageKey(sk));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;
    const pending = parsePendingFollowUps(parsed.pending);
    const suggestions = coerceStoredSuggestionIds(parsed.suggestions);
    const editingId =
      parsed.editingId === null
        ? null
        : typeof parsed.editingId === 'string' && parsed.editingId.trim()
          ? parsed.editingId.trim()
          : null;
    if (pending.length === 0 && suggestions.length === 0 && editingId == null) return null;
    return { pending, suggestions, editingId };
  } catch {
    return null;
  }
}

export function writeFollowUpQueueSnapshot(sessionKey: string, snap: FollowUpQueueSnapshot): void {
  const sk = sessionKey?.trim();
  if (!sk || typeof localStorage === 'undefined') return;
  const sanitized = sanitizeFollowUpQueueSnapshot(snap);
  if (
    sanitized.pending.length === 0 &&
    sanitized.suggestions.length === 0 &&
    sanitized.editingId == null
  ) {
    clearFollowUpQueueSnapshot(sk);
    return;
  }
  try {
    localStorage.setItem(storageKey(sk), JSON.stringify({ v: 1, ...sanitized }));
  } catch {
    /* ignore quota (e.g. very long plain-text follow-ups) */
  }
}

export function clearFollowUpQueueSnapshot(sessionKey: string): void {
  const sk = sessionKey?.trim();
  if (!sk || typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(storageKey(sk));
  } catch {
    /* ignore */
  }
}
