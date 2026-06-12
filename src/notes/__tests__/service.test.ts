import { beforeEach, describe, expect, it, vi } from 'vitest';
import { complete } from '@earendil-works/pi-ai';

vi.mock('@earendil-works/pi-ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@earendil-works/pi-ai')>();
  return {
    ...actual,
    complete: vi.fn(),
  };
});

import { NotesService } from '../service.js';
import type { Note, NoteBlock, NoteSnapshot, NoteSnapshotEntry, SnapshotTrigger } from '../types.js';

class MemoryNotesStore {
  private notes = new Map<string, Note>();
  snapshots: NoteSnapshot[] = [];

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

  async deleteAttachmentFile(): Promise<void> {}

  async saveSnapshot(note: Note, trigger: SnapshotTrigger): Promise<void> {
    this.snapshots.push({
      noteId: note.id,
      timestamp: Date.now(),
      trigger,
      title: note.title,
      text: note.text,
      blocks: note.blocks,
      tags: note.tags,
      kind: note.kind,
      status: note.status,
    });
  }

  async listSnapshots(noteId: string): Promise<NoteSnapshotEntry[]> {
    return this.snapshots
      .filter((s) => s.noteId === noteId)
      .sort((a, b) => b.timestamp - a.timestamp)
      .map((s) => ({
        timestamp: s.timestamp,
        trigger: s.trigger,
        snippet: s.text?.slice(0, 80),
      }));
  }

  async getSnapshot(noteId: string, timestamp: number): Promise<NoteSnapshot | null> {
    return this.snapshots.find((s) => s.noteId === noteId && s.timestamp === timestamp) ?? null;
  }

  async pruneSnapshots(_noteId: string, _maxCount: number): Promise<void> {}

  async deleteAllSnapshots(noteId: string): Promise<void> {
    this.snapshots = this.snapshots.filter((s) => s.noteId !== noteId);
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
    vi.mocked(complete).mockReset();
    store = new MemoryNotesStore();
    service = new NotesService(store as never);
  });

  it('uses the first 10 characters of quick capture text as the default title', async () => {
    const note = await service.quickCapture('今天要整理产品方案和会议纪要', { channel: 'web' });

    expect(note.title).toBe('今天要整理产品方案和');
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

  it('saves a snapshot on content update', async () => {
    const note = await service.createNote({
      text: '原始内容',
      capturedVia: { channel: 'web' },
    });

    await service.updateNote(note.id, { text: '修改后内容' });

    const history = await service.listNoteHistory(note.id);
    expect(history).toHaveLength(1);
    expect(history[0].trigger).toBe('edit');
    expect(history[0].snippet).toBe('原始内容');
  });

  it('throttles edit snapshots within 60s', async () => {
    const note = await service.createNote({
      text: 'v0',
      capturedVia: { channel: 'web' },
    });

    await service.updateNote(note.id, { text: 'v1' });
    await service.updateNote(note.id, { text: 'v2' });
    await service.updateNote(note.id, { text: 'v3' });

    const history = await service.listNoteHistory(note.id);
    expect(history).toHaveLength(1);
  });

  it('always saves snapshot for sync trigger', async () => {
    const note = await service.createNote({
      text: 'v0',
      capturedVia: { channel: 'web' },
    });

    await service.updateNote(note.id, { text: 'v1' }, 'sync');
    await service.updateNote(note.id, { text: 'v2' }, 'sync');

    const history = await service.listNoteHistory(note.id);
    expect(history).toHaveLength(2);
    expect(history.every((e) => e.trigger === 'sync')).toBe(true);
  });

  it('restores a snapshot and saves current state first', async () => {
    const note = await service.createNote({
      text: '初始版本',
      capturedVia: { channel: 'web' },
    });

    await service.updateNote(note.id, { text: '被修改了' }, 'sync');
    const history = await service.listNoteHistory(note.id);
    const snapshotTimestamp = history[0].timestamp;

    const restored = await service.restoreNoteSnapshot(note.id, snapshotTimestamp);
    expect(restored?.text).toBe('初始版本');

    const historyAfter = await service.listNoteHistory(note.id);
    expect(historyAfter.some((e) => e.trigger === 'restore')).toBe(true);
  });

  it('cleans up snapshots when deleting a note', async () => {
    const note = await service.createNote({
      text: 'to delete',
      capturedVia: { channel: 'web' },
    });

    await service.updateNote(note.id, { text: 'edited' }, 'sync');
    expect(store.snapshots.length).toBeGreaterThan(0);

    await service.deleteNote(note.id);
    const remaining = store.snapshots.filter((s) => s.noteId === note.id);
    expect(remaining).toHaveLength(0);
  });

  it('does not save snapshot for metadata-only updates', async () => {
    const note = await service.createNote({
      text: '内容不变',
      capturedVia: { channel: 'web' },
    });

    await service.updateNote(note.id, { pinned: true });
    await service.updateNote(note.id, { status: 'archived' });

    const history = await service.listNoteHistory(note.id);
    expect(history).toHaveLength(0);
  });

  it('catalyzes a note with the model JSON response', async () => {
    vi.mocked(complete).mockResolvedValueOnce({
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            title: '产品想法催化',
            valueHypothesis: '把零散想法沉淀为可验证的个人创作闭环。',
            targetUsers: ['个人创作者'],
            keyQuestions: ['用户最先需要哪一步？'],
            mvpPath: ['做一个 Note 到 Chat 的最短路径'],
            risks: ['范围过大'],
            nextActions: [{ kind: 'task', text: '写出第一个可验证场景' }],
            confidence: 0.82,
          }),
        },
      ],
    } as never);

    const note = await service.createNote({
      title: 'AI 创作平台',
      text: '帮助用户把想法推进成成果。',
      capturedVia: { channel: 'web' },
    });

    const result = await service.catalyzeNote(note.id);

    expect(result?.report.valueHypothesis).toBe('把零散想法沉淀为可验证的个人创作闭环。');
    expect(result?.note.aiDeep?.catalysis?.status).toBe('catalyzed');
    expect(result?.note.aiDeep?.catalysis?.report?.nextActions[0]).toMatchObject({
      kind: 'task',
      text: '写出第一个可验证场景',
    });
    expect(complete).toHaveBeenCalledOnce();
  });

  it('falls back to local catalysis when the model call fails', async () => {
    vi.mocked(complete).mockRejectedValueOnce(new Error('model unavailable'));
    const note = await service.createNote({
      title: '离线想法',
      text: 'Local-first 的 AI Agent 产品。',
      capturedVia: { channel: 'web' },
    });

    const result = await service.catalyzeNote(note.id);

    expect(result?.report.originalNoteId).toBe(note.id);
    expect(result?.report.title).toContain('离线想法');
    expect(result?.note.aiDeep?.catalysis?.status).toBe('catalyzed');
    expect(complete).toHaveBeenCalledOnce();
  });
});
