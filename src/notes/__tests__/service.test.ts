import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import { seedTestAgentCatalog } from '../../agent-catalog/test-support.js';

vi.mock('../../providers/model-call.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers/model-call.js')>();
  return { ...actual, completeWithResolvedCredentials: vi.fn() };
});

import { NotesService } from '../service.js';
import { completeWithResolvedCredentials } from '../../providers/model-call.js';
import type { Note, NoteSnapshot, NoteSnapshotEntry, SnapshotTrigger } from '../types.js';
import { ConfigSchema, type Config } from '../../config/schema.js';
import { onAutomationProductEvent } from '../../automations/product-events.js';

function configWithGlobalModel(model = 'anthropic/claude-sonnet-4-5'): Config {
  const repository = new AgentCatalogRepository();
  const settings = repository.getSettings();
  repository.updateDefaults({
    ...settings.defaults,
    models: { ...settings.defaults.models, chat: { primary: model, fallbacks: [] } },
  }, settings.revision);
  return ConfigSchema.parse({});
}

class MemoryNotesStore {
  private notes = new Map<string, Note>();
  snapshots: NoteSnapshot[] = [];

  async initialize(): Promise<void> {}
  addNote(note: Note): void { this.notes.set(note.id, note); }
  getNote(id: string): Note | null { return this.notes.get(id) ?? null; }

  updateNote(id: string, patch: Partial<Note>): Note | null {
    const existing = this.notes.get(id);
    if (!existing) return null;
    const updated: Note = { ...existing, ...patch, id: existing.id, createdAt: existing.createdAt, updatedAt: Date.now() };
    this.notes.set(id, updated);
    return updated;
  }

  deleteNoteAtomically(id: string): boolean {
    if (!this.notes.has(id)) return false;
    this.notes.delete(id);
    this.snapshots = this.snapshots.filter(snapshot => snapshot.noteId !== id);
    return true;
  }

  async listNotes(): Promise<{ items: []; total: number }> { return { items: [], total: this.notes.size }; }
  async saveAttachment(): Promise<{ relativePath: string; size: number }> { return { relativePath: 'mock', size: 0 }; }
  resolveAttachmentPath(): string { return 'mock'; }
  async deleteAttachmentFile(): Promise<void> {}

  queueAttachmentCleanup(): void {}
  queueDeletionCleanup(): void {}
  drainDeletionCleanup(): void {}
  drainAttachmentCleanup(): void {}

  saveSnapshot(note: Note, trigger: SnapshotTrigger): void {
    this.snapshots.push({
      noteId: note.id,
      timestamp: Date.now(),
      trigger,
      title: note.title,
      markdown: note.markdown,
      tags: note.tags,
      kind: note.kind,
      status: note.status,
    });
  }

  listSnapshots(noteId: string): NoteSnapshotEntry[] {
    return this.snapshots
      .filter((s) => s.noteId === noteId)
      .sort((a, b) => b.timestamp - a.timestamp)
      .map((s) => ({ timestamp: s.timestamp, trigger: s.trigger, snippet: s.markdown.slice(0, 80) || undefined }));
  }

  getSnapshot(noteId: string, timestamp: number): NoteSnapshot | null {
    return this.snapshots.find((s) => s.noteId === noteId && s.timestamp === timestamp) ?? null;
  }

  pruneSnapshots(_noteId: string, _maxCount: number): void {}
  async flush(): Promise<void> {}
}

