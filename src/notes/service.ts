import { randomUUID } from 'node:crypto';

import { createLogger } from '../utils/logger.js';
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
  NotesListQuery,
} from './types.js';

const log = createLogger('NotesService');

function inferKind(text?: string, hasAttachments?: boolean): NoteKind {
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

function createBlockId(): string {
  return `block_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

function noteTextToBlocks(text?: string): NoteBlock[] | undefined {
  if (!text?.trim()) return undefined;
  const now = Date.now();
  return text.split(/\n{2,}/).map((part) => ({
    id: createBlockId(),
    type: 'paragraph' as const,
    text: part.trim(),
    createdAt: now,
    updatedAt: now,
  }));
}

function blocksToPlainText(blocks?: NoteBlock[]): string | undefined {
  if (!blocks?.length) return undefined;
  return blocks
    .map((block) => {
      if (block.type === 'divider') return '---';
      if (block.type === 'todo') return `${block.checked ? '[x]' : '[ ]'} ${block.text}`;
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

export class NotesService {
  private store: NotesStore;

  constructor(store: NotesStore) {
    this.store = store;
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
    log.debug('NotesService initialized');
  }

  async quickCapture(text: string, source: CaptureSource): Promise<Note> {
    const now = Date.now();
    const blocks = noteTextToBlocks(text);
    const note: Note = {
      id: randomUUID(),
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
    const blocks = params.blocks ?? noteTextToBlocks(params.text);
    const text = params.text ?? blocksToPlainText(blocks);
    const note: Note = {
      id: randomUUID(),
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

  async updateNote(id: string, patch: Partial<Note>): Promise<Note | null> {
    const existing = await this.store.getNote(id);
    if (!existing) return null;

    const normalizedPatch: Partial<Note> = { ...patch };
    if (patch.blocks) {
      normalizedPatch.text = patch.text ?? blocksToPlainText(patch.blocks);
    } else if (typeof patch.text === 'string') {
      normalizedPatch.blocks = patch.blocks ?? noteTextToBlocks(patch.text);
    }
    normalizedPatch.remoteVersion = (existing.remoteVersion ?? 0) + 1;
    return this.store.updateNote(id, normalizedPatch);
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

    const updated = await this.updateNote(id, patch);
    return { note: updated, conflict: false };
  }

  async createAiEditPatch(
    id: string,
    instruction: string,
    blocks?: NoteBlock[],
  ): Promise<{ message: string; patch: NoteAiPatch } | null> {
    const note = await this.store.getNote(id);
    if (!note) return null;

    const sourceBlocks = blocks?.length ? blocks : note.blocks ?? noteTextToBlocks(note.text) ?? [];
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
    return this.store.deleteNote(id);
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
    const kind: NoteKind = note.kind === 'thought' ? 'media' : note.kind;
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

  async flush(): Promise<void> {
    await this.store.flush();
  }
}

function inferAttachmentType(mimeType: string): NoteAttachment['type'] {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'file';
}
