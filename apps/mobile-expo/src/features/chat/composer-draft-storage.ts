import type { ComposerAttachment } from './composer.types';
import { MAX_CHAT_ATTACHMENTS } from './chat-limits';
import { storage } from '../../storage/mmkv';

const STORAGE_PREFIX = 'xopc.chat.composerDraft:v3:';
const MAX_DRAFT_LENGTH = 20_000;

export type ComposerDraftSnapshot = {
  workspaceFiles?: ComposerAttachment[];
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

  try {
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
    const workspaceFiles: ComposerAttachment[] = Array.isArray(parsed.workspaceFiles)
      ? parsed.workspaceFiles.flatMap((file): ComposerAttachment[] => {
        if (!isRecord(file) || typeof file.id !== 'string' || typeof file.name !== 'string'
          || typeof file.workspaceRelativePath !== 'string' || !file.workspaceRelativePath
          || typeof file.mimeType !== 'string' || typeof file.size !== 'number' || !Number.isFinite(file.size) || file.size < 0) return [];
        return [{ id: file.id, name: file.name, workspaceRelativePath: file.workspaceRelativePath,
          mimeType: file.mimeType, size: file.size, type: 'document', content: '' }];
      }).slice(0, MAX_CHAT_ATTACHMENTS) : [];
    if (!text.trim() && contextRefs.length === 0 && workspaceFiles.length === 0) return null;
    return {
      text,
      cursorPos: normalizeCursorPos(parsed.cursorPos, text.length),
      contextRefs,
      ...(workspaceFiles.length ? { workspaceFiles } : {}),
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
  if (!text.trim() && !snapshot.contextRefs?.length && !snapshot.workspaceFiles?.length) {
    clearComposerDraftSnapshot(normalizedConversationId);
    return;
  }

  const payload: ComposerDraftSnapshot = {
    text,
    cursorPos: normalizeCursorPos(snapshot.cursorPos, text.length),
    contextRefs: snapshot.contextRefs?.slice(0, 5) ?? [],
    ...(snapshot.workspaceFiles?.length ? { workspaceFiles: snapshot.workspaceFiles.slice(0, MAX_CHAT_ATTACHMENTS) } : {}),
  };

  try {
    storage.set(storageKey(normalizedConversationId), JSON.stringify({ v: 2, ...payload }));
  } catch {
    /* ignore quota */
  }
}

export function clearComposerDraftSnapshot(conversationId: string): void {
  const normalizedConversationId = conversationId.trim();
  if (!normalizedConversationId) return;

  try {
    storage.delete(storageKey(normalizedConversationId));
  } catch {
    /* ignore */
  }
}
