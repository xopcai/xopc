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
});
