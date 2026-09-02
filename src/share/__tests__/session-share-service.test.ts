import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionStatus, type SessionMetadata } from '../../session/types.js';
import type { CompactionSourceSnapshot, TranscriptSourceEntry } from '../../storage/sqlite/index.js';
import { SessionShareService, SessionShareSnapshotConflictError } from '../session-share-service.js';
import { ShareStore } from '../share-store.js';

const TEST_ROOT = join(tmpdir(), `xopc-session-share-${process.pid}`);
const TEST_STATE_DIR = join(TEST_ROOT, 'state');
const TEST_MEDIA = join(TEST_ROOT, 'private-source.png');

vi.mock('../../config/paths.js', () => ({ resolveStateDir: () => TEST_STATE_DIR }));
vi.mock('../../media/media-reference.js', () => ({
  resolveMediaReference: async (uri: string) => ({ bucket: 'inbound', id: 'private-source.png', uri, path: TEST_MEDIA }),
}));

function entry(seq: number, row: TranscriptSourceEntry['row']): TranscriptSourceEntry {
  return { entryId: `entry-${seq}`, seq, createdAt: 1_700_000_000_000 + seq, row };
}

function metadata(sessionId: string): SessionMetadata {
  return {
    key: 'agent:main:webchat:direct:share-test',
    name: 'Public conversation',
    status: SessionStatus.ACTIVE,
    tags: ['private'],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    lastAccessedAt: '2024-01-01T00:00:00.000Z',
    messageCount: 2,
    estimatedTokens: 10,
    compactedCount: 0,
    sourceChannel: 'webchat',
    sourceChatId: 'private-chat-id',
    sessionType: 'chat',
    sessionId,
    cwd: '/private/workspace',
  };
}

