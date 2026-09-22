import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn(), show: vi.fn(), data: vi.fn() }));
vi.mock('@kit.AbilityKit', () => ({}));
vi.mock('@kit.ArkData', () => ({ uniformTypeDescriptor: { UniformDataType: { PLAIN_TEXT: 'general.plain-text' } } }));
vi.mock('@kit.ShareKit', () => ({ systemShare: {
  SharedData: class { constructor(data: object) { mocks.data(data); } },
  ShareController: class { show = mocks.show; },
  SelectionMode: { SINGLE: 1 }, SharePreviewMode: { DEFAULT: 0 }
} }));
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: { request: mocks.request } }));

import { chatMediaShareRequest, createChatMediaShare, shareChatLink, shareReachabilityText } from '../entry/src/main/ets/service/chatMediaShare.ets';

const file = { id: 'artifact', fileId: 'managed-file', name: 'report.pdf', mimeType: 'application/pdf', uri: '', size: 5, type: 'document' };
const payload = { share: { id: 'share-1', kind: 'file', title: 'report.pdf', description: '',
  shareUrl: 'https://share.example/s/token', reachability: 'public' as const, expiresAt: '2026-09-23T00:00:00.000Z' } };

describe('managed chat file sharing', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.request.mockResolvedValue(JSON.stringify({ ok: true, payload })); });

  it('prefers an explicit managed file id and preserves conversation context', () => {
    expect(chatMediaShareRequest(file, 'conversation-1')).toEqual({
      fileId: 'managed-file', conversationId: 'conversation-1', audience: 'friend'
    });
  });

  it('accepts xopc-file ids and session-relative paths but rejects raw media', () => {
    expect(chatMediaShareRequest({ ...file, fileId: undefined, uri: 'xopc-file:space-id.cmVwb3J0' }, 'c')?.fileId)
      .toBe('space-id.cmVwb3J0');
    expect(chatMediaShareRequest({ ...file, fileId: undefined, uri: '', workspaceRelativePath: 'reports/final.pdf' }, 'c'))
      .toEqual({ path: 'reports/final.pdf', conversationId: 'c', audience: 'friend' });
    expect(chatMediaShareRequest({ ...file, fileId: undefined, uri: 'media://inbound/1' }, 'c')).toBeUndefined();
    expect(chatMediaShareRequest({ ...file, fileId: undefined, uri: 'data:image/png;base64,AA==' }, 'c')).toBeUndefined();
  });

  it('creates an auto-routed governed share instead of exposing a cached file', async () => {
    await expect(createChatMediaShare(file, 'conversation-1')).resolves.toEqual(payload);
    expect(mocks.request).toHaveBeenCalledWith('/api/shares/auto', 'POST', JSON.stringify({
      fileId: 'managed-file', conversationId: 'conversation-1', audience: 'friend'
    }));
  });

  it('rejects malformed responses and unavailable sources', async () => {
    mocks.request.mockResolvedValueOnce(JSON.stringify({ ok: true, payload: { share: { id: '', shareUrl: 'javascript:bad', reachability: 'public' } } }));
    await expect(createChatMediaShare(file, 'c')).rejects.toThrow('INVALID_SHARE_RESPONSE');
    await expect(createChatMediaShare({ ...file, fileId: undefined, uri: 'https://private.example/file' }, 'c'))
      .rejects.toThrow('SHARE_SOURCE_UNAVAILABLE');
  });

  it('hands only the public link and title to the system share panel', async () => {
    await shareChatLink({} as never, payload.share);
    expect(mocks.data).toHaveBeenCalledWith({ utd: 'general.plain-text', content: 'report.pdf\nhttps://share.example/s/token', title: 'report.pdf' });
    expect(mocks.show).toHaveBeenCalledOnce();
  });

  it('explains public, LAN and local-only reachability before sharing', () => {
    expect(shareReachabilityText(payload.share, false)).toBe('Publicly reachable');
    expect(shareReachabilityText({ ...payload.share, reachability: 'lan', reachabilityHint: 'Wi-Fi only' }, true))
      .toBe('仅同一局域网可访问\nWi-Fi only');
    expect(shareReachabilityText({ ...payload.share, reachability: 'local-only' }, true)).toBe('目前仅本机可访问');
  });
});
