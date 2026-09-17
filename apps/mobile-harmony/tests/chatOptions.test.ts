import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { agents: vi.fn(), models: vi.fn(), config: vi.fn(), setModel: vi.fn(), queue: vi.fn(), changeQueued: vi.fn(), rememberModel: vi.fn() };
});
vi.mock('../entry/src/main/ets/repository/chatRepository.ets', () => ({ XopcChatRepository: class {
  agents = mock.agents; models = mock.models; config = mock.config; setModel = mock.setModel; queue = mock.queue; changeQueued = mock.changeQueued;
  rememberModel = mock.rememberModel;
} }));
import { XopcChatOptionsViewModel } from '../entry/src/main/ets/viewmodel/chatOptionsViewModel.ets';
const input = (id: string, position: number, status = 'queued') => ({ id, clientMessageId: id, content: id, version: 4, position, kind: 'message', status, effectiveDelivery: 'next' });
describe('chat options and queue', () => {
  beforeEach(() => {
    vi.resetAllMocks(); vi.useFakeTimers(); mock.agents.mockResolvedValue({ agents: [{ id: 'main', name: 'Main' }], defaultId: 'main' });
    mock.models.mockResolvedValue({ models: [{ id: 'p/a', name: 'A' }, { id: 'p/b', name: 'B' }] });
    mock.config.mockResolvedValue({ model: 'p/a' }); mock.queue.mockImplementation(async (id) => ({ conversationId: id, inputs: [] }));
  });
  afterEach(() => vi.useRealTimers());
  it('loads scoped models and does not change the displayed model after a failed save', async () => {
    const model = new XopcChatOptionsViewModel(); await model.load('one', 'main');
    expect(mock.models).toHaveBeenCalledWith('main'); expect(model.modelName('en')).toBe('A');
    mock.setModel.mockRejectedValue(new Error('save')); expect(await model.selectModel('p/b')).toBe(false);
    expect(model.modelId).toBe('p/a'); expect(model.error).toBe('save'); model.dispose();
  });
  it('filters and orders queued messages; never offers cancellation for running inputs', async () => {
    mock.queue.mockResolvedValue({ conversationId: 'one', inputs: [input('b', 2), input('running', 0, 'running'), input('a', 1)] });
    const model = new XopcChatOptionsViewModel(); await model.load('one');
    expect(model.queued.map(x => x.id)).toEqual(['a', 'b']); model.dispose();
  });
  it('remembers the selected model for this agent only after Gateway confirmation', async () => {
    const model = new XopcChatOptionsViewModel(); mock.config.mockResolvedValueOnce({ model: 'p/a', thinkingLevel: 'high' });
    await model.load('one', 'main'); expect(await model.selectModel('p/b')).toBe(true);
    expect(mock.rememberModel).toHaveBeenCalledWith('main', 'p/b', 'high'); model.dispose();
  });
  it('submits the queue version and refreshes after a conflict without pretending success', async () => {
    const model = new XopcChatOptionsViewModel(); await model.load('one'); mock.changeQueued.mockRejectedValue(new Error('HTTP_409'));
    const entry = input('one-input', 1); expect(await model.changeQueued(entry, 'edited')).toBe(false);
    expect(mock.changeQueued).toHaveBeenCalledWith('one', entry, 'edited'); expect(model.queueError).toBe('HTTP_409'); model.dispose();
  });
  it('rejects old conversation model/config results', async () => {
    let finish!: (value: unknown) => void; mock.config.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const model = new XopcChatOptionsViewModel(); const old = model.load('old');
    await vi.advanceTimersByTimeAsync(0); mock.config.mockResolvedValueOnce({ model: 'p/b' });
    await model.load('new'); finish({ model: 'p/a' }); await old; expect(model.modelId).toBe('p/b'); model.dispose();
  });
  it('polls while active and stops when the root is covered by a detail', async () => {
    const model = new XopcChatOptionsViewModel(); await model.load('one'); mock.queue.mockClear();
    await vi.advanceTimersByTimeAsync(15000); expect(mock.queue).toHaveBeenCalledOnce(); model.pause(); mock.queue.mockClear();
    await vi.advanceTimersByTimeAsync(30000); expect(mock.queue).not.toHaveBeenCalled(); model.dispose();
  });
});
