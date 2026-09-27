import type { ComposerAttachment } from './composer.types';
import { MAX_CHAT_ATTACHMENTS } from './chat-limits';
import { storage } from '../../storage/mmkv';
import { collectUnusedChatAttachments, persistComposerAttachments } from './durable-attachments';
import { isVolatileMessageOutbox } from './message-outbox';

const STORAGE_PREFIX = 'xopc.chat.composerDraft:v4:';
const volatileDrafts = new Map<string, ComposerDraftSnapshot>();
const MAX_DRAFT_LENGTH = 20_000;

export type ComposerDraftSnapshot = {
  attachments?: ComposerAttachment[];
  text: string;
  cursorPos: number;
  contextRefs: Array<{ kind: 'note' | 'task'; sourceId: string; expectedVersion: string; title: string }>;
};

function storageKey(conversationId: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(conversationId.trim())}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeCursorPos(cursorPos: unknown, textLength: number): number {
  if (typeof cursorPos !== 'number' || !Number.isFinite(cursorPos)) {
    return textLength;
  }
  return Math.min(Math.max(Math.trunc(cursorPos), 0), textLength);
}

export function readComposerDraftSnapshot(conversationId: string): ComposerDraftSnapshot | null {
  const normalizedConversationId = conversationId.trim();
  if (!normalizedConversationId) return null;
  if (isVolatileMessageOutbox(normalizedConversationId)) return volatileDrafts.get(normalizedConversationId) ?? null;

  try {
    collectUnusedChatAttachments();
    const raw = storage.getString(storageKey(normalizedConversationId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || typeof parsed.text !== 'string') return null;

    const text = parsed.text.slice(0, MAX_DRAFT_LENGTH);
    const contextRefs = Array.isArray(parsed.contextRefs)
      ? parsed.contextRefs.flatMap((value): ComposerDraftSnapshot['contextRefs'] => {
          if (!isRecord(value) || (value.kind !== 'note' && value.kind !== 'task') || typeof value.sourceId !== 'string'
            || typeof value.expectedVersion !== 'string' || typeof value.title !== 'string') return [];
          return [{ kind: value.kind, sourceId: value.sourceId, expectedVersion: value.expectedVersion, title: value.title }];
        }).slice(0, 5)
      : [];
    const attachments: ComposerAttachment[] = Array.isArray(parsed.attachments)
      ? parsed.attachments.flatMap((file): ComposerAttachment[] => {
        if (!isRecord(file) || typeof file.id !== 'string' || typeof file.name !== 'string'
          || !['image', 'document', 'audio'].includes(String(file.type)) || typeof file.content !== 'string'
          || typeof file.mimeType !== 'string' || typeof file.size !== 'number' || !Number.isFinite(file.size) || file.size < 0) return [];
        return [file as ComposerAttachment];
      }).slice(0, MAX_CHAT_ATTACHMENTS) : [];
    if (!text.trim() && contextRefs.length === 0 && attachments.length === 0) return null;
    return {
      text,
      cursorPos: normalizeCursorPos(parsed.cursorPos, text.length),
      contextRefs,
      ...(attachments.length ? { attachments } : {}),
    };
  } catch {
    return null;
  }
}

export function writeComposerDraftSnapshot(
  conversationId: string,
  snapshot: Omit<ComposerDraftSnapshot, 'contextRefs'> & { contextRefs?: ComposerDraftSnapshot['contextRefs'] },
): void {
  const normalizedConversationId = conversationId.trim();
  if (!normalizedConversationId) return;

  const text = snapshot.text.slice(0, MAX_DRAFT_LENGTH);
  if (!text.trim() && !snapshot.contextRefs?.length && !snapshot.attachments?.length) {
    clearComposerDraftSnapshot(normalizedConversationId);
    return;
  }

  const payload: ComposerDraftSnapshot = {
    text,
    cursorPos: normalizeCursorPos(snapshot.cursorPos, text.length),
    contextRefs: snapshot.contextRefs?.slice(0, 5) ?? [],
    ...(snapshot.attachments?.length ? { attachments: snapshot.attachments.slice(0, MAX_CHAT_ATTACHMENTS) } : {}),
  };

  if (isVolatileMessageOutbox(normalizedConversationId)) { volatileDrafts.set(normalizedConversationId, payload); return; }

  if (payload.attachments) payload.attachments = persistComposerAttachments(payload.attachments);
  storage.set(storageKey(normalizedConversationId), JSON.stringify(payload));
  collectUnusedChatAttachments();
}

export function clearComposerDraftSnapshot(conversationId: string): void {
  const normalizedConversationId = conversationId.trim();
  if (!normalizedConversationId) return;
  volatileDrafts.delete(normalizedConversationId);

  try {
    storage.delete(storageKey(normalizedConversationId));
    collectUnusedChatAttachments();
  } catch {
    /* ignore */
  }
}
