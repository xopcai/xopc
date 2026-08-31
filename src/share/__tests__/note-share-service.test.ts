import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Note } from '../../notes/types.js';
import { buildNoteAttachmentRef } from '../../notes/attachment-ref.js';
import { NoteShareService, NoteShareVersionConflictError } from '../note-share-service.js';
import { ShareStore } from '../share-store.js';

const TEST_ROOT = join(tmpdir(), `xopc-note-share-${process.pid}`);
const TEST_STATE_DIR = join(TEST_ROOT, 'state');
const TEST_MEDIA_DIR = join(TEST_ROOT, 'media');

vi.mock('../../config/paths.js', () => ({ resolveStateDir: () => TEST_STATE_DIR }));

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
});
