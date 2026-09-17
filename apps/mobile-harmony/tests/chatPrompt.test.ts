import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { request: vi.fn() };
});
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: { request: mock.request } }));
vi.mock('../entry/src/main/ets/service/deviceCrypto.ets', () => ({ XopcDeviceCrypto: class { uuid() { return randomUUID(); } } }));
import { XopcChatPromptViewModel } from '../entry/src/main/ets/viewmodel/chatPromptViewModel.ets';
const question = (conversationId = 'one') => ({ id: 'q-' + conversationId, conversationId, kind: 'clarification', status: 'open', question: 'Which?', choices: ['A', 'B'], version: 3 });
const snapshot = (value: unknown) => JSON.stringify({ payload: { clarification: value } });
describe('chat clarification', () => {
  let model: XopcChatPromptViewModel;
  beforeEach(() => { vi.useFakeTimers(); vi.resetAllMocks(); model = new XopcChatPromptViewModel(); mock.request.mockResolvedValue(snapshot(question())); });
  afterEach(() => { model.dispose(); vi.useRealTimers(); });
  it('keeps an ambiguous retry idempotent and carries the expected version', async () => {
    model.start('one'); await vi.advanceTimersByTimeAsync(0);
    mock.request.mockRejectedValueOnce(new Error('timeout')); await model.respond('answer', 'A');
    expect(model.prompt?.id).toBe('q-one'); expect(model.error).toBe('timeout');
    mock.request.mockResolvedValueOnce('{}'); await model.respond('answer', 'A');
    const posts = mock.request.mock.calls.filter(call => call[1] === 'POST');
    expect(posts).toHaveLength(2); expect(posts[0][2]).toBe(posts[1][2]);
    expect(JSON.parse(posts[0][2])).toMatchObject({ action: 'answer', answer: 'A', expectedVersion: 3 });
    expect(model.prompt).toBeUndefined();
  });
  it('rejects another conversation, resolved prompts, and expired answers', async () => {
    mock.request.mockResolvedValueOnce(snapshot(question('other'))); model.start('one'); await vi.advanceTimersByTimeAsync(0);
    expect(model.prompt).toBeUndefined();
    mock.request.mockResolvedValueOnce(snapshot({ ...question(), status: 'resolved' })); await model.refresh(); expect(model.prompt).toBeUndefined();
    mock.request.mockResolvedValue(snapshot({ ...question(), expiresAt: Date.now() + 50 })); await model.refresh();
    await vi.advanceTimersByTimeAsync(51); await model.respond('answer', 'A');
    expect(model.prompt).toBeUndefined(); expect(mock.request.mock.calls.some(call => call[1] === 'POST')).toBe(false);
  });
  it('does not let an old response remove a new conversation prompt', async () => {
    model.start('one'); await vi.advanceTimersByTimeAsync(0);
    let resolve!: (value: string) => void; mock.request.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const old = model.respond('agent_decide');
    mock.request.mockResolvedValue(snapshot(question('two'))); model.start('two'); await vi.advanceTimersByTimeAsync(0);
    expect(model.busy).toBe(false); resolve('{}'); await old; expect(model.prompt?.conversationId).toBe('two');
  });
  it('invalidates a pending refresh and stops polling while hidden', async () => {
    let resolve!: (value: string) => void; mock.request.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    model.start('one'); model.pause(); resolve(snapshot(question())); await vi.advanceTimersByTimeAsync(30000);
    expect(model.prompt).toBeUndefined(); expect(mock.request).toHaveBeenCalledOnce();
  });
});
