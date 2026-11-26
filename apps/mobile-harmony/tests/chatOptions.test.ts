import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { agents: vi.fn(), models: vi.fn(), config: vi.fn(), draft: vi.fn(), setModel: vi.fn(), inputState: vi.fn(), retryPreparation: vi.fn(), rememberModel: vi.fn(), request: vi.fn() };
});
vi.mock('../entry/src/main/ets/repository/chatRepository.ets', () => ({ XopcChatRepository: class {
  agents = mock.agents; models = mock.models; config = mock.config; draft = mock.draft; setModel = mock.setModel; inputState = mock.inputState;
  retryPreparation = mock.retryPreparation;
  rememberModel = mock.rememberModel;
} }));
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: { request: mock.request } }));
import { XopcChatOptionsViewModel } from '../entry/src/main/ets/viewmodel/chatOptionsViewModel.ets';
describe('chat options and preparation', () => {
  beforeEach(() => {
    vi.resetAllMocks(); vi.useFakeTimers(); mock.agents.mockResolvedValue({ agents: [{ id: 'main', name: 'Main' }], defaultId: 'main' });
    mock.models.mockResolvedValue({ models: [{ id: 'p/a', name: 'A' }, { id: 'p/b', name: 'B' }] });
    mock.config.mockResolvedValue({ model: 'p/a' }); mock.draft.mockResolvedValue(undefined);
    mock.inputState.mockImplementation(async (id) => ({ conversationId: id }));
  });
  afterEach(() => vi.useRealTimers());
  it('loads scoped models and does not change the displayed model after a failed save', async () => {
    const model = new XopcChatOptionsViewModel(); await model.load('one', 'main');
    expect(mock.models).toHaveBeenCalledWith('main'); expect(model.modelName('en')).toBe('A');
    mock.setModel.mockRejectedValue(new Error('save')); expect(await model.selectModel('p/b')).toBe(false);
    expect(model.modelId).toBe('p/a'); expect(model.error).toBe('save'); model.dispose();
  });
  it('switches a failed Worktree preparation while keeping the original queued input', async () => {
    const model = new XopcChatOptionsViewModel();
    const preparation = { operationId: 'operation', revision: 3, state: 'preparation_failed', executionMode: 'managed_worktree' };
    mock.inputState.mockResolvedValue({ conversationId: 'one', preparation });
    await model.load('one');
    expect(model.preparationError).toBe('SESSION_PREPARATION_FAILED');
    mock.retryPreparation.mockResolvedValue(undefined);
    mock.inputState.mockResolvedValue({ conversationId: 'one', preparation: {
      ...preparation, state: 'preparing', executionMode: 'local_checkout',
    } });
    await model.retryPreparation(true);
    expect(mock.retryPreparation).toHaveBeenCalledExactlyOnceWith('one', 'operation', 3, 'local_checkout');
    expect(model.preparation?.executionMode).toBe('local_checkout');
    expect(model.preparationError).toBe('');
    model.dispose();
  });
  it('remembers the selected model for this agent only after Gateway confirmation', async () => {
    const model = new XopcChatOptionsViewModel(); mock.config.mockResolvedValueOnce({ model: 'p/a', thinkingLevel: 'high' });
    await model.load('one', 'main'); expect(await model.selectModel('p/b')).toBe(true);
    expect(mock.rememberModel).toHaveBeenCalledWith('main', 'p/b', 'high'); model.dispose();
  });
  it('saves the personal conversation model and thinking with the latest config revision', async () => {
    mock.models.mockResolvedValue({ models: [
      { id: 'p/a', name: 'A' },
      { id: 'p/b', name: 'B', thinking: { mode: 'levels', options: ['low', 'high'], initialValue: 'low' } },
    ] });
    mock.config.mockResolvedValue({ model: 'p/a', thinkingLevel: 'off', configVersion: 7 });
    mock.setModel.mockResolvedValueOnce({ model: 'p/b', thinkingLevel: 'low', configVersion: 8 });
    mock.setModel.mockResolvedValueOnce({ model: 'p/b', thinkingLevel: 'high', configVersion: 9 });
    const model = new XopcChatOptionsViewModel();
    await model.load('personal-chat', 'personal-agent');
    expect(await model.selectModel('p/b', false)).toBe(true);
    expect(await model.selectThinking('high', false)).toBe(true);
    expect(mock.setModel).toHaveBeenNthCalledWith(1, 'personal-chat', 'p/b', 'low', 7);
    expect(mock.setModel).toHaveBeenNthCalledWith(2, 'personal-chat', 'p/b', 'high', 8);
    expect(mock.rememberModel).not.toHaveBeenCalled();
    expect(model.thinkingLevel).toBe('high');
    model.dispose();
  });
  it('keeps the local draft config frozen while catalogs load instead of querying a nonexistent server session', async () => {
    mock.draft.mockResolvedValueOnce({ conversationId: 'draft', createdAt: '2026-09-27T00:00:00.000Z', creation: {
      agentId: 'main', projectId: null, execution: null, temporary: false, model: 'p/b', thinkingLevel: 'high',
    } });
    const model = new XopcChatOptionsViewModel(); await model.load('draft', 'main');
    expect(mock.config).not.toHaveBeenCalled(); expect(model.modelId).toBe('p/b'); expect(model.error).toBe(''); model.dispose();
  });
  it('rejects old conversation model/config results', async () => {
    let finish!: (value: unknown) => void; mock.config.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const model = new XopcChatOptionsViewModel(); const old = model.load('old');
    await vi.advanceTimersByTimeAsync(0); mock.config.mockResolvedValueOnce({ model: 'p/b' });
    await model.load('new'); finish({ model: 'p/a' }); await old; expect(model.modelId).toBe('p/b'); model.dispose();
  });
  it('polls while active and stops when the root is covered by a detail', async () => {
    const model = new XopcChatOptionsViewModel(); await model.load('one'); mock.inputState.mockClear();
    await vi.advanceTimersByTimeAsync(15000); expect(mock.inputState).toHaveBeenCalledOnce(); model.pause(); mock.inputState.mockClear();
    await vi.advanceTimersByTimeAsync(30000); expect(mock.inputState).not.toHaveBeenCalled(); model.dispose();
  });
});
