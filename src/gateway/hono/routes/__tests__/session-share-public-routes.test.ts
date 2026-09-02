import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionStatus, type SessionMetadata } from '../../../../session/types.js';
import { SessionShareService } from '../../../../share/session-share-service.js';
import { getShareStore, resetShareStoreForTests } from '../../../../share/share-store.js';
import { registerSharePublicRoutes } from '../shares.js';

const TEST_ROOT = join(tmpdir(), `xopc-session-share-route-${process.pid}`);
const TEST_STATE_DIR = join(TEST_ROOT, 'state');
const TEST_MEDIA = join(TEST_ROOT, 'shared.png');

vi.mock('../../../../config/paths.js', () => ({ resolveStateDir: () => TEST_STATE_DIR }));
vi.mock('../../../../tunnel/tunnel-state.js', () => ({ loadTunnelState: () => null }));
vi.mock('../../../../media/media-reference.js', () => ({
  resolveMediaReference: async (uri: string) => ({ bucket: 'inbound', id: 'shared.png', uri, path: TEST_MEDIA }),
}));

describe('public Session share routes', () => {
  beforeEach(() => {
    resetShareStoreForTests();
    rmSync(TEST_ROOT, { recursive: true, force: true });
    mkdirSync(TEST_STATE_DIR, { recursive: true });
    writeFileSync(TEST_MEDIA, 'image-bytes');
  });

  afterEach(() => {
    resetShareStoreForTests();
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('serves the immutable public projection and consumes only POST views', async () => {
    const sessionId = 'public-session-1';
    const metadata: SessionMetadata = {
      key: 'session-key', name: 'Shared conversation', status: SessionStatus.ACTIVE, tags: [],
      createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', lastAccessedAt: '2024-01-01T00:00:00.000Z',
      messageCount: 2, estimatedTokens: 2, compactedCount: 0, sourceChannel: 'webchat', sourceChatId: 'private', sessionType: 'chat', sessionId,
    };
    const snapshot = {
      sessionId,
      lastSeq: 2,
      entries: [
        { entryId: 'one', seq: 1, createdAt: 1, row: {
          role: 'user' as const,
          content: 'Question',
          media: [{
            id: 'private-id', bucket: 'inbound', type: 'image', mimeType: 'image/png', name: 'shared.png',
            size: 11, uri: 'media://inbound/shared.png', path: TEST_MEDIA,
          }],
        } },
        { entryId: 'two', seq: 2, createdAt: 2, row: { role: 'assistant' as const, content: 'Answer' } },
      ],
    };
    const store = getShareStore({ maxActiveShares: 10 });
    const sessionShares = new SessionShareService(store, {
      getMetadata: async () => metadata,
      getSnapshot: async () => snapshot,
    });
    const preview = await sessionShares.preview(metadata.key);
    const record = await sessionShares.create(metadata.key, {
      expectedSessionId: sessionId,
      expectedCutoffSeq: 2,
      expectedMetadataUpdatedAt: metadata.updatedAt,
      gatewayTokenHash: 'hash',
      maxViews: 1,
      attachmentIds: [preview.attachmentCandidates[0]!.id],
    });
    const app = new Hono();
    registerSharePublicRoutes(app, {
      notesServiceInstance: {},
      sessionIndexInstance: {},
      currentConfig: {
        gateway: { bind: 'loopback', port: 18790, publicUrl: 'https://share.example.com', auth: { mode: 'token' }, corsOrigins: [] },
      },
    } as never);

    const meta = await app.request(`/s/${record.token}/meta`);
    expect(meta.status).toBe(200);
    expect(await meta.json()).toMatchObject({ kind: 'session', messageCount: 2, valid: true });
    expect(store.getById(record.id)?.downloadCount).toBe(0);

    const landing = await app.request(`/s/${record.token}`);
    expect(landing.status).toBe(200);
    const landingHtml = await landing.text();
    expect(landingHtml).toContain('property="og:title"');
    expect(landingHtml).toContain(`https://share.example.com/s/${record.token}/thumbnail`);
    const thumbnail = await app.request(`/s/${record.token}/thumbnail`);
    expect(thumbnail.status).toBe(200);
    expect(thumbnail.headers.get('content-type')).toContain('image/svg+xml');
    expect(store.getById(record.id)?.downloadCount).toBe(0);

    const view = await app.request(`/s/${record.token}/view`, { method: 'POST' });
    expect(view.status).toBe(200);
    const payload = await view.json() as { payload: { attachments: Array<{ url: string }> } };
    expect(payload).toMatchObject({
      payload: {
        kind: 'session',
        title: 'Shared conversation',
        messages: [
          { role: 'user', markdown: 'Question' },
          { role: 'assistant', markdown: 'Answer' },
        ],
      },
    });
    expect(store.getById(record.id)?.downloadCount).toBe(1);
    expect((await app.request(`/s/${record.token}/view`, { method: 'POST' })).status).toBe(410);
    const asset = await app.request(payload.payload.attachments[0]!.url);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-security-policy')).toContain('sandbox');
    expect(await asset.text()).toBe('image-bytes');
  });
});
