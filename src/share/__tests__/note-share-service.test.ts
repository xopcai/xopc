import { useTestDatabase } from '../../storage/sqlite/__tests__/test-database.js';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Note } from '../../notes/types.js';
import { buildNoteAttachmentRef } from '../../notes/attachment-ref.js';
import { NoteShareService, NoteShareVersionConflictError } from '../note-share-service.js';
import { ShareStore } from '../share-store.js';
import {
  completeDiscussionOrganization,
  createDiscussionCapture,
  createDiscussionOrganization,
  updateDiscussionCapture,
} from '../../discussions/repository.js';
import { upsertNoteRecord } from '../../storage/sqlite/index.js';

const TEST_ROOT = join(tmpdir(), `xopc-note-share-${process.pid}`);
const TEST_STATE_DIR = join(TEST_ROOT, 'state');
const TEST_MEDIA_DIR = join(TEST_ROOT, 'media');

vi.mock('../../config/paths.js', () => ({ resolveStateDir: () => TEST_STATE_DIR }));

useTestDatabase();

describe('NoteShareService', () => {
  let store: ShareStore;
  let note: Note;
  let service: NoteShareService;
  const attachmentId = 'attachment-1';
  const attachmentPath = join(TEST_MEDIA_DIR, 'image.png');

  beforeEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
    mkdirSync(TEST_STATE_DIR, { recursive: true });
    mkdirSync(TEST_MEDIA_DIR, { recursive: true });
    writeFileSync(attachmentPath, Buffer.from('image-bytes'));
    note = {
      id: 'note-1',
      title: 'Public plan',
      kind: 'media',
      status: 'processed',
      markdown: `# Plan\n\n![diagram](${buildNoteAttachmentRef('note-1', attachmentId)})`,
      attachments: [{
        id: attachmentId,
        type: 'image',
        mimeType: 'image/png',
        fileName: 'diagram.png',
        size: Buffer.byteLength('image-bytes'),
        relativePath: 'image.png',
        transcript: 'must remain private',
      }],
      createdAt: 100,
      updatedAt: 200,
      capturedVia: { channel: 'web' },
      tags: ['private-tag'],
      ai: { summary: 'private summary' },
    };
    store = new ShareStore({ maxActiveShares: 20 });
    service = new NoteShareService(store, {
      getNote: async (id) => id === note.id ? note : null,
      getAttachmentPath: async (noteId, id) => noteId === note.id && id === attachmentId
        ? { filePath: attachmentPath, mimeType: 'image/png', fileName: 'diagram.png' }
        : null,
    });
  });

  afterEach(() => {
    store.shutdown();
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('creates a minimal immutable snapshot with copied referenced attachments', async () => {
    const record = await service.create(note.id, {
      expectedNoteVersion: note.updatedAt,
      gatewayTokenHash: 'creator-hash',
      maxViews: 2,
    });
    const manifest = await service.readManifest(record);

    expect(record.kind).toBe('note');
    expect(record.sourceVersion).toBe(200);
    expect(manifest.title).toBe('Public plan');
    expect(manifest.attachments).toHaveLength(1);
    expect(manifest.attachments[0]).not.toHaveProperty('transcript');
    expect(manifest).not.toHaveProperty('tags');
    expect(manifest).not.toHaveProperty('ai');
    expect(existsSync(join(TEST_STATE_DIR, record.artifactRelativePath, 'assets', attachmentId))).toBe(true);
  });

  it('rejects a stale reviewed Note version', async () => {
    await expect(service.create(note.id, {
      expectedNoteVersion: 199,
      gatewayTokenHash: 'creator-hash',
    })).rejects.toBeInstanceOf(NoteShareVersionConflictError);
  });

  it('redacts an attachment that the owner excludes from the snapshot', async () => {
    const record = await service.create(note.id, {
      gatewayTokenHash: 'creator-hash',
      attachmentIds: [],
    });
    const manifest = await service.readManifest(record);
    expect(manifest.attachments).toEqual([]);
    expect(manifest.markdown).toContain('Attachment not shared: diagram');
    expect(manifest.markdown).not.toContain('xopc-attachment://');
  });

  it('refreshes the same record and invalidates old asset tickets', async () => {
    const record = await service.create(note.id, { gatewayTokenHash: 'creator-hash' });
    const oldTicket = service.issueAssetTicket(record);
    note = { ...note, title: 'Updated plan', markdown: '# Updated', updatedAt: 300, attachments: [] };

    const refreshed = await service.refresh(note.id, record.id, { expectedNoteVersion: 300 });
    const manifest = await service.readManifest(refreshed);

    expect(refreshed.token).toBe(record.token);
    expect(refreshed.snapshotRevision).toBe(2);
    expect(manifest.title).toBe('Updated plan');
    expect(service.verifyAssetTicket(refreshed, oldTicket)).toBe(false);
  });

  it('issues scoped tickets and removes artifacts when the source is revoked', async () => {
    const record = await service.create(note.id, { gatewayTokenHash: 'creator-hash' });
    const ticket = service.issueAssetTicket(record);
    expect(service.verifyAssetTicket(record, ticket)).toBe(true);

    const count = await service.revokeForNote(note.id);
    expect(count).toBe(1);
    expect(store.getById(record.id)?.revoked).toBe(true);
    expect(existsSync(join(TEST_STATE_DIR, record.artifactRelativePath))).toBe(false);
  });

  it('projects discussion summary and transcript when sharing an empty-markdown voice note', async () => {
    const audioPath = join(TEST_MEDIA_DIR, 'recording.webm');
    writeFileSync(audioPath, Buffer.from('audio-bytes'));
    const voiceNote: Note = {
      id: 'voice-note-share',
      title: 'Discussion · 2026-11-23 09:00',
      kind: 'voice',
      status: 'processed',
      markdown: '',
      attachments: [{
        id: 'att-audio-share',
        type: 'audio',
        mimeType: 'audio/webm',
        fileName: 'recording.webm',
        size: 11,
        relativePath: 'recording.webm',
      }],
      createdAt: 100,
      updatedAt: 500,
      capturedVia: { channel: 'web' },
    };
    upsertNoteRecord(voiceNote);
    createDiscussionCapture({
      id: 'disc-share-1',
      clientRequestId: 'req-share-1',
      noteId: voiceNote.id,
      source: 'web',
      status: 'recording',
      transcriptRevision: 1,
      recordingStartedAt: 100,
      createdAt: 100,
      updatedAt: 100,
    });
    updateDiscussionCapture('disc-share-1', {
      status: 'completed',
      audioAttachmentId: 'att-audio-share',
      durationMs: 60_000,
      canonicalTranscript: '[00:00-00:15] 确认把录音纪要接入公开分享快照。',
    });
    const orgRecord = createDiscussionOrganization({
      discussionId: 'disc-share-1',
      inputTranscriptSha256: 'sha-share',
      promptVersion: 'v1',
      modelRef: 'test/model',
      transcriptRevision: 2,
    });
    completeDiscussionOrganization(orgRecord.id, {
      title: '产品体验评审纪要',
      summary: '同意录音笔记支持结构化纪要与转写分享。',
      keyPoints: ['默认不暴露原始录音音频'],
      decisions: [{ id: 'd1', text: '分享快照自动合成 Markdown' }],
      actionItems: [{ id: 'a1', title: '联调公开分享页', owner: 'Bob' }],
      risks: [],
      openQuestions: [],
    });

    const voiceShareService = new NoteShareService(store, {
      getNote: async (id) => id === voiceNote.id ? voiceNote : null,
      getAttachmentPath: async (noteId, id) =>
        noteId === voiceNote.id && id === 'att-audio-share'
          ? { filePath: audioPath, mimeType: 'audio/webm', fileName: 'recording.webm' }
          : null,
    });

    const recordWithoutAudio = await voiceShareService.create(voiceNote.id, {
      gatewayTokenHash: 'creator-hash',
      attachmentIds: [],
      discussionOptions: { includeSummary: true, includeTranscript: true, includePersonalNotes: true },
    });
    const manifestWithoutAudio = await voiceShareService.readManifest(recordWithoutAudio);
    expect(manifestWithoutAudio.title).toBe('产品体验评审纪要');
    expect(manifestWithoutAudio.markdown).toContain('同意录音笔记支持结构化纪要与转写分享。');
    expect(manifestWithoutAudio.markdown).toContain('分享快照自动合成 Markdown');
    expect(manifestWithoutAudio.markdown).toContain('确认把录音纪要接入公开分享快照。');
    expect(manifestWithoutAudio.attachments).toEqual([]);
  });
});
