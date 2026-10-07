import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { agents: vi.fn(), models: vi.fn(), config: vi.fn(), draft: vi.fn(), setModel: vi.fn(), queue: vi.fn(),
    updateQueued: vi.fn(), cancelQueued: vi.fn(), retryPreparation: vi.fn(), rememberModel: vi.fn() };
});
vi.mock('../entry/src/main/ets/repository/chatRepository.ets', () => ({ XopcChatRepository: class {
  agents = mock.agents; models = mock.models; config = mock.config; draft = mock.draft; setModel = mock.setModel; queue = mock.queue;
  updateQueued = mock.updateQueued; cancelQueued = mock.cancelQueued; retryPreparation = mock.retryPreparation;
  rememberModel = mock.rememberModel;
} }));
import { XopcChatOptionsViewModel } from '../entry/src/main/ets/viewmodel/chatOptionsViewModel.ets';
const input = (id: string, position: number, status = 'queued') => ({ id, clientMessageId: id, content: id, version: 4, position,
  kind: 'message', status, requestedDelivery: 'next', effectiveDelivery: 'next' });
describe('chat options and queue', () => {
  beforeEach(() => {
    vi.resetAllMocks(); vi.useFakeTimers(); mock.agents.mockResolvedValue({ agents: [{ id: 'main', name: 'Main' }], defaultId: 'main' });
    mock.models.mockResolvedValue({ models: [{ id: 'p/a', name: 'A' }, { id: 'p/b', name: 'B' }] });
    mock.config.mockResolvedValue({ model: 'p/a' }); mock.draft.mockResolvedValue(undefined);
    mock.queue.mockImplementation(async (id) => ({ conversationId: id, inputs: [] }));
  });
  afterEach(() => vi.useRealTimers());
  it('loads scoped models and does not change the displayed model after a failed save', async () => {
    const model = new XopcChatOptionsViewModel(); await model.load('one', 'main');
    expect(mock.models).toHaveBeenCalledWith('main'); expect(model.modelName('en')).toBe('A');
    mock.setModel.mockRejectedValue(new Error('save')); expect(await model.selectModel('p/b')).toBe(false);
    expect(model.modelId).toBe('p/a'); expect(model.error).toBe('save'); model.dispose();
  });
  it('filters and orders queued messages; never offers cancellation for running inputs', async () => {
    mock.queue.mockResolvedValue({ conversationId: 'one', activeRunId: 'run-1', inputs: [input('b', 2), input('running', 0, 'running'), input('a', 1)] });
    const model = new XopcChatOptionsViewModel(); await model.load('one');
    expect(model.queued.map(x => x.id)).toEqual(['a', 'b']); model.dispose();
  });
  it('hides the pending turn during preparation but keeps later follow-ups visible', async () => {
    mock.queue.mockResolvedValue({ conversationId: 'one', preparation: { state: 'preparing' }, inputs: [input('later', 2), input('first', 1)] });
    const model = new XopcChatOptionsViewModel(); await model.load('one');
    expect(model.queued.map(x => x.id)).toEqual(['later']);
    mock.queue.mockResolvedValue({ conversationId: 'one', preparation: { state: 'preparation_failed' }, inputs: [input('later', 2), input('first', 1)] });
    await model.refreshQueue();
    expect(model.queued.map(x => x.id)).toEqual(['first', 'later']); model.dispose();
  });
  it('reorders follow-ups with the queue position API', async () => {
    mock.queue.mockResolvedValue({ conversationId: 'one', activeRunId: 'run-1', inputs: [input('a', 1), input('b', 2), input('c', 3)] });
    const model = new XopcChatOptionsViewModel(); await model.load('one');
    mock.updateQueued.mockResolvedValue({ conversationId: 'one', activeRunId: 'run-1', inputs: [input('b', 1), input('c', 2), input('a', 3)] });
    model.moveQueued(0, 2);
    expect(model.queued.map(x => x.id)).toEqual(['b', 'c', 'a']);
    expect(mock.updateQueued).toHaveBeenCalledWith('one', input('a', 1), { position: 2 });
    await vi.waitFor(() => expect(model.queueBusy).toBe(false)); model.dispose();
  });
  it('remembers the selected model for this agent only after Gateway confirmation', async () => {
    const model = new XopcChatOptionsViewModel(); mock.config.mockResolvedValueOnce({ model: 'p/a', thinkingLevel: 'high' });
    await model.load('one', 'main'); expect(await model.selectModel('p/b')).toBe(true);
    expect(mock.rememberModel).toHaveBeenCalledWith('main', 'p/b', 'high'); model.dispose();
  });
  it('keeps the local draft config frozen while catalogs load instead of querying a nonexistent server session', async () => {
    mock.draft.mockResolvedValueOnce({ conversationId: 'draft', createdAt: '2026-09-27T00:00:00.000Z', creation: {
      agentId: 'main', projectId: null, execution: null, temporary: false, model: 'p/b', thinkingLevel: 'high',
    } });
    const model = new XopcChatOptionsViewModel(); await model.load('draft', 'main');
    expect(mock.config).not.toHaveBeenCalled(); expect(model.modelId).toBe('p/b'); expect(model.error).toBe(''); model.dispose();
  });
  it('submits the queue version and refreshes after a conflict without pretending success', async () => {
    const model = new XopcChatOptionsViewModel(); await model.load('one'); mock.updateQueued.mockRejectedValue(new Error('HTTP_409'));
    const entry = input('one-input', 1); const update = { content: 'edited' };
    expect(await model.updateQueued(entry, update)).toBe(false);
    expect(mock.updateQueued).toHaveBeenCalledWith('one', entry, update); expect(model.queueError).toBe('HTTP_409'); model.dispose();
  });
  it('updates a queued rich message without requiring text', async () => {
    const model = new XopcChatOptionsViewModel(); await model.load('one');
    const entry = input('one-input', 1); const update = { content: '', attachments: [{
      type: 'image', name: 'photo.jpg', mimeType: 'image/jpeg', size: 10, data: 'bytes'
    }] };
    mock.updateQueued.mockResolvedValue({ conversationId: 'one', activeRunId: 'run-1', inputs: [{ ...entry, ...update, version: 5 }] });
    expect(await model.updateQueued(entry, update)).toBe(true);
    expect(model.queued[0].attachments?.[0].name).toBe('photo.jpg'); model.dispose();
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
