import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { request: vi.fn(), connectionRevision: vi.fn(), assertConnection: vi.fn() };
});
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: mocks }));

import { XopcPersonalAgentViewModel } from '../entry/src/main/ets/viewmodel/personalAgentViewModel.ets';

const record = { agentId: 'personal-1', conversationId: 'conversation-1', state: 'ready', displayName: 'Ada',
  appearance: 'loopi', errorMessage: null };

describe('Personal AI on HarmonyOS', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.connectionRevision.mockReturnValue(1); });

  it('loads the existing fixed conversation without creating a second one', async () => {
    mocks.request.mockResolvedValue(JSON.stringify({ ok: true, payload: record }));
    const model = new XopcPersonalAgentViewModel();
    await model.refresh();
    expect(await model.openOrCreate()).toEqual(record);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request).toHaveBeenCalledWith('/api/personal-agent');
  });

  it('creates once and reuses the returned conversation', async () => {
    mocks.request.mockResolvedValue(JSON.stringify({ ok: true, payload: record }));
    const model = new XopcPersonalAgentViewModel();
    expect(await model.openOrCreate()).toEqual(record);
    expect(await model.openOrCreate()).toEqual(record);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request).toHaveBeenCalledWith('/api/personal-agent', 'POST', '{}');
  });

  it('shares a pending creation between rapid taps', async () => {
    let finish!: (value: string) => void;
    mocks.request.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
    const model = new XopcPersonalAgentViewModel();
    const first = model.openOrCreate();
    const second = model.openOrCreate();
    finish(JSON.stringify({ ok: true, payload: record }));
    expect(await first).toEqual(record);
    expect(await second).toEqual(record);
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it('keeps the badge until the matching, visible transcript can acknowledge a loaded snapshot', async () => {
    const snapshot = { conversationId: record.conversationId, transcriptId: 'transcript-2', lastSeq: 12, unreadCount: 3 };
    const envelope = (payload: typeof snapshot) => JSON.stringify({ ok: true, payload });
    mocks.request.mockResolvedValue(envelope(snapshot));
    const model = new XopcPersonalAgentViewModel();

    await model.refreshUnread(() => undefined);
    await model.refreshUnread(() => ({ ...snapshot, transcriptId: 'transcript-1' }));
    expect(model.unreadSnapshot?.unreadCount).toBe(3);
    expect(mocks.request.mock.calls).toEqual([['/api/personal-agent/unread'], ['/api/personal-agent/unread']]);

    mocks.request.mockResolvedValueOnce(envelope(snapshot)).mockResolvedValueOnce(envelope({ ...snapshot, unreadCount: 1 }));
    await model.refreshUnread(() => ({ ...snapshot, lastSeq: 10 }));
    expect(mocks.request).toHaveBeenLastCalledWith('/api/personal-agent/read', 'POST',
      JSON.stringify({ transcriptId: 'transcript-2', lastSeq: 10 }));
    expect(model.unreadSnapshot?.unreadCount).toBe(1);
  });
});
