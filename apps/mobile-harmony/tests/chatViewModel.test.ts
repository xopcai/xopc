import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { history: vi.fn(), list: vi.fn(), activeRun: vi.fn(), send: vi.fn(), uuid: vi.fn(),
    create: vi.fn(), mainConversation: vi.fn(), saveMainConversation: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() };
});
vi.mock('../entry/src/main/ets/repository/chatRepository.ets', () => ({ XopcChatRepository: class {
  history = mocks.history; list = mocks.list; activeRun = mocks.activeRun; send = mocks.send; uuid = mocks.uuid;
  create = mocks.create; mainConversation = mocks.mainConversation; saveMainConversation = mocks.saveMainConversation;
} }));
vi.mock('../entry/src/main/ets/service/realtimeClient.ets', () => ({ realtimeClient: {
  subscribe: mocks.subscribe, unsubscribe: mocks.unsubscribe, start() {}, turnClaim() {},
} }));
import { XopcChatViewModel } from '../entry/src/main/ets/viewmodel/chatViewModel.ets';
import { realtimeClient } from '../entry/src/main/ets/service/realtimeClient.ets';

const page = (id: string, text: string, before = '') => ({
  session: { key: id, name: id, transcriptId: id + '-transcript', messages: [{ role: 'assistant', content: text }] },
  pagination: { hasMore: !!before, nextBeforeCursor: before },
});
describe('chat history isolation', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.activeRun.mockResolvedValue({ active: false }); mocks.saveMainConversation.mockResolvedValue(undefined); });
  it('opens a requested conversation as the persistent main chat and switches run subscriptions', async () => {
    mocks.history.mockImplementation(async (id) => page(id, id));
    mocks.activeRun.mockImplementation(async (id) => ({ active: true, runId: id + '-run' }));
    const chat = new XopcChatViewModel(); chat.start('first', true);
    await vi.waitFor(() => expect(chat.runId).toBe('first-run'));
    await chat.open('second');
    expect(chat.selectedId).toBe('second'); expect(chat.rows[0].text).toBe('second');
    expect(mocks.unsubscribe).toHaveBeenCalledWith('run:first-run');
    expect(mocks.subscribe).toHaveBeenCalledWith('run:second-run');
    expect(mocks.saveMainConversation.mock.calls.map(call => call[0])).toEqual(['first', 'second']);
    expect(mocks.mainConversation).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
    chat.dispose();
  });
  it('does not let startup restoration overwrite an explicit conversation selection', async () => {
    let finish!: (id: string) => void;
    mocks.mainConversation.mockImplementation(() => new Promise<string>(resolve => { finish = resolve; }));
    mocks.history.mockImplementation(async id => page(id, id));
    const chat = new XopcChatViewModel(); chat.start();
    await chat.open('selected'); finish('previous');
    await Promise.resolve();
    expect(chat.selectedId).toBe('selected'); expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.saveMainConversation).toHaveBeenLastCalledWith('selected'); chat.dispose();
  });
  it('ignores startup restoration failure after the user has selected a conversation', async () => {
    let fail!: (error: Error) => void;
    mocks.mainConversation.mockImplementation(() => new Promise((_resolve, reject) => { fail = reject; }));
    mocks.history.mockImplementation(async id => page(id, id));
    const chat = new XopcChatViewModel(); chat.start();
    await chat.open('selected'); fail(new Error('OLD_STORE_ERROR')); await Promise.resolve();
    expect(chat.error).toBe(''); expect(chat.selectedId).toBe('selected'); chat.dispose();
  });
  it('clears the previous agent and project while the next history loads', async () => {
    let finish!: (value: unknown) => void;
    mocks.history.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const chat = new XopcChatViewModel(); chat.agentId = 'old-agent'; chat.projectId = 'old-project';
    const pending = chat.open('next');
    expect(chat.agentId).toBe(''); expect(chat.projectId).toBe('');
    finish(page('next', 'next')); await pending; chat.dispose();
  });
  it('does not let a late create clear the loading state of a selected conversation', async () => {
    let finishCreate!: (id: string) => void;
    let finishHistory!: (value: unknown) => void;
    mocks.create.mockImplementation(() => new Promise<string>(resolve => { finishCreate = resolve; }));
    mocks.history.mockImplementation(() => new Promise(resolve => { finishHistory = resolve; }));
    const chat = new XopcChatViewModel(); const creating = chat.create();
    const opening = chat.open('chosen'); finishCreate('late-created'); await creating;
    expect(chat.selectedId).toBe('chosen'); expect(chat.loading).toBe(true);
    finishHistory(page('chosen', 'chosen')); await opening;
    expect(chat.loading).toBe(false); chat.dispose();
  });
  it('keeps history usable and reports a local selection save failure', async () => {
    mocks.saveMainConversation.mockRejectedValue(new Error('STORE_UNAVAILABLE'));
    mocks.history.mockImplementation(async id => page(id, id));
    const chat = new XopcChatViewModel(); chat.start('chosen', true);
    await vi.waitFor(() => expect(chat.loading).toBe(false));
    expect(chat.selectedId).toBe('chosen'); expect(chat.rows[0].text).toBe('chosen');
    expect(chat.error).toBe('CHAT_SELECTION_SAVE_FAILED'); chat.dispose();
  });
  it('ignores a slow previous conversation when a new conversation is opened', async () => {
    let finish!: (value: unknown) => void;
    mocks.history.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const chat = new XopcChatViewModel(); const old = chat.open('old');
    mocks.history.mockResolvedValueOnce(page('new', 'new history'));
    await chat.open('new'); finish(page('old', 'old history')); await old;
    expect(chat.selectedId).toBe('new'); expect(chat.rows[0].text).toBe('new history');
    expect(chat.title).toBe('new'); expect(chat.loading).toBe(false);
  });
  it('deduplicates older-page requests and ignores stale pages after a new snapshot', async () => {
    const chat = new XopcChatViewModel(); mocks.history.mockResolvedValueOnce(page('one', 'initial', 'cursor'));
    await chat.open('one');
    let finish!: (value: unknown) => void;
    mocks.history.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const older = chat.loadHistory(true); await chat.loadHistory(true);
    expect(mocks.history).toHaveBeenCalledTimes(2);
    mocks.history.mockResolvedValueOnce(page('one', 'fresh'));
    await chat.loadHistory(false); finish(page('one', 'outdated older')); await older;
    expect(chat.rows.map((row) => row.text)).toEqual(['fresh']); expect(chat.hasOlder).toBe(false);
  });
  it('does not apply a response after the view is disposed', async () => {
    let finish!: (value: unknown) => void;
    mocks.history.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const chat = new XopcChatViewModel(); const loading = chat.open('one'); chat.dispose();
    finish(page('one', 'late')); await loading; expect(chat.rows).toEqual([]);
  });
  it('retries an attachment-only ambiguous send with the same message identity', async () => {
    const chat = new XopcChatViewModel(); chat.selectedId = 'one'; chat.connection = 'connected';
    mocks.uuid.mockReturnValue('input-1'); mocks.send.mockRejectedValueOnce(new Error('NETWORK')).mockResolvedValueOnce('run-1');
    const attachment = { type: 'document', name: 'a.txt', mimeType: 'text/plain', size: 1, data: 'YQ==' };
    expect(await chat.send('', [attachment])).toBe(false);
    expect(await chat.send('', [attachment])).toBe(true);
    expect(mocks.uuid).toHaveBeenCalledOnce();
    expect(mocks.send.mock.calls.map((call) => call[2])).toEqual(['input-1', 'input-1']);
    expect(mocks.send.mock.calls[1][4]).toEqual([attachment]); expect(chat.rows[0].text).toContain('a.txt');
  });
  it('uses a new input identity after changing an attachment', async () => {
    const chat = new XopcChatViewModel(); chat.selectedId = 'one'; chat.connection = 'connected';
    mocks.uuid.mockReturnValueOnce('input-1').mockReturnValueOnce('input-2'); mocks.send.mockRejectedValue(new Error('NETWORK'));
    const attachment = { type: 'document', name: 'a.txt', mimeType: 'text/plain', size: 1, data: 'YQ==' };
    await chat.send('same text', [attachment]); await chat.send('same text', [{ ...attachment, data: 'Yg==' }]);
    expect(mocks.send.mock.calls.map((call) => call[2])).toEqual(['input-1', 'input-2']);
  });
  it('restores the main conversation without creating a replacement', async () => {
    mocks.mainConversation.mockResolvedValue('main'); mocks.history.mockResolvedValue(page('main', 'saved'));
    const chat = new XopcChatViewModel(); chat.start();
    await vi.waitFor(() => expect(chat.loading).toBe(false));
    expect(chat.selectedId).toBe('main'); expect(mocks.create).not.toHaveBeenCalled(); chat.dispose();
  });
  it('does not create a replacement when local restoration fails', async () => {
    mocks.mainConversation.mockRejectedValue(new Error('STORE_UNAVAILABLE'));
    const chat = new XopcChatViewModel(); chat.start();
    await vi.waitFor(() => expect(chat.error).toBe('STORE_UNAVAILABLE'));
    expect(mocks.create).not.toHaveBeenCalled(); chat.dispose();
  });
  it('preserves root selection and hands realtime ownership back after detail', async () => {
    mocks.history.mockImplementation(async (id) => page(id, id));
    mocks.mainConversation.mockResolvedValue('main');
    mocks.activeRun.mockImplementation(async (id) => ({ active: true, runId: id + '-run' }));
    const root = new XopcChatViewModel(); root.start();
    await vi.waitFor(() => expect(root.runId).toBe('main-run'));
    const detail = new XopcChatViewModel(); detail.start('detail');
    await vi.waitFor(() => expect(detail.runId).toBe('detail-run'));
    expect(root.selectedId).toBe('main'); expect(mocks.unsubscribe).toHaveBeenCalledWith('run:main-run');
    detail.dispose(); root.activate();
    await vi.waitFor(() => expect(mocks.subscribe.mock.calls.at(-1)).toEqual(['run:main-run']));
    expect(root.rows[0].text).toBe('main'); root.dispose();
  });
  it('does not apply a late create after disposal', async () => {
    let finish!: (value: string) => void;
    mocks.create.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
    const chat = new XopcChatViewModel(); const creating = chat.create(); chat.dispose(); finish('late'); await creating;
    expect(chat.selectedId).toBe(''); expect(mocks.history).not.toHaveBeenCalled();
  });
  it('queues while running without resetting the live response or duplicating history', async () => {
    const chat = new XopcChatViewModel(); chat.selectedId = 'one'; chat.connection = 'connected'; chat.runId = 'run'; chat.streaming = 'in progress';
    mocks.uuid.mockReturnValue('queued'); mocks.send.mockResolvedValue('run');
    expect(await chat.send('next turn')).toBe(true); expect(chat.streaming).toBe('in progress'); expect(chat.rows).toEqual([]);
    expect(mocks.send.mock.calls[0][5]).toBe('next');
  });
  it('includes steer and references in the idempotent retry identity', async () => {
    const chat = new XopcChatViewModel(); chat.selectedId = 'one'; chat.connection = 'connected';
    mocks.uuid.mockReturnValueOnce('a').mockReturnValueOnce('b').mockReturnValueOnce('c'); mocks.send.mockRejectedValue(new Error('network'));
    await chat.send('text', [], 'next'); await chat.send('text', [], 'steer');
    const refs = [{ kind: 'note', sourceId: 'n', expectedVersion: '1' }]; await chat.send('text', [], 'steer', refs);
    expect(mocks.send.mock.calls.map(call => call[2])).toEqual(['a', 'b', 'c']); expect(mocks.send.mock.calls[2][6]).toEqual(refs);
  });
  it('sends a reference-only message', async () => {
    const chat = new XopcChatViewModel(); chat.selectedId = 'one'; chat.connection = 'connected';
    mocks.uuid.mockReturnValue('reference'); mocks.send.mockResolvedValue('run');
    expect(await chat.send('', [], 'next', [{ kind: 'task', sourceId: 't', expectedVersion: '2' }])).toBe(true);
  });
  it('does not erase streaming text when the queue changes on the same active run', async () => {
    const chat = new XopcChatViewModel(); chat.activate(); chat.selectedId = 'one'; chat.runId = 'run'; chat.streaming = 'live text';
    realtimeClient.onEvent({ topic: 'gateway', seq: 1, event: 'session.input-state', data: { conversationId: 'one', activeRunId: 'run', inputs: [] } });
    expect(chat.auxiliaryRevision).toBe(1); expect(chat.streaming).toBe('live text'); expect(mocks.history).not.toHaveBeenCalled(); chat.dispose();
  });
});
