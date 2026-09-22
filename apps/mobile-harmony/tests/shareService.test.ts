import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: { request: mocks.request } }));

import { XopcShareService } from '../entry/src/main/ets/service/shareService.ets';

const share = { id: 'share-1', kind: 'session' as const, title: 'Planning', shareUrl: 'https://xopc.test/s/1',
  reachability: 'public' as const, expiresAt: '2026-09-23T00:00:00.000Z' };
const preview = { transcriptId: 'transcript-1', cutoffSeq: 12, metadataUpdatedAt: '2026-09-22T00:00:00.000Z',
  title: 'Planning', snapshotAt: '2026-09-22T01:00:00.000Z', messageCount: 8, attachmentCandidates: [] };

describe('Harmony governed sharing service', () => {
  const service = new XopcShareService();
  beforeEach(() => vi.resetAllMocks());

  it('lists, revokes and extends shares through the governed endpoints', async () => {
    mocks.request.mockResolvedValueOnce(JSON.stringify({ ok: true, payload: { shares: [{ ...share, fileName: 'Planning',
      createdAt: '2026-09-22T00:00:00.000Z', revoked: false, expired: false }] } }));
    await expect(service.list()).resolves.toHaveLength(1);
    await service.extend('share-1', 86400000);
    await service.revoke('share-1');
    expect(mocks.request).toHaveBeenNthCalledWith(2, '/api/shares/share-1', 'PATCH', JSON.stringify({ extendTtlMs: 86400000 }));
    expect(mocks.request).toHaveBeenNthCalledWith(3, '/api/shares/share-1', 'DELETE');
  });

  it('uses the immutable session preview tokens when creating a snapshot', async () => {
    mocks.request.mockResolvedValueOnce(JSON.stringify({ ok: true, payload: preview }));
    mocks.request.mockResolvedValueOnce(JSON.stringify({ ok: true, payload: share }));
    const loaded = await service.sessionPreview('conversation/1');
    await expect(service.session('conversation/1', loaded)).resolves.toMatchObject(share);
    expect(mocks.request).toHaveBeenLastCalledWith('/api/sessions/conversation%2F1/shares', 'POST', JSON.stringify({
      expectedTranscriptId: 'transcript-1', expectedCutoffSeq: 12,
      expectedMetadataUpdatedAt: '2026-09-22T00:00:00.000Z', ttlMs: 86400000,
      maxViews: null, includeToolActivities: true
    }));
  });

  it('pins note shares to the current note version', async () => {
    mocks.request.mockResolvedValueOnce(JSON.stringify({ ok: true, payload: { ...share, kind: 'note' } }));
    await service.note('note/1', 7);
    expect(mocks.request).toHaveBeenCalledWith('/api/notes/note%2F1/shares', 'POST',
      JSON.stringify({ expectedNoteVersion: 7, ttlMs: 86400000 }));
  });

  it('rejects malformed links and invalid extension requests', async () => {
    mocks.request.mockResolvedValueOnce(JSON.stringify({ ok: true, payload: { ...share, shareUrl: 'javascript:alert(1)' } }));
    await expect(service.note('note-1', 1)).rejects.toThrow('INVALID_SHARE_RESPONSE');
    await expect(service.extend('share-1', 0)).rejects.toThrow('INVALID_SHARE_EXTENSION');
  });
});
