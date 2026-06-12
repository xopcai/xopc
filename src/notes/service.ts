import { randomUUID } from 'node:crypto';

import { createLogger } from '../utils/logger.js';
import { buildNoteAttachmentRef, attachmentIdFromTarget } from './attachment-ref.js';
import { partitionAttachmentsByReference } from './note-attachment-sync.js';
import { NotesStore } from './store.js';
import type {
  CaptureSource,
  CreateNoteParams,
  Note,
  NoteAiPatch,
  NoteAttachment,
  NoteBlock,
  NoteIndexEntry,
  NoteKind,
  NoteSnapshot,
  NoteSnapshotEntry,
  NotesListQuery,
  SnapshotTrigger,
} from './types.js';

const log = createLogger('NotesService');

function inferKind(
  text?: string,
  hasAttachments?: boolean,
  attachments?: NoteAttachment[],
): NoteKind {
  if (hasAttachments && attachments?.length && attachments.every((item) => item.type === 'audio')) {
    return 'voice';
  }
  if (hasAttachments) return 'media';
  if (!text) return 'thought';
  const lower = text.toLowerCase();
  if (/^(todo|task|remind|buy|call|email|meet|finish|submit|send)\b/i.test(lower) ||
      /\b(明天|今天|记得|别忘|待办|提醒)\b/.test(text)) {
    return 'todo';
  }
  if (/^https?:\/\//.test(text.trim())) return 'bookmark';
  return 'thought';
}

function deriveDefaultTitle(text?: string): string | undefined {
  const normalizedText = text?.trim().replace(/\s+/g, ' ');
  if (!normalizedText) return undefined;
  return Array.from(normalizedText).slice(0, 10).join('');
}

function createBlockId(): string {
  return `block_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

const IMAGE_MARKDOWN = /^!\[([^\]]*)\]\(([^)]+)\)$/;

function noteTextToBlocks(text?: string, noteId?: string): NoteBlock[] | undefined {
  if (!text?.trim()) return undefined;
  const now = Date.now();
  return text.split(/\n{2,}/).map((part) => {
    const trimmed = part.trim();
    if (noteId) {
      const imageMatch = trimmed.match(IMAGE_MARKDOWN);
      if (imageMatch) {
        const attachmentId = attachmentIdFromTarget(imageMatch[2], noteId);
        if (attachmentId) {
          return {
            id: createBlockId(),
            type: 'image' as const,
            attachmentId,
            alt: imageMatch[1] || undefined,
            createdAt: now,
            updatedAt: now,
          };
        }
      }
    }
    return {
      id: createBlockId(),
      type: 'paragraph' as const,
      text: trimmed,
      createdAt: now,
      updatedAt: now,
    };
  });
}

function blocksToPlainText(blocks?: NoteBlock[], noteId?: string): string | undefined {
  if (!blocks?.length) return undefined;
  return blocks
    .map((block) => {
      if (block.type === 'divider') return '---';
      if (block.type === 'todo') return `${block.checked ? '[x]' : '[ ]'} ${block.text}`;
      if (block.type === 'image') {
        if (noteId) {
          return `![${block.alt ?? ''}](${buildNoteAttachmentRef(noteId, block.attachmentId)})`;
        }
        return block.alt ?? '';
      }
      return block.text;
    })
    .filter((text) => text.trim().length > 0)
    .join('\n\n');
}

function createAiOrganizedBlocks(blocks: NoteBlock[], instruction: string): NoteBlock[] {
  const now = Date.now();
  const plainText = blocksToPlainText(blocks) || '';
  const lines = plainText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const wantsTodos = /待办|todo|task|行动|提醒/i.test(instruction);
  const wantsSummary = /摘要|总结|summary|压缩/i.test(instruction);

  if (wantsTodos) {
    const candidates = lines.filter((line) => /要|需|记得|todo|task|完成|提交|联系|跟进|提醒/i.test(line));
    return (candidates.length ? candidates : lines).slice(0, 12).map((line) => ({
      id: createBlockId(),
      type: 'todo' as const,
      text: line.replace(/^[-*\d.\s\[\]x]+/i, '').trim(),
      checked: false,
      createdAt: now,
      updatedAt: now,
    }));
  }

  if (wantsSummary) {
    const summary = lines.join(' ').slice(0, 220);
    return [{
      id: createBlockId(),
      type: 'paragraph',
      text: summary,
      createdAt: now,
      updatedAt: now,
    }];
  }

  const titleText = lines[0]?.slice(0, 40) || '整理后的笔记';
  const bodyLines = lines.slice(1).length ? lines.slice(1) : lines;
  return [
    {
      id: createBlockId(),
      type: 'heading',
      text: titleText,
      level: 2,
      createdAt: now,
      updatedAt: now,
    },
    ...bodyLines.map((line) => ({
      id: createBlockId(),
      type: 'bulletList' as const,
      text: line.replace(/^[-*\d.\s]+/, '').trim(),
      indent: 0,
      createdAt: now,
      updatedAt: now,
    })),
  ];
}

const SNAPSHOT_THROTTLE_MS = 60_000;
const MAX_SNAPSHOTS_PER_NOTE = 30;

export class NotesService {
  private store: NotesStore;
  private lastSnapshotAt = new Map<string, number>();

  constructor(store: NotesStore) {
    this.store = store;
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
    log.debug('NotesService initialized');
  }

  async quickCapture(text: string, source: CaptureSource): Promise<Note> {
    const now = Date.now();
    const id = randomUUID();
    const blocks = noteTextToBlocks(text, id);
    const note: Note = {
      id,
      title: deriveDefaultTitle(text),
      kind: inferKind(text),
      status: 'inbox',
      text,
      blocks,
      createdAt: now,
      updatedAt: now,
      capturedVia: source,
      localVersion: 0,
      remoteVersion: 1,
    };
    await this.store.addNote(note);
    log.debug({ id: note.id, kind: note.kind }, 'Quick capture');
    return note;
  }

  async createNote(params: CreateNoteParams): Promise<Note> {
    const now = Date.now();
    const id = randomUUID();
    const blocks = params.blocks ?? noteTextToBlocks(params.text, id);
    const text = params.text ?? blocksToPlainText(blocks, id);
    const note: Note = {
      id,
      title: params.title,
      kind: params.kind || inferKind(text),
      status: 'inbox',
      text,
      blocks,
      createdAt: now,
      updatedAt: now,
      capturedVia: params.capturedVia,
      tags: params.tags,
      pinned: params.pinned,
      localVersion: 0,
      remoteVersion: 1,
    };
    await this.store.addNote(note);
    log.debug({ id: note.id, kind: note.kind }, 'Note created');
    return note;
  }

  async getNote(id: string): Promise<Note | null> {
    return this.store.getNote(id);
  }

  async updateNote(id: string, patch: Partial<Note>, trigger: SnapshotTrigger = 'edit'): Promise<Note | null> {
    const existing = await this.store.getNote(id);
    if (!existing) return null;

    const contentTouched = patch.text !== undefined || patch.blocks !== undefined || patch.title !== undefined;
    if (contentTouched) {
      await this.maybeSaveSnapshot(existing, trigger);
    }

    const normalizedPatch: Partial<Note> = { ...patch };
    if (patch.blocks) {
      normalizedPatch.text = patch.text ?? blocksToPlainText(patch.blocks, existing.id);
    } else if (typeof patch.text === 'string') {
      normalizedPatch.blocks = patch.blocks ?? noteTextToBlocks(patch.text, existing.id);
    }
    normalizedPatch.remoteVersion = (existing.remoteVersion ?? 0) + 1;

    if (contentTouched) {
      const merged: Note = {
        ...existing,
        ...normalizedPatch,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: Date.now(),
      };
      const reconciled = await this.reconcileAttachments(merged);
      normalizedPatch.attachments = reconciled.attachments;
      normalizedPatch.kind = reconciled.kind;
    }

    return this.store.updateNote(id, normalizedPatch);
  }

  private async reconcileAttachments(note: Note): Promise<Note> {
    const { kept, removed } = partitionAttachmentsByReference(note);
    if (removed.length === 0) return note;

    for (const attachment of removed) {
      await this.store.deleteAttachmentFile(note.id, attachment.relativePath);
    }

    log.debug(
      { noteId: note.id, removedIds: removed.map((attachment) => attachment.id) },
      'Pruned orphan note attachments',
    );

    const hasAttachments = kept.length > 0;
    return {
      ...note,
      attachments: hasAttachments ? kept : undefined,
      kind: inferKind(note.text, hasAttachments, kept),
    };
  }

  async syncNote(
    id: string,
    patch: Partial<Note>,
    baseRemoteVersion?: number,
  ): Promise<{ note: Note | null; conflict: boolean }> {
    const existing = await this.store.getNote(id);
    if (!existing) return { note: null, conflict: false };

    const currentRemoteVersion = existing.remoteVersion ?? 0;
    if (baseRemoteVersion !== undefined && baseRemoteVersion < currentRemoteVersion) {
      return { note: existing, conflict: true };
    }

    const updated = await this.updateNote(id, patch, 'sync');
    return { note: updated, conflict: false };
  }

  async createAiEditPatch(
    id: string,
    instruction: string,
    blocks?: NoteBlock[],
  ): Promise<{ message: string; patch: NoteAiPatch } | null> {
    const note = await this.store.getNote(id);
    if (!note) return null;

    const sourceBlocks = blocks?.length ? blocks : note.blocks ?? noteTextToBlocks(note.text, note.id) ?? [];
    const organizedBlocks = createAiOrganizedBlocks(sourceBlocks, instruction);
    const patch: NoteAiPatch = {
      id: randomUUID(),
      summary: `已根据「${instruction.slice(0, 40)}」生成可预览的块级整理建议`,
      operations: [{ type: 'replaceBlocks', blocks: organizedBlocks }],
    };

    return {
      message: 'AI edit patch generated',
      patch,
    };
  }

  async deleteNote(id: string): Promise<boolean> {
    const deleted = await this.store.deleteNote(id);
    if (deleted) {
      await this.store.deleteAllSnapshots(id);
      this.lastSnapshotAt.delete(id);
    }
    return deleted;
  }

  async listNotes(query: NotesListQuery = {}): Promise<{ items: NoteIndexEntry[]; total: number }> {
    return this.store.listNotes(query);
  }

  async addAttachment(
    noteId: string,
    file: { name: string; buffer: Buffer; mimeType: string; duration?: number },
  ): Promise<NoteAttachment | null> {
    const note = await this.store.getNote(noteId);
    if (!note) return null;

    const { relativePath, size } = await this.store.saveAttachment(noteId, file.name, file.buffer);

    const attachment: NoteAttachment = {
      id: randomUUID(),
      type: inferAttachmentType(file.mimeType),
      mimeType: file.mimeType,
      fileName: file.name,
      size,
      relativePath,
      duration: file.duration,
    };

    const attachments = [...(note.attachments || []), attachment];
    const kind: NoteKind =
      note.kind === 'thought' && attachment.type === 'audio'
        ? 'voice'
        : note.kind === 'thought'
          ? 'media'
          : note.kind;
    await this.store.updateNote(noteId, { attachments, kind });

    return attachment;
  }

  async getAttachmentPath(
    noteId: string,
    attachmentId: string,
  ): Promise<{ filePath: string; mimeType: string; fileName: string } | null> {
    const note = await this.store.getNote(noteId);
    if (!note) return null;

    const attachment = note.attachments?.find((a) => a.id === attachmentId);
    if (!attachment) return null;

    const fullPath = this.store.resolveAttachmentPath(noteId, attachment.relativePath);
    return { filePath: fullPath, mimeType: attachment.mimeType, fileName: attachment.fileName };
  }

  async listNoteHistory(noteId: string): Promise<NoteSnapshotEntry[]> {
    return this.store.listSnapshots(noteId);
  }

  async getNoteSnapshot(noteId: string, timestamp: number): Promise<NoteSnapshot | null> {
    return this.store.getSnapshot(noteId, timestamp);
  }

  async restoreNoteSnapshot(noteId: string, timestamp: number): Promise<Note | null> {
    const snapshot = await this.store.getSnapshot(noteId, timestamp);
    if (!snapshot) return null;
    const existing = await this.store.getNote(noteId);
    if (!existing) return null;

    await this.store.saveSnapshot(existing, 'restore');
    this.lastSnapshotAt.set(noteId, Date.now());
    await this.store.pruneSnapshots(noteId, MAX_SNAPSHOTS_PER_NOTE);

    return this.store.updateNote(noteId, {
      title: snapshot.title,
      text: snapshot.text,
      blocks: snapshot.blocks,
      tags: snapshot.tags,
    });
  }

  async flush(): Promise<void> {
    await this.store.flush();
  }

  // ── Space grouping ──────────────────────────────────────────────────

  async moveToGroup(noteId: string, groupId: string | null): Promise<Note | null> {
    return this.updateNote(noteId, { groupId: groupId ?? undefined });
  }

  // ── Task lifecycle ──────────────────────────────────────────────────

  async createTask(
    title: string,
    source: CaptureSource,
    options?: { dueAt?: number; priority?: 'high' | 'medium' | 'low'; sourceSessionKey?: string; sourceNoteId?: string; groupId?: string },
  ): Promise<Note> {
    return this.createNote({
      title,
      kind: 'task',
      capturedVia: source,
      groupId: options?.groupId,
      taskMeta: {
        done: false,
        dueAt: options?.dueAt,
        priority: options?.priority,
        sourceSessionKey: options?.sourceSessionKey,
        sourceNoteId: options?.sourceNoteId,
      },
    });
  }

  async toggleTaskDone(noteId: string): Promise<Note | null> {
    const note = await this.store.getNote(noteId);
    if (!note || note.kind !== 'task') return null;
    const done = !note.taskMeta?.done;
    return this.updateNote(noteId, {
      taskMeta: { ...note.taskMeta, done },
      status: done ? 'archived' : 'processed',
    });
  }

  async updateTaskMeta(noteId: string, patch: Partial<import('./types.js').NoteTaskMeta>): Promise<Note | null> {
    const note = await this.store.getNote(noteId);
    if (!note || note.kind !== 'task') return null;
    return this.updateNote(noteId, {
      taskMeta: { ...note.taskMeta, done: note.taskMeta?.done ?? false, ...patch },
    });
  }

  // ── Open tracking ──────────────────────────────────────────────────

  async recordOpen(noteId: string): Promise<Note | null> {
    return this.updateNote(noteId, { lastOpenedAt: Date.now() } as Partial<Note>);
  }

  private async maybeSaveSnapshot(note: Note, trigger: SnapshotTrigger): Promise<void> {
    if (trigger !== 'edit') {
      await this.store.saveSnapshot(note, trigger);
      this.lastSnapshotAt.set(note.id, Date.now());
      await this.store.pruneSnapshots(note.id, MAX_SNAPSHOTS_PER_NOTE);
      return;
    }
    const last = this.lastSnapshotAt.get(note.id) ?? 0;
    if (Date.now() - last < SNAPSHOT_THROTTLE_MS) return;
    await this.store.saveSnapshot(note, trigger);
    this.lastSnapshotAt.set(note.id, Date.now());
    await this.store.pruneSnapshots(note.id, MAX_SNAPSHOTS_PER_NOTE);
  }
}

function inferAttachmentType(mimeType: string): NoteAttachment['type'] {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'file';
}
