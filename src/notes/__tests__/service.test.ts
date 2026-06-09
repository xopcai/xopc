import { beforeEach, describe, expect, it } from 'vitest';

import { NotesService } from '../service.js';
import type { Note, NoteBlock } from '../types.js';

class MemoryNotesStore {
  private notes = new Map<string, Note>();

  async initialize(): Promise<void> {}

  async addNote(note: Note): Promise<void> {
    this.notes.set(note.id, note);
  }

  async getNote(id: string): Promise<Note | null> {
    return this.notes.get(id) ?? null;
  }

  async updateNote(id: string, patch: Partial<Note>): Promise<Note | null> {
    const existing = this.notes.get(id);
    if (!existing) return null;
    const updated: Note = {
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    };
    this.notes.set(id, updated);
    return updated;
  }

  async deleteNote(id: string): Promise<boolean> {
    if (!this.notes.has(id)) return false;
    this.notes.delete(id);
    return true;
  }

  async listNotes(): Promise<{ items: []; total: number }> {
    return { items: [], total: this.notes.size };
  }

  async saveAttachment(): Promise<{ relativePath: string; size: number }> {
    return { relativePath: 'mock', size: 0 };
  }

  resolveAttachmentPath(): string {
    return 'mock';
  }

  async flush(): Promise<void> {}
}

function paragraph(id: string, text: string): NoteBlock {
  return {
    id,
    type: 'paragraph',
    text,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('NotesService block sync and AI edit', () => {
  let store: MemoryNotesStore;
  let service: NotesService;

  beforeEach(() => {
    store = new MemoryNotesStore();
    service = new NotesService(store as never);
  });

  it('creates notes from blocks and derives plain text', async () => {
    const note = await service.createNote({
      blocks: [paragraph('a', '第一段'), paragraph('b', '第二段')],
      capturedVia: { channel: 'web' },
    });

    expect(note.blocks).toHaveLength(2);
    expect(note.text).toBe('第一段\n\n第二段');
    expect(note.remoteVersion).toBe(1);
  });

  it('syncs blocks when base remote version is current', async () => {
    const note = await service.createNote({
      text: '原文',
      capturedVia: { channel: 'web' },
    });

    const result = await service.syncNote(
      note.id,
      {
        blocks: [paragraph('new', '新版块')],
        localVersion: 3,
      },
      1,
    );

    expect(result.conflict).toBe(false);
    expect(result.note).toMatchObject({ text: '新版块', localVersion: 3, remoteVersion: 2 });
  });

  it('returns a conflict when base remote version is stale', async () => {
    const note = await service.createNote({
      text: '原文',
      capturedVia: { channel: 'web' },
    });
    await service.updateNote(note.id, { text: '远端已更新' });

    const result = await service.syncNote(note.id, { text: '本地旧编辑' }, 1);

    expect(result.conflict).toBe(true);
    expect(result.note).toMatchObject({ text: '远端已更新', remoteVersion: 2 });
  });

  it('generates todo AI edit patches from current blocks', async () => {
    const note = await service.createNote({
      blocks: [
        paragraph('a', '记得联系设计同学'),
        paragraph('b', '明天提交方案'),
      ],
      capturedVia: { channel: 'web' },
    });

    const result = await service.createAiEditPatch(note.id, '提取待办事项');

    expect(result?.patch.operations).toHaveLength(1);
    const operation = result?.patch.operations[0];
    expect(operation).toMatchObject({ type: 'replaceBlocks' });
    if (operation?.type === 'replaceBlocks') {
      expect(operation.blocks.map((block) => block.type)).toEqual(['todo', 'todo']);
      expect(operation.blocks.map((block) => 'text' in block ? block.text : '')).toEqual([
        '记得联系设计同学',
        '明天提交方案',
      ]);
    }
  });
});
