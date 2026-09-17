import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { request: vi.fn(), read: vi.fn(), write: vi.fn(), gateway: 'one' };
});
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: {
  request: mocks.request, currentProfile: () => ({ gatewayId: mocks.gateway }),
} }));
vi.mock('../entry/src/main/ets/service/secureStore.ets', () => ({ XopcSecureStore: class { read = mocks.read; write = mocks.write; } }));
import { XopcChatAttentionViewModel, unseenAttention } from '../entry/src/main/ets/viewmodel/chatAttentionViewModel.ets';
import { parseHome } from '../entry/src/main/ets/common/homeProtocol.ets';
const item = { id: 'a', kind: 'failure', title: 'A', summary: 'Help', updatedAt: 1, secondaryActions: [] };

describe('chat attention parity', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.gateway = 'one'; });
  it('enriches approval details from the decision contract, not only the summary', () => {
    const home = parseHome(JSON.stringify({ needsUser: [{ ...item, primaryAction: { type: 'connector_decision', approvalId: 'approval' } }], background: [], decisions: [{ detail: 'Exact operation and destination', response: { approvalId: 'approval' } }] }));
    expect(home.needsUser[0].reviewDetail).toBe('Exact operation and destination');
  });
  it('persists dismissal per Gateway, resurfacing updated items and placing unseen first', async () => {
    const model = new XopcChatAttentionViewModel(); await model.activate(); await model.dismiss([item]);
    expect(mocks.write).toHaveBeenCalledWith('chat-attention:one', JSON.stringify([{ id: 'a', revision: '1' }]));
    expect(model.unseen([item])).toEqual([]);
    expect(model.unseen([{ ...item, updatedAt: 2 }])).toHaveLength(1);
    expect(model.ordered([item, { ...item, id: 'b' }]).map(i => i.id)).toEqual(['b', 'a']);
    mocks.gateway = 'two'; await model.activate(); expect(model.unseen([item])).toHaveLength(1);
  });
  it('does not hide changed legacy items or malformed persisted state', async () => {
    expect(unseenAttention([item], [{ id: 'a', revision: '2' }])).toHaveLength(1);
    mocks.read.mockResolvedValue('[null,{},"bad"]');
    const model = new XopcChatAttentionViewModel(); await model.activate(); expect(model.unseen([item])).toHaveLength(1);
    expect(model.ready).toBe(true);
  });
  it('ignores stale reads and stale action feedback after navigation', async () => {
    let resolve!: (value: string) => void;
    mocks.read.mockReturnValue(new Promise<string>(done => { resolve = done; }));
    const model = new XopcChatAttentionViewModel(); const reading = model.activate(); model.dispose();
    resolve('[{"id":"a","revision":"1"}]'); await reading;
    expect(model.ready).toBe(false); expect(model.seen).toEqual([]);
    mocks.read.mockResolvedValue(undefined); await model.activate();
    mocks.request.mockReturnValue(new Promise<string>(done => { resolve = done; }));
    const acting = model.act({ type: 'retry_run', label: 'Retry', runId: 'r', subjectKind: 'workflow_run' });
    model.dispose(); resolve('{}'); expect(await acting).toBe(false); expect(model.completed).toBe('');
  });
  it('deduplicates actions, sends exact decision contract, and retains failures for retry', async () => {
    const model = new XopcChatAttentionViewModel(); await model.activate();
    const action = { type: 'connector_decision', label: 'Approve', approvalId: 'a', decision: 'approve' };
    mocks.request.mockResolvedValue('{}');
    expect(await Promise.all([model.act(action), model.act(action)])).toEqual([true, false]);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request).toHaveBeenCalledWith('/api/home/decisions/respond', 'POST', JSON.stringify({ kind: 'connector_approval', approvalId: 'a', decision: 'approve' }));
    mocks.request.mockRejectedValue(new Error('CONFLICT')); expect(await model.act(action)).toBe(false);
    expect(model.error).toBe('CONFLICT'); expect(model.pending).toBe(false);
    mocks.request.mockClear(); await model.act({ type: 'invalid', label: 'Bad' }); expect(mocks.request).not.toHaveBeenCalled();
  });
});
