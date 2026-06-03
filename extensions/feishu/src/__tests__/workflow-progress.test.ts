import { describe, expect, it, vi } from 'vitest';

import { createFeishuWorkflowProgressCapability } from '../workflow-progress.js';

// `editMessageFeishu` builds its own FeishuClient internally; stubbing the
// module keeps the test honest about which call goes where without needing
// a fake Feishu SDK.
vi.mock('../outbound/actions.js', async () => {
  const actual = await vi.importActual<typeof import('../outbound/actions.js')>('../outbound/actions.js');
  return {
    ...actual,
    editMessageFeishu: vi.fn(),
  };
});

vi.mock('../state/accounts.js', async () => ({
  resolveFeishuAccount: () => ({
    accountId: 'default',
    enabled: true,
    configured: true,
    appId: 'cli_x',
    appSecret: 'sec',
    connectionMode: 'socket-mode' as const,
  }),
}));

vi.mock('../transport/client/client.js', () => {
  const createMock = vi.fn().mockResolvedValue({ data: { message_id: 'om_abc123' } });
  return {
    createFeishuClient: () => ({
      api: {
        im: {
          message: { create: createMock },
        },
      },
    }),
    /** Re-exported so individual tests can swap behaviour. */
    __createMock: createMock,
  };
});

import { editMessageFeishu } from '../outbound/actions.js';
import * as clientModule from '../transport/client/client.js';

const editMock = vi.mocked(editMessageFeishu);
const createMock = (clientModule as { __createMock: ReturnType<typeof vi.fn> }).__createMock;

const DM_SESSION = 'main:feishu:default:dm:ou_aa11bb22cc33dd44';
const GROUP_SESSION = 'main:feishu:default:group:oc_55ee66ff77gg88hh';

function mkCap() {
  return createFeishuWorkflowProgressCapability({
    getConfig: () => ({}) as never,
  });
}

describe('feishu workflow progress capability', () => {
  it('declares the expected channel defaults', () => {
    const cap = mkCap();
    expect(cap.channelId).toBe('feishu');
    expect(cap.supportsEdit).toBe(true);
    expect(cap.defaultMode).toBe('edit');
    expect(cap.defaultThrottleMs).toBeGreaterThanOrEqual(3_000);
  });

  it('sends with receive_id_type=open_id for DM targets', async () => {
    createMock.mockClear();
    editMock.mockClear();
    const cap = mkCap();
    const r = await cap.postProgress({
      sessionKey: DM_SESSION,
      text: 'workflow running…',
      isFinal: false,
    });
    expect(editMock).not.toHaveBeenCalled();
    const callArg = createMock.mock.calls[0][0] as any;
    expect(callArg.params.receive_id_type).toBe('open_id');
    expect(callArg.data.receive_id).toBe('ou_aa11bb22cc33dd44');
    expect(JSON.parse(callArg.data.content).text).toBe('workflow running…');
    expect(r.messageId).toBe('om_abc123');
  });

  it('sends with receive_id_type=chat_id for group targets', async () => {
    createMock.mockClear();
    const cap = mkCap();
    await cap.postProgress({
      sessionKey: GROUP_SESSION,
      text: 'hi',
      isFinal: false,
    });
    const callArg = createMock.mock.calls[0][0] as any;
    expect(callArg.params.receive_id_type).toBe('chat_id');
    expect(callArg.data.receive_id).toBe('oc_55ee66ff77gg88hh');
  });

  it('edits in place when previousMessageId is provided and not final', async () => {
    editMock.mockClear();
    createMock.mockClear();
    editMock.mockResolvedValueOnce({ ok: true });
    const cap = mkCap();
    const r = await cap.postProgress({
      sessionKey: DM_SESSION,
      text: 'updated',
      previousMessageId: 'om_prev',
      isFinal: false,
    });
    expect(editMock).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'om_prev', text: 'updated' }),
    );
    expect(createMock).not.toHaveBeenCalled();
    expect(r.messageId).toBe('om_prev');
  });

  it('always sends a fresh message for the final update', async () => {
    editMock.mockClear();
    createMock.mockClear();
    const cap = mkCap();
    await cap.postProgress({
      sessionKey: DM_SESSION,
      text: 'done',
      previousMessageId: 'om_prev',
      isFinal: true,
    });
    expect(editMock).not.toHaveBeenCalled();
    expect(createMock).toHaveBeenCalled();
  });

  it('swallows "not modified" edit errors and keeps id', async () => {
    editMock.mockClear();
    createMock.mockClear();
    editMock.mockRejectedValueOnce(new Error('error code 230009 message_not_modified'));
    const cap = mkCap();
    const r = await cap.postProgress({
      sessionKey: DM_SESSION,
      text: 'same',
      previousMessageId: 'om_prev',
      isFinal: false,
    });
    expect(r.messageId).toBe('om_prev');
    expect(createMock).not.toHaveBeenCalled();
  });

  it('falls back to send when the edit target is gone', async () => {
    editMock.mockClear();
    createMock.mockClear();
    editMock.mockRejectedValueOnce(new Error('error code 230002 message_not_found'));
    const cap = mkCap();
    const r = await cap.postProgress({
      sessionKey: DM_SESSION,
      text: 'rebuild',
      previousMessageId: 'om_prev',
      isFinal: false,
    });
    expect(createMock).toHaveBeenCalled();
    expect(r.messageId).toBe('om_abc123');
  });

  it('rethrows non-recoverable edit errors so the broker can log', async () => {
    editMock.mockClear();
    createMock.mockClear();
    editMock.mockRejectedValueOnce(new Error('99991 internal'));
    const cap = mkCap();
    await expect(
      cap.postProgress({
        sessionKey: DM_SESSION,
        text: 'x',
        previousMessageId: 'om_prev',
        isFinal: false,
      }),
    ).rejects.toThrow(/internal/);
  });

  it('throws when sessionKey is not feishu', async () => {
    const cap = mkCap();
    await expect(
      cap.postProgress({
        sessionKey: 'main:telegram:default:dm:123',
        text: 'x',
        isFinal: false,
      }),
    ).rejects.toThrow(/cannot route/);
  });

  it('clamps oversized text to Feishu limit', async () => {
    createMock.mockClear();
    editMock.mockClear();
    const cap = mkCap();
    await cap.postProgress({
      sessionKey: DM_SESSION,
      text: 'x'.repeat(10_000),
      isFinal: false,
    });
    const sent = createMock.mock.calls[0][0] as any;
    const content = JSON.parse(sent.data.content).text as string;
    expect(content.length).toBeLessThanOrEqual(4_000);
    expect(content.endsWith('…')).toBe(true);
  });
});
