import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildNoteAttachmentRef } from '../../../../notes/attachment-ref.js';
import type { Note } from '../../../../notes/types.js';
import { NoteShareService } from '../../../../share/note-share-service.js';
import { getShareStore, resetShareStoreForTests } from '../../../../share/share-store.js';
import { registerSharePublicRoutes } from '../shares.js';

const TEST_ROOT = join(tmpdir(), `xopc-note-share-route-${process.pid}`);
const TEST_STATE_DIR = join(TEST_ROOT, 'state');
const TEST_MEDIA = join(TEST_ROOT, 'asset.png');

vi.mock('../../../../config/paths.js', () => ({ resolveStateDir: () => TEST_STATE_DIR }));
vi.mock('../../../../tunnel/tunnel-state.js', () => ({ loadTunnelState: () => null }));

describe('public Note share routes', () => {
  beforeEach(() => {
    resetShareStoreForTests();
    rmSync(TEST_ROOT, { recursive: true, force: true });
    mkdirSync(TEST_STATE_DIR, { recursive: true });
    writeFileSync(TEST_MEDIA, 'asset-bytes');
  });

  afterEach(() => {
    resetShareStoreForTests();
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('claims a bounded view and keeps its ticket valid for attachment loading', async () => {
    const attachmentId = 'asset-1';
    const note: Note = {
      id: 'note-1', title: 'Shared Note', kind: 'media', status: 'processed',
      markdown: `![asset](${buildNoteAttachmentRef('note-1', attachmentId)})`,
      attachments: [{ id: attachmentId, type: 'image', mimeType: 'image/png', fileName: 'asset.png', size: 11, relativePath: 'asset.png' }],
      createdAt: 1, updatedAt: 2, capturedVia: { channel: 'web' },
    };
    const source = {
      getNote: async () => note,
      getAttachmentPath: async () => ({ filePath: TEST_MEDIA, mimeType: 'image/png', fileName: 'asset.png' }),
    };
    const store = getShareStore({ maxActiveShares: 10 });
    const noteShares = new NoteShareService(store, source);
    const record = await noteShares.create(note.id, { gatewayTokenHash: 'hash', maxViews: 1 });
    const app = new Hono();
    registerSharePublicRoutes(app, {
      notesServiceInstance: source,
      currentConfig: {
        gateway: { bind: 'loopback', port: 18790, auth: { mode: 'token' }, corsOrigins: [] },
      },
    } as never);

    const meta = await app.request(`/s/${record.token}/meta`);
    expect(meta.status).toBe(200);
    expect((await meta.json()).kind).toBe('note');
    expect(store.getById(record.id)?.downloadCount).toBe(0);

    const view = await app.request(`/s/${record.token}/view`, { method: 'POST' });
    expect(view.status).toBe(200);
    const payload = (await view.json() as { payload: { markdown: string } }).payload;
    expect(store.getById(record.id)?.downloadCount).toBe(1);
    const assetUrl = payload.markdown.match(/\((\/s\/[^)]+)\)/)?.[1];
    expect(assetUrl).toBeTruthy();

    const deniedSecondView = await app.request(`/s/${record.token}/view`, { method: 'POST' });
    expect(deniedSecondView.status).toBe(410);

    const asset = await app.request(assetUrl!);
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe('asset-bytes');
  });
});
