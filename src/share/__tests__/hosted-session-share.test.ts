import { useTestDatabase } from '../../storage/sqlite/__tests__/test-database.js';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CredentialResolver } from '../../auth/credentials.js';
import { SessionStatus, type SessionMetadata } from '../../session/types.js';
import type { CompactionSourceSnapshot, TranscriptSourceEntry } from '../../storage/sqlite/index.js';
import {
  HostedSessionShareBuilder,
  HostedPublicationPublisher,
  HostedShareRemoteError,
  HostedShareBindingStore,
  type HostedShareBinding,
} from '../hosted-session-share.js';
import { projectSessionShare } from '../session-share-projector.js';

const TEST_ROOT = join(tmpdir(), `xopc-hosted-share-${process.pid}`);
const TEST_MEDIA = join(TEST_ROOT, 'private-image.png');

vi.mock('../../config/paths.js', () => ({ resolveStateDir: () => TEST_ROOT }));
vi.mock('../../media/media-reference.js', () => ({
  resolveMediaReference: async (uri: string) => ({ bucket: 'inbound', id: 'private-image.png', uri, path: TEST_MEDIA }),
}));

function entry(seq: number, row: TranscriptSourceEntry['row']): TranscriptSourceEntry {
  return { entryId: `entry-${seq}`, seq, createdAt: 1_700_000_000_000 + seq, row };
}

function metadata(): SessionMetadata {
  return {
    key: 'agent:main:webchat:direct:hosted-share-test',
    name: 'Hosted conversation',
    status: SessionStatus.ACTIVE,
    tags: ['private'],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    lastAccessedAt: '2024-01-01T00:00:00.000Z',
    messageCount: 2,
    estimatedTokens: 10,
    compactedCount: 0,
    sourceChannel: 'webchat',
    sourceChatId: 'private-chat',
    sessionType: 'chat',
    sessionId: 'session-hosted-1',
    cwd: '/private/workspace',
  };
}

useTestDatabase();