describe('SessionShareService', () => {
  let store: ShareStore;
  let snapshot: CompactionSourceSnapshot;
  let service: SessionShareService;
  const sessionId = 'session-share-1';

  beforeEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
    mkdirSync(TEST_STATE_DIR, { recursive: true });
    writeFileSync(TEST_MEDIA, Buffer.from('image-bytes'));
    snapshot = {
      sessionId,
      lastSeq: 6,
      entries: [
        entry(1, { role: 'system', content: 'private system prompt' }),
        entry(2, {
          role: 'user',
          content: 'Hello',
          media: [{
            id: 'private-id', bucket: 'inbound', type: 'image', mimeType: 'image/png', name: 'diagram.png',
            size: Buffer.byteLength('image-bytes'), uri: 'media://inbound/private-source.png', path: TEST_MEDIA,
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
        entry(4, { role: 'toolResult', toolCallId: 'tool-1', toolName: 'read_file', content: [{ type: 'text', text: 'private tool result' }] }),
        entry(5, { kind: 'context', text: 'private audit context', data: { token: 'secret' } }),
        entry(6, { role: 'bashExecution', command: 'cat /private/file', output: 'private shell output', exitCode: 1 }),
      ],
    };
    store = new ShareStore({ maxActiveShares: 20 });
    service = new SessionShareService(store, {
      getMetadata: async () => metadata(sessionId),
      getSnapshot: async () => snapshot,
    });
  });

  afterEach(() => {
    store.shutdown();
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('projects only visible user and assistant text', async () => {
    const preview = await service.preview('session-key');

    expect(preview.messages.map(({ role, markdown }) => ({ role, markdown }))).toEqual([
      { role: 'user', markdown: 'Hello' },
      { role: 'assistant', markdown: 'Public answer' },
    ]);
    expect(JSON.stringify(preview)).not.toContain('private');
    expect(JSON.stringify(preview)).not.toContain('secret');
    expect(preview.toolActivities).toEqual([
      expect.objectContaining({ toolName: 'read_file', status: 'completed' }),
      expect.objectContaining({ toolName: 'shell', status: 'failed' }),
    ]);
    expect(preview.attachmentCandidates).toEqual([
      expect.objectContaining({ fileName: 'diagram.png', mimeType: 'image/png' }),
    ]);
    expect(JSON.stringify(preview.attachmentCandidates)).not.toContain('media://');
  });

  it('creates an immutable artifact without session metadata', async () => {
    const record = await service.create('session-key', {
      expectedSessionId: sessionId,
      expectedCutoffSeq: 6,
      expectedMetadataUpdatedAt: '2024-01-01T00:00:00.000Z',
      gatewayTokenHash: 'creator-hash',
    });
    const manifest = await service.readManifest(record);

    expect(record.sourceSessionId).toBe(sessionId);
    expect(record.cutoffSeq).toBe(6);
    expect(record.messageCount).toBe(2);
    expect(manifest.messages).toHaveLength(2);
    expect(manifest).not.toHaveProperty('sessionKey');
    expect(JSON.stringify(manifest)).not.toContain('/private/workspace');
    expect(JSON.stringify(manifest)).not.toContain('entry-');
    expect(existsSync(join(TEST_STATE_DIR, record.artifactRelativePath, 'manifest.json'))).toBe(true);
  });

  it('rejects a snapshot that changed after preview', async () => {
    await expect(service.create('session-key', {
      expectedSessionId: sessionId,
      expectedCutoffSeq: 5,
      expectedMetadataUpdatedAt: '2024-01-01T00:00:00.000Z',
      gatewayTokenHash: 'creator-hash',
    })).rejects.toBeInstanceOf(SessionShareSnapshotConflictError);
  });

  it('rejects metadata that changed after preview', async () => {
    await expect(service.create('session-key', {
      expectedSessionId: sessionId,
      expectedCutoffSeq: 6,
      expectedMetadataUpdatedAt: '2024-01-02T00:00:00.000Z',
      gatewayTokenHash: 'creator-hash',
    })).rejects.toBeInstanceOf(SessionShareSnapshotConflictError);
  });

  it('copies only selected attachments and refreshes the same link', async () => {
    const preview = await service.preview('session-key');
    const attachmentId = preview.attachmentCandidates[0]!.id;
    const record = await service.create('session-key', {
      expectedSessionId: sessionId,
      expectedCutoffSeq: 6,
      expectedMetadataUpdatedAt: '2024-01-01T00:00:00.000Z',
      gatewayTokenHash: 'creator-hash',
      includeToolActivities: true,
      attachmentIds: [attachmentId],
    });
    const oldToken = record.token;
    const oldTicket = service.issueAssetTicket(record);
    const initial = await service.readManifest(record);
    expect(initial.toolActivities.map((activity) => activity.toolName)).toEqual(['read_file', 'shell']);
    expect(initial.attachments).toEqual([expect.objectContaining({ id: attachmentId, fileName: 'diagram.png' })]);
    expect(existsSync(join(TEST_STATE_DIR, record.artifactRelativePath, 'assets', attachmentId))).toBe(true);

    snapshot = {
      ...snapshot,
      lastSeq: 7,
      entries: [...snapshot.entries, entry(7, { role: 'assistant', content: 'Later answer' })],
    };
    const refreshed = await service.refresh('session-key', record.id, {
      expectedSessionId: sessionId,
      expectedCutoffSeq: 7,
      expectedMetadataUpdatedAt: '2024-01-01T00:00:00.000Z',
    });
    const updated = await service.readManifest(refreshed);

    expect(refreshed.token).toBe(oldToken);
    expect(refreshed.snapshotRevision).toBe(2);
    expect(refreshed.includeToolActivities).toBe(true);
    expect(updated.messages.at(-1)?.markdown).toBe('Later answer');
    expect(updated.attachments).toHaveLength(1);
    expect(service.verifyAssetTicket(refreshed, oldTicket)).toBe(false);
  });

  it('keeps the same media reference isolated per message', async () => {
    snapshot = {
      sessionId,
      lastSeq: 2,
      entries: [
        entry(1, {
          role: 'user',
          content: 'First',
          media: [{
            id: 'one', bucket: 'inbound', type: 'image', mimeType: 'image/png', name: 'diagram.png',
            size: Buffer.byteLength('image-bytes'), uri: 'media://inbound/private-source.png', path: TEST_MEDIA,
          }],
        }),
        entry(2, {
          role: 'user',
          content: 'Second',
          media: [{
            id: 'two', bucket: 'inbound', type: 'image', mimeType: 'image/png', name: 'diagram.png',
            size: Buffer.byteLength('image-bytes'), uri: 'media://inbound/private-source.png', path: TEST_MEDIA,
          }],
        }),
      ],
    };
    const preview = await service.preview('session-key');
    expect(preview.attachmentCandidates).toHaveLength(2);
    expect(new Set(preview.attachmentCandidates.map((attachment) => attachment.id)).size).toBe(2);

    const record = await service.create('session-key', {
      expectedSessionId: sessionId,
      expectedCutoffSeq: 2,
      expectedMetadataUpdatedAt: '2024-01-01T00:00:00.000Z',
      gatewayTokenHash: 'creator-hash',
      attachmentIds: preview.attachmentCandidates.map((attachment) => attachment.id),
    });
    const manifest = await service.readManifest(record);
    expect(manifest.messages[0]?.attachmentIds).toEqual([manifest.attachments[0]?.id]);
    expect(manifest.messages[1]?.attachmentIds).toEqual([manifest.attachments[1]?.id]);
  });
});