describe('NotesService markdown sync and AI edit', () => {
  let store: MemoryNotesStore;
  let service: NotesService;
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-notes-service-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    seedTestAgentCatalog({ agents: [{ id: 'main', enabled: true, profile: { name: 'Main' }, workspace: '~/.xopc/workspace/main' }] });
    vi.mocked(completeWithResolvedCredentials).mockReset();
    store = new MemoryNotesStore();
    service = new NotesService(store as never);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('records the latest content editor even when manual snapshots are throttled', async () => {
    const note = await service.createNote({ markdown: 'Original', capturedVia: { channel: 'web' } });
    const agentEdit = await service.updateNote(note.id, { markdown: 'Agent draft' }, 'ai_edit');
    expect(agentEdit?.lastEditTrigger).toBe('ai_edit');
    await service.updateNote(note.id, { pinned: true });
    expect((await service.getNote(note.id))?.lastEditTrigger).toBe('ai_edit');
    const manualEdit = await service.updateNote(note.id, { markdown: 'Manual revision' });
    expect(manualEdit?.lastEditTrigger).toBe('edit');
    expect(store.snapshots).toHaveLength(1);
  });

  it('preserves a meaningful subject as the default quick capture title', async () => {
    const note = await service.quickCapture('今天要整理产品方案和会议纪要', { channel: 'web' });
    expect(note.title).toBe('今天要整理产品方案和会议纪要');
  });

  it('prefers a document heading over a conversational preamble', async () => {
    const note = await service.quickCapture('我现在彻底理解了。\n\n# 产品交互优化方案\n内容', { channel: 'web' });
    expect(note.title).toBe('产品交互优化方案');
  });

  it('reuses the original quick capture for the same idempotency key', async () => {
    const first = await service.quickCapture('Original capture', { channel: 'app' }, 'capture-request-1');
    const replay = await service.quickCapture('Replayed capture', { channel: 'app' }, 'capture-request-1');

    expect(replay.id).toBe(first.id);
    expect(replay.markdown).toBe('Original capture');
  });

  it('coalesces concurrent quick captures with the same idempotency key', async () => {
    const [first, replay] = await Promise.all([
      service.quickCapture('Original capture', { channel: 'app' }, 'capture-request-2'),
      service.quickCapture('Replayed capture', { channel: 'app' }, 'capture-request-2'),
    ]);

    expect(replay.id).toBe(first.id);
    expect(replay.markdown).toBe(first.markdown);
  });

  it('creates notes from markdown', async () => {
    const note = await service.createNote({ markdown: '第一段\n\n第二段', capturedVia: { channel: 'web' } });
    expect(note.markdown).toBe('第一段\n\n第二段');
    expect(note.remoteVersion).toBe(1);
  });

  it('reuses full note captures for the same idempotency key', async () => {
    const first = await service.createNote(
      { markdown: 'Original media capture', capturedVia: { channel: 'app' } },
      'media-request-1',
    );
    const replay = await service.createNote(
      { markdown: 'Duplicate retry', capturedVia: { channel: 'app' } },
      'media-request-1',
    );

    expect(replay.id).toBe(first.id);
    expect(replay.markdown).toBe('Original media capture');
  });

  it('reuses a note attachment for the same idempotency key', async () => {
    const note = await service.createNote(
      { kind: 'voice', capturedVia: { channel: 'app' } },
      'voice-request-1',
    );
    const first = await service.addAttachment(note.id, {
      name: 'voice.m4a', buffer: Buffer.from('audio'), mimeType: 'audio/mp4',
    }, 'voice-request-1');
    const replay = await service.addAttachment(note.id, {
      name: 'voice.m4a', buffer: Buffer.from('audio'), mimeType: 'audio/mp4',
    }, 'voice-request-1');

    expect(replay?.id).toBe(first?.id);
    expect((await service.getNote(note.id))?.attachments).toHaveLength(1);
  });

  it('publishes product events when notes are created and updated', async () => {
    const events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    const unsubscribe = onAutomationProductEvent((event) => {
      events.push({ type: event.type, payload: event.payload });
    });
    try {
      const note = await service.createNote({ markdown: 'Product event note', capturedVia: { channel: 'web' } });
      await service.updateNote(note.id, { markdown: 'Updated product event note' });
    } finally {
      unsubscribe();
    }

    expect(events.map((event) => event.type)).toEqual(['note.created', 'note.updated']);
    expect(events[0]?.payload).toMatchObject({ kind: 'thought', status: 'inbox' });
    expect(events[1]?.payload).toMatchObject({ contentTouched: true, trigger: 'edit' });
  });

  it('syncs markdown when base remote version is current', async () => {
    const note = await service.createNote({ markdown: '原文', capturedVia: { channel: 'web' } });
    const result = await service.syncNote(note.id, { markdown: '新版 Markdown', localVersion: 3 }, 1);
    expect(result.conflict).toBe(false);
    expect(result.note).toMatchObject({ markdown: '新版 Markdown', localVersion: 3, remoteVersion: 2 });
  });

  it('returns a conflict when base remote version is stale', async () => {
    const note = await service.createNote({ markdown: '原文', capturedVia: { channel: 'web' } });
    await service.updateNote(note.id, { markdown: '远端已更新' });
    const result = await service.syncNote(note.id, { markdown: '本地旧编辑' }, 1);
    expect(result.conflict).toBe(true);
    expect(result.note).toMatchObject({ markdown: '远端已更新', remoteVersion: 2 });
  });

  it('generates todo AI edit patches from current markdown', async () => {
    const note = await service.createNote({ markdown: '记得联系设计同学\n\n明天提交方案', capturedVia: { channel: 'web' } });
    const result = await service.createAiEditPatch(note.id, '提取待办事项');
    expect(result?.patch.operations).toHaveLength(1);
    const operation = result?.patch.operations[0];
    expect(operation).toMatchObject({ type: 'replaceRange' });
    if (operation?.type === 'replaceRange') {
      expect(operation.markdown).toContain('- [ ] 记得联系设计同学');
      expect(operation.markdown).toContain('- [ ] 明天提交方案');
    }
  });

  it('saves a snapshot on content update', async () => {
    const note = await service.createNote({ markdown: '原始内容', capturedVia: { channel: 'web' } });
    await service.updateNote(note.id, { markdown: '修改后内容' });
    const history = await service.listNoteHistory(note.id);
    expect(history).toHaveLength(1);
    expect(history[0].trigger).toBe('edit');
    expect(history[0].snippet).toBe('原始内容');
  });

  it('throttles edit snapshots within 60s', async () => {
    const note = await service.createNote({ markdown: 'v0', capturedVia: { channel: 'web' } });
    await service.updateNote(note.id, { markdown: 'v1' });
    await service.updateNote(note.id, { markdown: 'v2' });
    await service.updateNote(note.id, { markdown: 'v3' });
    const history = await service.listNoteHistory(note.id);
    expect(history).toHaveLength(1);
  });

  it('always saves snapshot for sync trigger', async () => {
    const note = await service.createNote({ markdown: 'v0', capturedVia: { channel: 'web' } });
    await service.updateNote(note.id, { markdown: 'v1' }, 'sync');
    await service.updateNote(note.id, { markdown: 'v2' }, 'sync');
    const history = await service.listNoteHistory(note.id);
    expect(history).toHaveLength(2);
    expect(history.every((e) => e.trigger === 'sync')).toBe(true);
  });

  it('restores a snapshot and saves current state first', async () => {
    const note = await service.createNote({ markdown: '初始版本', capturedVia: { channel: 'web' } });
    await service.updateNote(note.id, { markdown: '被修改了' }, 'sync');
    const history = await service.listNoteHistory(note.id);
    const restored = await service.restoreNoteSnapshot(note.id, history[0].timestamp);
    expect(restored?.markdown).toBe('初始版本');
    const historyAfter = await service.listNoteHistory(note.id);
    expect(historyAfter.some((e) => e.trigger === 'restore')).toBe(true);
  });

  it('cleans up snapshots when deleting a note', async () => {
    const note = await service.createNote({ markdown: 'to delete', capturedVia: { channel: 'web' } });
    await service.updateNote(note.id, { markdown: 'edited' }, 'sync');
    expect(store.snapshots.length).toBeGreaterThan(0);
    await service.deleteNote(note.id);
    expect(store.snapshots.filter((s) => s.noteId === note.id)).toHaveLength(0);
  });

  it('does not save snapshot for metadata-only updates', async () => {
    const note = await service.createNote({ markdown: '内容不变', capturedVia: { channel: 'web' } });
    await service.updateNote(note.id, { pinned: true });
    await service.updateNote(note.id, { status: 'archived' });
    const history = await service.listNoteHistory(note.id);
    expect(history).toHaveLength(0);
  });

  it('catalyzes a note with the model JSON response', async () => {
    vi.mocked(completeWithResolvedCredentials).mockResolvedValueOnce({
      role: 'assistant',
      content: [{ type: 'text', text: JSON.stringify({ title: '产品想法催化', valueHypothesis: '把零散想法沉淀为可验证的个人创作闭环。', targetUsers: ['个人创作者'], keyQuestions: ['用户最先需要哪一步？'], mvpPath: ['做一个 Note 到 Chat 的最短路径'], risks: ['范围过大'], nextActions: [{ kind: 'task', text: '写出第一个可验证场景' }], confidence: 0.82 }) }],
    } as never);

    const note = await service.createNote({ title: 'AI 创作平台', markdown: '帮助用户把想法推进成成果。', capturedVia: { channel: 'web' } });
    const result = await service.catalyzeNote(note.id, configWithGlobalModel());
    expect(result?.report.valueHypothesis).toBe('把零散想法沉淀为可验证的个人创作闭环。');
    expect(result?.note.aiDeep?.catalysis?.status).toBe('catalyzed');
    expect(result?.note.aiDeep?.catalysis?.report?.nextActions[0]).toMatchObject({ kind: 'task', text: '写出第一个可验证场景' });
    expect(completeWithResolvedCredentials).toHaveBeenCalledOnce();
  });

  it('falls back to local catalysis when the model call fails', async () => {
    vi.mocked(completeWithResolvedCredentials).mockRejectedValueOnce(new Error('model unavailable'));
    const note = await service.createNote({ title: '离线想法', markdown: 'Local-first 的 AI Agent 产品。', capturedVia: { channel: 'web' } });
    const result = await service.catalyzeNote(note.id, configWithGlobalModel());
    expect(result?.report.originalNoteId).toBe(note.id);
    expect(result?.report.title).toContain('离线想法');
    expect(result?.note.aiDeep?.catalysis?.status).toBe('catalyzed');
    expect(completeWithResolvedCredentials).toHaveBeenCalledOnce();
  });
});