describe('hosted session sharing', () => {
  let snapshot: CompactionSourceSnapshot;

  beforeEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
    mkdirSync(TEST_ROOT, { recursive: true });
    writeFileSync(TEST_MEDIA, 'image-bytes');
    snapshot = {
      sessionId: 'session-hosted-1',
      lastSeq: 4,
      entries: [
        entry(1, { role: 'system', content: 'private system prompt' }),
        entry(2, {
          role: 'user',
          content: 'Public question',
          media: [{
            id: 'private-id', bucket: 'inbound', type: 'image', mimeType: 'image/png', name: '../diagram.png',
            size: 11, uri: 'media://inbound/private-image.png', path: TEST_MEDIA,
          }],
        }),
        entry(3, {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'private reasoning' },
            { type: 'text', text: 'Public answer' },
            { type: 'toolCall', id: 'tool-1', name: 'read_file', arguments: { path: '/private/file' } },
          ],
        }),
        entry(4, { role: 'toolResult', toolCallId: 'tool-1', toolName: 'read_file', content: [{ type: 'text', text: 'private result' }] }),
      ],
    };
  });

  afterEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('builds the closed hosted manifest and uploads it atomically', async () => {
    const attachmentId = projectSessionShare(snapshot.entries).attachmentCandidates[0]!.id;
    const builder = new HostedSessionShareBuilder({
      getMetadata: async () => metadata(),
      getSnapshot: async () => snapshot,
    });
    const built = await builder.build('session-key', {
      expectedSessionId: 'session-hosted-1',
      expectedCutoffSeq: 4,
      expectedMetadataUpdatedAt: '2024-01-01T00:00:00.000Z',
      includeToolActivities: true,
      attachmentIds: [attachmentId],
    });

    expect(built.manifest.messages.map((message) => message.markdown)).toEqual(['Public question', 'Public answer']);
    expect(built.manifest.toolActivities).toEqual([expect.objectContaining({ toolName: 'read_file', status: 'completed' })]);
    expect(built.manifest.attachments).toEqual([expect.objectContaining({ id: attachmentId, fileName: 'diagram.png', size: 11 })]);
    expect(JSON.stringify(built.manifest)).not.toContain('private');
    expect(built.manifest).not.toHaveProperty('source');

    const requests: Array<{ path: string; method: string }> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      requests.push({ path: url.pathname, method });
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer share-access');
      if (method === 'POST' && url.pathname === '/api/v1/publications') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body.kind).toBe('session_document');
        expect(body).not.toHaveProperty('sessionId');
        expect(body).not.toHaveProperty('sessionKey');
        return Response.json({
          shareId: 'share-1', uploadId: 'upload-1', targetRevision: 1,
          publicUrl: 'https://share.test/s/public-token',
          assetUploads: [{ assetId: attachmentId, uploadUrl: `/api/v1/publications/share-1/uploads/upload-1/assets/${attachmentId}` }],
        }, { status: 201 });
      }
      if (method === 'PUT') {
        const chunks: Buffer[] = [];
        for await (const chunk of init?.body as unknown as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
        expect(Buffer.concat(chunks).toString()).toBe('image-bytes');
        return Response.json({ ok: true });
      }
      return Response.json({ item: {
        id: 'share-1', title: 'Hosted conversation', description: null, status: 'active', revision: 1,
        expiresAt: '2024-01-02T00:00:00.000Z', maxViews: 10, viewCount: 0,
        createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
      } });
    });
    const credentials = {
      loadOAuthToken: async () => ({
        type: 'oauth' as const, provider: 'xopc-share', access: 'share-access', refresh: 'share-refresh',
        expiresAt: Date.now() + 60_000, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }),
    } as unknown as CredentialResolver;
    const publisher = new HostedPublicationPublisher('https://share.test', credentials, fetchImpl);
    const result = await publisher.create(built, { ttlMs: 86_400_000, maxViews: 10 });

    expect(result).toMatchObject({ id: 'share-1', shareUrl: 'https://share.test/s/public-token', snapshotRevision: 1 });
    expect(requests.map(({ method }) => method)).toEqual(['POST', 'PUT', 'POST']);
  });

  it('discovers and lists the generic Publication control plane', async () => {
    const credentials = {
      loadOAuthToken: async () => ({
        type: 'oauth' as const, provider: 'xopc-share', access: 'share-access', refresh: 'share-refresh',
        expiresAt: Date.now() + 60_000, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }),
    } as unknown as CredentialResolver;
    const summary = {
      id: 'share-1', title: 'Hosted conversation', description: null, status: 'active' as const, revision: 1,
      expiresAt: '2024-01-02T00:00:00.000Z', maxViews: null, viewCount: 0,
      createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
      kind: 'session_document' as const, deliveryMode: 'hosted_snapshot' as const,
      owner: { type: 'user' as const, id: 'user-1' }, workspaceId: 'workspace-1', createdByPrincipalId: 'principal-1',
    };
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/capabilities')) return Response.json({
        protocolVersion: '1', kinds: ['session_document'], deliveryModes: ['hosted_snapshot'],
        accessModes: ['anyone_with_link'], upload: { direct: false, multipart: false, resumable: false, streaming: true },
        lifecycle: { revisions: true, revoke: true, asynchronousDeletion: true },
        publishing: { allowed: true, managedBy: 'platform_admin' },
      });
      return Response.json({ items: [summary] });
    });
    const publisher = new HostedPublicationPublisher('https://share.test', credentials, fetchImpl);

    await expect(publisher.capabilities()).resolves.toMatchObject({ kinds: ['session_document'], upload: { streaming: true } });
    await expect(publisher.listPublications()).resolves.toEqual([summary]);
  });

  it('preserves the remote admin policy denial', async () => {
    const credentials = {
      loadOAuthToken: async () => ({
        type: 'oauth' as const, provider: 'xopc-share', access: 'share-access', refresh: 'share-refresh',
        expiresAt: Date.now() + 60_000, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }),
    } as unknown as CredentialResolver;
    const publisher = new HostedPublicationPublisher('https://share.test', credentials, async () => Response.json({
      error: { code: 'CONTENT_DISTRIBUTION_DISABLED', message: 'Public sharing has been disabled by an administrator' },
    }, { status: 403 }));

    await expect(publisher.capabilities()).rejects.toMatchObject<HostedShareRemoteError>({
      status: 403,
      code: 'CONTENT_DISTRIBUTION_DISABLED',
    });
  });

  it('persists only local hosted-share bindings for the matching session', async () => {
    const store = new HostedShareBindingStore();
    const binding: HostedShareBinding = {
      id: 'share-1', shareUrl: 'https://share.test/s/token', expiresAt: '2024-01-02T00:00:00.000Z',
      maxViews: null, viewCount: 0, snapshotRevision: 1, sessionId: 'session-hosted-1', cutoffSeq: 4,
      kind: 'session_document', source: { kind: 'session', id: 'session-hosted-1', version: '4' },
      revisionSources: { '1': { kind: 'session', id: 'session-hosted-1', version: '4' } },
      title: 'Hosted conversation', description: null, messageCount: 2, attachmentCount: 0,
      includeToolActivities: false, attachmentIds: [], createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z', revoked: false,
    };
    await store.upsert(binding);
    expect(await store.list('session-hosted-1')).toEqual([binding]);
    expect(await store.list('other-session')).toEqual([]);
  });
});
