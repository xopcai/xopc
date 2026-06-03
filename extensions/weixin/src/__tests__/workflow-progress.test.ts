import { describe, expect, it, vi } from 'vitest';

import { createWeixinWorkflowProgressCapability } from '../workflow-progress.js';

vi.mock('../auth/accounts.js', () => ({
  resolveWeixinAccount: () => ({
    accountId: 'default',
    enabled: true,
    configured: true,
    token: 'tok-x',
    baseUrl: 'https://example/weixin',
    routeTag: undefined,
  }),
}));

vi.mock('../messaging/inbound.js', () => ({
  getContextToken: vi.fn(),
  restoreContextTokens: vi.fn(),
}));

vi.mock('../messaging/context-token-init.js', () => ({
  ensureWeixinContextTokenForOutbound: vi.fn(),
}));

vi.mock('../messaging/send.js', async () => {
  const actual = await vi.importActual<typeof import('../messaging/send.js')>('../messaging/send.js');
  return {
    ...actual,
    sendMessageWeixin: vi.fn().mockResolvedValue({ messageId: 'weixin-1' }),
  };
});

import { getContextToken } from '../messaging/inbound.js';
import { ensureWeixinContextTokenForOutbound } from '../messaging/context-token-init.js';
import { sendMessageWeixin } from '../messaging/send.js';

const getCtxMock = vi.mocked(getContextToken);
const ensureMock = vi.mocked(ensureWeixinContextTokenForOutbound);
const sendMock = vi.mocked(sendMessageWeixin);

const SESSION = 'main:weixin:default:dm:ilink_user_abc';

function mkCap() {
  return createWeixinWorkflowProgressCapability({
    getConfig: () => ({}) as never,
  });
}

describe('weixin workflow progress capability', () => {
  it('declares final-only defaults (no editMessage on WeChat)', () => {
    const cap = mkCap();
    expect(cap.channelId).toBe('weixin');
    expect(cap.supportsEdit).toBe(false);
    expect(cap.defaultMode).toBe('final-only');
    expect(cap.defaultThrottleMs).toBeGreaterThanOrEqual(30_000);
  });

  it('sends the final message when a cached context token exists', async () => {
    getCtxMock.mockReturnValue('tok-cached');
    sendMock.mockClear();
    ensureMock.mockClear();
    const cap = mkCap();
    const r = await cap.postProgress({ sessionKey: SESSION, text: 'done', isFinal: true });
    expect(ensureMock).not.toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'ilink_user_abc',
        text: 'done',
        opts: expect.objectContaining({ contextToken: 'tok-cached' }),
      }),
    );
    expect(r.messageId).toBe('weixin-1');
  });

  it('hydrates a context token on demand when cache is empty', async () => {
    getCtxMock.mockReturnValue(undefined);
    ensureMock.mockResolvedValue('tok-hydrated');
    sendMock.mockClear();
    const cap = mkCap();
    await cap.postProgress({ sessionKey: SESSION, text: 'done', isFinal: true });
    expect(ensureMock).toHaveBeenCalled();
    const sendArg = sendMock.mock.calls[0][0];
    expect(sendArg.opts.contextToken).toBe('tok-hydrated');
  });

  it('returns an empty messageId without sending when no context token can be found', async () => {
    getCtxMock.mockReturnValue(undefined);
    ensureMock.mockResolvedValue(undefined);
    sendMock.mockClear();
    const cap = mkCap();
    const r = await cap.postProgress({ sessionKey: SESSION, text: 'done', isFinal: true });
    expect(sendMock).not.toHaveBeenCalled();
    expect(r.messageId).toBe('');
  });

  it('throws on unroutable sessionKey', async () => {
    const cap = mkCap();
    await expect(
      cap.postProgress({
        sessionKey: 'main:telegram:default:dm:123',
        text: 'x',
        isFinal: true,
      }),
    ).rejects.toThrow(/cannot route/);
  });

  it('clamps oversized text to WeChat limit', async () => {
    getCtxMock.mockReturnValue('tok');
    sendMock.mockClear();
    const cap = mkCap();
    await cap.postProgress({ sessionKey: SESSION, text: 'x'.repeat(10_000), isFinal: true });
    const text = sendMock.mock.calls[0][0].text;
    expect(text.length).toBeLessThanOrEqual(4_000);
    expect(text.endsWith('…')).toBe(true);
  });

  describe('append-mode message decoration', () => {
    it('prefixes mid-run append messages with "工作流进展" header', async () => {
      getCtxMock.mockReturnValue('tok');
      sendMock.mockClear();
      const cap = mkCap();
      await cap.postProgress({
        sessionKey: SESSION,
        text: 'Inventory done · Review running',
        isFinal: false,
        mode: 'append',
      });
      const text = sendMock.mock.calls[0][0].text;
      expect(text.startsWith('▾ 工作流进展\n')).toBe(true);
      expect(text).toContain('Inventory done · Review running');
    });

    it('prefixes final append message with "工作流完成" header', async () => {
      getCtxMock.mockReturnValue('tok');
      sendMock.mockClear();
      const cap = mkCap();
      await cap.postProgress({
        sessionKey: SESSION,
        text: 'Top findings (3): …',
        isFinal: true,
        mode: 'append',
      });
      const text = sendMock.mock.calls[0][0].text;
      expect(text.startsWith('✓ 工作流完成\n')).toBe(true);
      expect(text).toContain('Top findings (3): …');
    });

    it('does NOT add a header in final-only mode (existing behaviour preserved)', async () => {
      getCtxMock.mockReturnValue('tok');
      sendMock.mockClear();
      const cap = mkCap();
      await cap.postProgress({
        sessionKey: SESSION,
        text: 'Top findings (3): …',
        isFinal: true,
        mode: 'final-only',
      });
      const text = sendMock.mock.calls[0][0].text;
      expect(text).not.toContain('工作流');
      expect(text).toBe('Top findings (3): …');
    });

    it('does NOT add a header when mode is omitted (back-compat)', async () => {
      getCtxMock.mockReturnValue('tok');
      sendMock.mockClear();
      const cap = mkCap();
      await cap.postProgress({ sessionKey: SESSION, text: 'plain', isFinal: true });
      const text = sendMock.mock.calls[0][0].text;
      expect(text).toBe('plain');
    });
  });
});
