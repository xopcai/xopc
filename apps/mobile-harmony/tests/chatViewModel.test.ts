import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { history: vi.fn(), list: vi.fn(), activeRun: vi.fn(), send: vi.fn(), uuid: vi.fn(),
    replaceLatest: vi.fn(),
    create: vi.fn(), draft: vi.fn(), pendingInput: vi.fn(), reconcile: vi.fn(), mainConversation: vi.fn(), saveMainConversation: vi.fn(),
    subscribe: vi.fn(), unsubscribe: vi.fn(), cachedHistory: vi.fn(), rememberHistory: vi.fn() };
});
vi.mock('../entry/src/main/ets/repository/chatRepository.ets', () => ({ XopcChatRepository: class {
  history = mocks.history; list = mocks.list; activeRun = mocks.activeRun; send = mocks.send; uuid = mocks.uuid;
  replaceLatest = mocks.replaceLatest;
  create = mocks.create; draft = mocks.draft; pendingInput = mocks.pendingInput; reconcile = mocks.reconcile;
  mainConversation = mocks.mainConversation; saveMainConversation = mocks.saveMainConversation;
  cachedHistory = mocks.cachedHistory; rememberHistory = mocks.rememberHistory;
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
  it('prefetches only one older page silently and consumes it without another request', async () => {
    const chat = new XopcChatViewModel(); chat.connection = 'connected';
    mocks.history.mockResolvedValueOnce(page('one', 'latest', 'cursor'));
    await chat.open('one');
    let resolve!: (result: ReturnType<typeof page>) => void;
    mocks.history.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const visible = chat.rows;
    chat.prefetchOlder(); chat.prefetchOlder();
    expect(mocks.history).toHaveBeenCalledTimes(2); expect(chat.rows).toBe(visible); expect(chat.loading).toBe(false);
    const anchor = vi.fn(); const loading = chat.loadHistory(true, anchor);
    expect(anchor).not.toHaveBeenCalled();
    resolve(page('one', 'older')); await loading;
    expect(anchor).toHaveBeenCalledOnce(); expect(mocks.history).toHaveBeenCalledTimes(2);
    expect(chat.rows.map(row => row.text).join(' ')).toContain('older'); chat.dispose();
  });

  it('keeps speculative failures silent and retries when the page is actually requested', async () => {
    const chat = new XopcChatViewModel(); chat.connection = 'connected';
    mocks.history.mockResolvedValueOnce(page('one', 'latest', 'cursor')); await chat.open('one');
    mocks.history.mockRejectedValueOnce(new Error('NETWORK')); chat.prefetchOlder();
    await Promise.resolve(); expect(chat.error).toBe('');
    mocks.history.mockResolvedValueOnce(page('one', 'older')); await chat.loadHistory(true);
    expect(mocks.history).toHaveBeenCalledTimes(3); expect(chat.error).toBe(''); chat.dispose();
  });
  it('restores a persisted ambiguous request with its original retry identity', async () => {
    mocks.pendingInput.mockResolvedValue({ kind: 'append', clientMessageId: 'persisted', expectedTranscriptId: 't', delivery: 'steer',
      input: { content: 'saved', attachments: [{ type: 'audio', name: 'voice.m4a', mimeType: 'audio/mp4', size: 2, data: 'YQ==', durationSeconds: 2 }] } });
    mocks.history.mockResolvedValue({ session: { key: 'one', transcriptId: 't', messages: [] }, pagination: { hasMore: false } });
    const chat = new XopcChatViewModel(); chat.connection = 'connected'; await chat.open('one');
    expect(chat.rows).toMatchObject([{ id: 'persisted', text: 'saved', sendState: 'failed' }]);
    mocks.send.mockResolvedValue('run'); await chat.retrySend('persisted');
    expect(mocks.send).toHaveBeenCalledWith('one', 'saved', 'persisted', 't',
      [expect.objectContaining({ duration: 2, data: 'YQ==' })], 'steer', [], '');
    expect(mocks.uuid).not.toHaveBeenCalled(); expect(chat.rows).toHaveLength(1); chat.dispose();
  });

  it('does not move a failed bubble below newer messages when history confirms those messages', async () => {
    const chat = new XopcChatViewModel(); chat.selectedId = 'one'; chat.connection = 'connected';
    mocks.uuid.mockReturnValueOnce('failed').mockReturnValueOnce('new');
    mocks.send.mockRejectedValueOnce(new Error('NETWORK')).mockResolvedValueOnce('run');
    await chat.send('first'); await chat.send('second');
    mocks.history.mockResolvedValue({ session: { key: 'one', transcriptId: 't', messages: [
      { id: 'server', role: 'user', content: 'second', metadata: { clientMessageId: 'new' } },
    ] }, pagination: { hasMore: false } });
    await chat.loadHistory(false);
    expect(chat.rows.map(row => row.id)).toEqual(['failed', 'new']);
    expect(chat.rows[0].sendState).toBe('failed'); chat.dispose();
  });
  it('enqueues before HTTP completion and preserves the bubble through failed history refreshes', async () => {
    const chat = new XopcChatViewModel(); chat.selectedId = 'one'; chat.connection = 'connected';
    mocks.uuid.mockReturnValue('optimistic');
    let reject!: (error: Error) => void;
    mocks.send.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const enqueued = vi.fn(); const pending = chat.send('hello', [], 'next', [], enqueued);
    expect(enqueued).toHaveBeenCalledOnce();
    expect(chat.rows).toMatchObject([{ id: 'optimistic', text: 'hello', sendState: 'sending' }]);
    mocks.history.mockResolvedValue({ session: { key: 'one', transcriptId: 't', messages: [] }, pagination: { hasMore: false } });
    await chat.loadHistory(false);
    expect(chat.rows[0].sendState).toBe('sending');
    reject(new Error('NETWORK')); expect(await pending).toBe(false);
    expect(chat.rows[0].sendState).toBe('failed');
    expect(chat.error).toBe('NETWORK');
    await chat.loadHistory(false); expect(chat.rows).toHaveLength(1);
    expect(chat.rows[0].sendState).toBe('failed');
    chat.dispose();
  });
  it('keeps a follow-up out of the transcript until its queued turn starts', async () => {
    const chat = new XopcChatViewModel(); chat.selectedId = 'one'; chat.connection = 'connected'; chat.runId = 'current-run';
    mocks.uuid.mockReturnValue('follow-up');
    let accept!: (runId: string) => void;
    mocks.send.mockImplementationOnce(() => new Promise(resolve => { accept = resolve; }));
    const sending = chat.send('next question');
    expect(chat.rows).toEqual([]);
    mocks.history.mockResolvedValue({ session: { key: 'one', transcriptId: 't', messages: [] }, pagination: { hasMore: false } });
    await chat.loadHistory(false); expect(chat.rows).toEqual([]);
    accept('current-run'); expect(await sending).toBe(true); expect(chat.rows).toEqual([]);
    mocks.history.mockResolvedValue({ session: { key: 'one', transcriptId: 't', messages: [
      { id: 'server-follow-up', role: 'user', content: 'next question', metadata: { clientMessageId: 'follow-up' } },
    ] }, pagination: { hasMore: false } });
    await chat.loadHistory(false); expect(chat.rows.map(row => row.id)).toEqual(['follow-up']); chat.dispose();
  });
  it('shows a retryable message if queue submission fails', async () => {
    const chat = new XopcChatViewModel(); chat.selectedId = 'one'; chat.connection = 'connected'; chat.runId = 'current-run';
    mocks.uuid.mockReturnValue('failed-follow-up'); mocks.send.mockRejectedValue(new Error('NETWORK'));
    expect(await chat.send('next question')).toBe(false);
    expect(chat.rows).toMatchObject([{ id: 'failed-follow-up', sendState: 'failed' }]); chat.dispose();
  });

  it('retries the original payload in place after newer messages and deduplicates repeated taps', async () => {
    const chat = new XopcChatViewModel(); chat.selectedId = 'one'; chat.connection = 'connected';
    mocks.uuid.mockReturnValueOnce('failed').mockReturnValueOnce('new');
    mocks.send.mockRejectedValueOnce(new Error('NETWORK')).mockResolvedValueOnce('run');
    const file = { type: 'image', name: 'photo.png', mimeType: 'image/png', size: 1, data: 'YQ==' };
    const refs = [{ kind: 'note', sourceId: 'note', expectedVersion: 'v1' }];
    await chat.send('first', [file], 'next', refs);
    await chat.send('second');
    let resolve!: (run: string) => void;
    mocks.send.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const retry = chat.retrySend('failed');
    expect(await chat.retrySend('failed')).toBe(false);
    expect(chat.rows.map(row => row.id)).toEqual(['failed', 'new']);
    expect(chat.rows[0].sendState).toBe('sending');
    expect(mocks.send.mock.calls[2]).toEqual(mocks.send.mock.calls[0]);
    resolve('run'); expect(await retry).toBe(true);
    expect(chat.rows).toHaveLength(2); expect(chat.rows[0].sendState).toBe('sent');
    expect(mocks.uuid).toHaveBeenCalledTimes(2); chat.dispose();
  });

  it('does not mark a confirmed history message failed when its HTTP acknowledgement is lost', async () => {
    const chat = new XopcChatViewModel(); chat.selectedId = 'one'; chat.connection = 'connected';
    mocks.uuid.mockReturnValue('input-1');
    let reject!: (error: Error) => void;
    mocks.send.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const pending = chat.send('hello');
    mocks.history.mockResolvedValue(sentPage(true)); await chat.loadHistory(false);
    reject(new Error('TIMEOUT')); expect(await pending).toBe(true);
    expect(chat.rows).toHaveLength(1); expect(chat.rows[0].sendState).toBeUndefined();
    expect(await chat.retrySend('input-1')).toBe(false); chat.dispose();
  });
  it('keeps the execution slot on a direct final history response and later refreshes', async () => {
    const chat = new XopcChatViewModel(); chat.selectedId = 'one'; chat.connection = 'connected';
    mocks.uuid.mockReturnValue('input-activity'); mocks.send.mockResolvedValue('run');
    await chat.send('hello');
    const result = { session: { key: 'one', transcriptId: 't', messages: [
      { id: 'user-row', role: 'user', content: 'hello', metadata: { clientMessageId: 'input-activity' } },
      { id: 'assistant-row', role: 'assistant', content: 'done' },
    ] }, pagination: { hasMore: false } };
    mocks.history.mockResolvedValue(result); await chat.loadHistory(false);
    expect(chat.rows[1]).toMatchObject({ id: 'assistant-row', executionActivity: true });
    await chat.loadHistory(false);
    expect(chat.rows[1].executionActivity).toBe(true); chat.dispose();
  });

  it('keeps failed messages when switching conversations and isolates retry targets', async () => {
    const chat = new XopcChatViewModel(); chat.selectedId = 'one'; chat.connection = 'connected';
    mocks.uuid.mockReturnValue('failed'); mocks.send.mockRejectedValue(new Error('NETWORK'));
    await chat.send('first');
    mocks.history.mockImplementation(async id => ({ session: { key: id, messages: [] }, pagination: { hasMore: false } }));
    await chat.open('two'); expect(chat.rows).toEqual([]);
    expect(await chat.retrySend('failed')).toBe(false);
    await chat.open('one'); expect(chat.rows).toMatchObject([{ id: 'failed', sendState: 'failed' }]);
    chat.dispose();
  });

  it('creates an immediately retryable bubble offline and a distinct bubble for identical new input', async () => {
    const chat = new XopcChatViewModel(); chat.selectedId = 'one'; chat.connection = 'offline';
    mocks.uuid.mockReturnValueOnce('a').mockReturnValueOnce('b');
    const enqueued = vi.fn(); await chat.send('hello', [], 'next', [], enqueued);
    await chat.send('hello');
    expect(enqueued).toHaveBeenCalledOnce(); expect(mocks.send).not.toHaveBeenCalled();
    expect(chat.rows.map(row => [row.id, row.sendState])).toEqual([['a', 'failed'], ['b', 'failed']]);
    chat.dispose();
  });
  const sentPage = (confirmed: boolean, transcriptId = 't') => ({ session: { key: 'one', transcriptId,
    messages: confirmed ? [{ id: 'server-row', role: 'user', content: 'hello', metadata: { clientMessageId: 'input-1' } }] : [] },
    pagination: { hasMore: false } });
  it('retains an accepted message until history confirms it, even without an active run yet', async () => {
    const chat = new XopcChatViewModel(); chat.selectedId = 'one'; chat.connection = 'connected';
    mocks.uuid.mockReturnValue('input-1'); mocks.send.mockResolvedValue(''); mocks.history.mockResolvedValue(sentPage(false));
    expect(await chat.send('hello')).toBe(true);
    expect(chat.rows.map(row => row.id)).toEqual(['input-1']);
    await chat.loadHistory(false); expect(chat.rows.map(row => row.id)).toEqual(['input-1']);
    mocks.history.mockResolvedValue(sentPage(true)); await chat.loadHistory(false);
    expect(chat.rows.map(row => row.id)).toEqual(['input-1']); expect(chat.rows[0].text).toBe('hello');
    await chat.loadHistory(false); expect(chat.rows).toHaveLength(1); chat.dispose();
  });
  it('ignores a pre-acceptance history response that arrives after sending', async () => {
    const chat = new XopcChatViewModel(); chat.selectedId = 'one'; chat.connection = 'connected';
    let finish!: (value: ReturnType<typeof sentPage>) => void;
    mocks.history.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const stale = chat.loadHistory(false);
    mocks.uuid.mockReturnValue('input-1'); mocks.send.mockResolvedValue('run'); await chat.send('hello');
    finish(sentPage(false)); await stale;
    expect(chat.rows.map(row => row.id)).toEqual(['input-1']); expect(chat.runId).toBe('run'); chat.dispose();
  });
  it('does not duplicate a message when history confirms it before the send response', async () => {
    const chat = new XopcChatViewModel(); chat.selectedId = 'one'; chat.connection = 'connected';
    let finish!: (value: string) => void;
    mocks.uuid.mockReturnValue('input-1'); mocks.send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const sending = chat.send('hello');
    mocks.history.mockResolvedValue(sentPage(true)); await chat.loadHistory(false);
    finish('run'); await sending;
    expect(chat.rows.map(row => row.id)).toEqual(['input-1']); chat.dispose();
  });
  it('clears pending presentation rows on transcript reset and conversation switch', async () => {
    const chat = new XopcChatViewModel(); chat.selectedId = 'one'; chat.connection = 'connected';
    mocks.history.mockResolvedValue(sentPage(false)); await chat.loadHistory(false);
    mocks.uuid.mockReturnValue('input-1'); mocks.send.mockResolvedValue('run'); await chat.send('hello');
    mocks.history.mockResolvedValue(sentPage(false, 'reset')); await chat.loadHistory(false); expect(chat.rows).toEqual([]);
    await chat.send('hello');
    mocks.history.mockResolvedValue({ ...sentPage(false), session: { key: 'two', transcriptId: 'two-t', messages: [] } });
    await chat.open('two'); expect(chat.rows).toEqual([]); chat.dispose();
  });
  it('retains accepted attachments and references while history is behind or unavailable', async () => {
    const chat = new XopcChatViewModel(); chat.selectedId = 'one'; chat.connection = 'connected';
    mocks.uuid.mockReturnValue('input-1'); mocks.send.mockResolvedValue('run');
    const refs = [{ kind: 'note', sourceId: 'note', title: 'Notes' }];
    await chat.send('hello', [{ type: 'image', name: 'a.png', mimeType: 'image/png', size: 1, data: 'YQ==' }], 'next', refs);
    mocks.history.mockRejectedValueOnce(new Error('OFFLINE')); await chat.loadHistory(false);
    mocks.history.mockResolvedValue(sentPage(false)); await chat.loadHistory(false);
    expect(chat.rows[0].refs).toEqual(refs); expect(chat.rows[0].media?.[0].uri).toBe('data:image/png;base64,YQ==');
    chat.dispose();
  });
  it('releases loading after receipt lookup failure and allows history retry', async () => {
    mocks.reconcile.mockRejectedValueOnce(new Error('OFFLINE'));
    mocks.cachedHistory.mockResolvedValue(page('one', 'saved'));
    const chat = new XopcChatViewModel();
    await chat.open('one');
    expect(chat.loading).toBe(false);
    expect(chat.error).toBe('OFFLINE');
    mocks.history.mockResolvedValue(page('one', 'fresh'));
    mocks.activeRun.mockResolvedValue({ active: false });
    await chat.retryHistory();
    expect(chat.rows[0].text).toBe('fresh');
    chat.dispose();
  });
  it('seeds saved history while offline and replaces it with an authoritative response', async () => {
    mocks.cachedHistory.mockResolvedValue(page('one', 'saved')); mocks.history.mockRejectedValueOnce(new Error('OFFLINE'));
    const chat = new XopcChatViewModel(); await chat.open('one');
    expect(chat.rows[0].text).toBe('saved'); expect(chat.cachedHistory).toBe(true);
    chat.connection = 'connected'; expect(await chat.send('unsafe cached send')).toBe(false);
    mocks.history.mockResolvedValueOnce(page('one', 'fresh')); await chat.retryHistory();
    expect(chat.rows[0].text).toBe('fresh'); expect(chat.cachedHistory).toBe(false); chat.dispose();
  });
  it('never lets a delayed cache overwrite the network or another conversation', async () => {
    let resolve!: (value: ReturnType<typeof page>) => void;
    mocks.cachedHistory.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    mocks.history.mockResolvedValueOnce(page('one', 'fresh'));
    const chat = new XopcChatViewModel(); await chat.open('one'); resolve(page('one', 'stale')); await Promise.resolve();
    expect(chat.rows[0].text).toBe('fresh'); expect(chat.cachedHistory).toBe(false);
    mocks.cachedHistory.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    mocks.history.mockRejectedValueOnce(new Error('OFFLINE')); await chat.open('two');
    mocks.history.mockResolvedValueOnce(page('three', 'current')); await chat.open('three'); resolve(page('two', 'wrong')); await Promise.resolve();
    expect(chat.rows[0].text).toBe('current'); chat.dispose();
  });
  it.each(['reset', 'gap'])('does not stitch retained pages across a transcript %s', async reason => {
    const history = (ids: string[], transcriptId = 't') => ({ session: { key: 'one', transcriptId, messages: ids.map(id => ({ id, role: 'user', content: id })) }, pagination: { hasMore: true, nextBeforeCursor: ids[0] } });
    mocks.history.mockResolvedValueOnce(history(['3', '4']));
    const chat = new XopcChatViewModel(); await chat.open('one');
    mocks.history.mockResolvedValueOnce(history(['1', '2'])); await chat.loadHistory(true);
    mocks.history.mockResolvedValueOnce(history(reason === 'reset' ? ['3', '4'] : ['8', '9'], reason === 'reset' ? 'new' : 't'));
    await chat.loadHistory(false);
    expect(chat.rows.map(row => row.id)).toEqual(reason === 'reset' ? ['3', '4'] : ['8', '9']);
    chat.dispose();
  });
  it('retains loaded older pages and cursor when the latest page overlaps', async () => {
    const history = (ids: string[], cursor: string) => ({ session: { key: 'one', transcriptId: 't', messages: ids.map(id => ({ id, role: 'user', content: id })) }, pagination: { hasMore: !!cursor, nextBeforeCursor: cursor } });
    mocks.history.mockResolvedValueOnce(history(['3', '4'], 'older'));
    const chat = new XopcChatViewModel(); await chat.open('one');
    mocks.history.mockResolvedValueOnce(history(['1', '2', '3'], 'oldest')); await chat.loadHistory(true);
    mocks.history.mockResolvedValueOnce(history(['3', '4', '5'], 'head-cursor')); await chat.loadHistory(false);
    expect(chat.rows.map(row => row.id)).toEqual(['1', '2', '3', '4', '5']);
    mocks.history.mockResolvedValueOnce(history(['0'], '')); await chat.loadHistory(true);
    expect(mocks.history).toHaveBeenLastCalledWith('one', 'oldest', 't');
    expect(chat.rows.map(row => row.id)).toEqual(['0', '1', '2', '3', '4', '5']); chat.dispose();
  });
  beforeEach(() => { vi.resetAllMocks(); mocks.draft.mockResolvedValue(undefined); mocks.reconcile.mockResolvedValue(undefined);
    mocks.activeRun.mockResolvedValue({ active: false }); mocks.saveMainConversation.mockResolvedValue(undefined); mocks.rememberHistory.mockResolvedValue(undefined); });
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
  it('does not start a second recovery when an opening conversation becomes active', async () => {
    let finishReconcile!: () => void;
    mocks.reconcile.mockImplementationOnce(() => new Promise<void>(resolve => { finishReconcile = resolve; }));
    mocks.history.mockResolvedValue(page('selected', 'ready'));
    const chat = new XopcChatViewModel();
    const opening = chat.open('selected');
    await vi.waitFor(() => expect(mocks.reconcile).toHaveBeenCalledWith('selected'));
    chat.activate();
    await Promise.resolve();
    expect(mocks.history).not.toHaveBeenCalled();
    finishReconcile();
    await opening;
    expect(mocks.history).toHaveBeenCalledTimes(1);
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
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    finish(page('next', 'next')); await pending; chat.dispose();
  });
  it('preserves the selected draft agent when reconciliation materializes before history loads', async () => {
    mocks.draft.mockResolvedValueOnce({ conversationId: 'draft', createdAt: '2026-09-27T00:00:00.000Z', creation: {
      agentId: 'reviewer', projectId: null, execution: null, temporary: false, model: 'provider/model', thinkingLevel: 'off',
    } }).mockResolvedValueOnce(undefined);
    mocks.history.mockResolvedValue(page('draft', 'ready'));
    const chat = new XopcChatViewModel(); await chat.open('draft');
    expect(chat.agentId).toBe('reviewer'); expect(chat.rows[0].text).toBe('ready'); chat.dispose();
  });
  it('carries an explicit agent switch into the new local conversation', async () => {
    mocks.create.mockResolvedValue('draft');
    mocks.draft.mockResolvedValue({ conversationId: 'draft', createdAt: '2026-09-27T00:00:00.000Z', creation: {
      agentId: 'reviewer', projectId: 'project-a', execution: null, temporary: false, model: '', thinkingLevel: 'off',
    } });
    const chat = new XopcChatViewModel(); chat.projectId = 'project-a'; await chat.create('reviewer');
    expect(mocks.create).toHaveBeenCalledWith('project-a', 'reviewer', undefined);
    expect(chat.selectedId).toBe('draft'); expect(chat.agentId).toBe('reviewer'); chat.dispose();
  });
  it('does not let a late create clear the loading state of a selected conversation', async () => {
    let finishCreate!: (id: string) => void;
    let finishHistory!: (value: unknown) => void;
    mocks.create.mockImplementation(() => new Promise<string>(resolve => { finishCreate = resolve; }));
    mocks.history.mockImplementation(() => new Promise(resolve => { finishHistory = resolve; }));
    const chat = new XopcChatViewModel(); const creating = chat.create();
    const opening = chat.open('chosen'); finishCreate('late-created'); await creating;
    expect(chat.selectedId).toBe('chosen'); expect(chat.loading).toBe(true);
    await vi.waitFor(() => expect(finishHistory).toBeTypeOf('function'));
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
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
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
    const chat = new XopcChatViewModel(); const loading = chat.open('one');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    chat.dispose();
    finish(page('one', 'late')); await loading; expect(chat.rows).toEqual([]);
  });
  it('retries an attachment-only ambiguous send with the same message identity', async () => {
    const chat = new XopcChatViewModel(); chat.selectedId = 'one'; chat.connection = 'connected';
    mocks.uuid.mockReturnValue('input-1'); mocks.send.mockRejectedValueOnce(new Error('NETWORK')).mockResolvedValueOnce('run-1');
    const attachment = { type: 'document', name: 'a.txt', mimeType: 'text/plain', size: 1, data: 'YQ==' };
    expect(await chat.send('', [attachment])).toBe(false);
    expect(await chat.retrySend('input-1')).toBe(true);
    expect(mocks.uuid).toHaveBeenCalledOnce();
    expect(mocks.send.mock.calls.map((call) => call[2])).toEqual(['input-1', 'input-1']);
    expect(mocks.send.mock.calls[1][4]).toEqual([attachment]); expect(chat.rows[0].text).toBe('');
    expect(chat.rows[0].media?.[0]).toMatchObject({ name: 'a.txt', uri: 'data:text/plain;base64,YQ==' });
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
  it('replaces a stale persisted main conversation that the Gateway no longer has', async () => {
    mocks.mainConversation.mockResolvedValue('missing'); mocks.create.mockResolvedValue('replacement');
    mocks.history.mockRejectedValueOnce(Object.assign(new Error('HTTP_404'), { status: 404 }))
      .mockResolvedValueOnce(page('replacement', 'ready'));
    const chat = new XopcChatViewModel(); chat.start();
    await vi.waitFor(() => expect(chat.selectedId).toBe('replacement'));
    expect(mocks.saveMainConversation).toHaveBeenCalledWith('');
    expect(mocks.create).toHaveBeenCalledOnce(); expect(chat.rows[0].text).toBe('ready'); chat.dispose();
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
  it('queues while running without resetting the live response or showing an early bubble', async () => {
    const chat = new XopcChatViewModel(); chat.selectedId = 'one'; chat.connection = 'connected'; chat.runId = 'run'; chat.streaming = 'in progress';
    mocks.uuid.mockReturnValue('queued'); mocks.send.mockResolvedValue('run');
    expect(await chat.send('next turn')).toBe(true); expect(chat.streaming).toBe('in progress');
    expect(chat.rows).toEqual([]);
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
    expect(chat.rows[0].refs).toEqual([{ kind: 'task', sourceId: 't', expectedVersion: '2' }]);
  });
  it('replaces the latest turn and reloads authoritative history', async () => {
    const chat = new XopcChatViewModel(); chat.selectedId = 'one'; chat.connection = 'connected';
    mocks.replaceLatest.mockResolvedValue('replacement-run');
    mocks.history.mockResolvedValue({ session: { key: 'one', transcriptId: 't', messages: [
      { id: 'replacement', role: 'user', turnId: 'replacement-run', content: 'revised' },
    ] }, pagination: { hasMore: false } });
    expect(await chat.replaceLatest('old-turn', 'revised')).toBe(true);
    expect(mocks.replaceLatest).toHaveBeenCalledWith('one', 'old-turn', 'revised', [], []);
    expect(chat.rows).toMatchObject([{ text: 'revised', turnId: 'replacement-run' }]);
    expect(chat.runId).toBe('replacement-run'); chat.dispose();
  });
  it('shows an uploaded image immediately without adding its filename to message text', async () => {
    const chat = new XopcChatViewModel(); chat.selectedId = 'one'; chat.connection = 'connected';
    mocks.uuid.mockReturnValue('image-input'); mocks.send.mockResolvedValue('run');
    await chat.send('Look at this', [{ type: 'image', name: 'photo.png', mimeType: 'image/png', size: 1, data: 'YQ==' }]);
    expect(chat.rows[0]).toMatchObject({ text: 'Look at this', media: [{ type: 'image', uri: 'data:image/png;base64,YQ==' }] });
    chat.dispose();
  });
  it('does not erase streaming text when the queue changes on the same active run', async () => {
    const chat = new XopcChatViewModel(); chat.activate(); chat.selectedId = 'one'; chat.runId = 'run'; chat.streaming = 'live text';
    realtimeClient.onEvent({ topic: 'gateway', seq: 1, event: 'session.input-state', data: { conversationId: 'one', activeRunId: 'run', inputs: [] } });
    expect(chat.auxiliaryRevision).toBe(1); expect(chat.streaming).toBe('live text'); expect(mocks.history).not.toHaveBeenCalled(); chat.dispose();
  });
  it('does not switch a new send into history polling on its initial user boundary', () => {
    const chat = new XopcChatViewModel(); chat.activate(); chat.selectedId = 'one'; chat.runId = 'run';
    const event = (type: string, payload: object) => realtimeClient.onEvent({ topic: 'run:run', seq: 1, event: type,
      data: { conversationId: 'one', runId: 'run', payload } });
    event('run_start', {}); event('user_message', {});
    event('assistant_delta', { messageId: 'answer', delta: 'Hello', offset: 0 });
    expect(chat.liveRow?.text).toBe('Hello'); expect(mocks.history).not.toHaveBeenCalled(); chat.dispose();
  });
  it('retains terminal rich output when history refresh fails and replaces it after a successful retry', async () => {
    const chat = new XopcChatViewModel(); chat.activate(); chat.selectedId = 'one'; chat.runId = 'run';
    const event = (name: string, payload: object) => realtimeClient.onEvent({ topic: 'run:run', seq: 1, event: name,
      data: { conversationId: 'one', runId: 'run', payload } });
    event('thinking_delta', { delta: 'plan' }); event('assistant_delta', { delta: 'answer' });
    mocks.history.mockRejectedValueOnce(new Error('OFFLINE'));
    event('run_end', { status: 'cancelled' });
    await vi.waitFor(() => expect(chat.error).toBe('OFFLINE'));
    expect(chat.liveRow?.live).toBe(false); expect(chat.liveRow?.text).toBe('answer'); expect(chat.liveRow?.blocks?.[0].presentation).toBe('answer');
    mocks.history.mockResolvedValueOnce(page('one', 'answer')); await chat.loadHistory(false);
    expect(chat.liveRow).toBeUndefined(); expect(chat.rows[0].text).toBe('answer');
    expect(chat.rows[0].executionActivity).toBe(true); chat.dispose();
  });
  it('recovers ordered rich history on a gap without appending replayed deltas twice', async () => {
    vi.useFakeTimers();
    const chat = new XopcChatViewModel();
    try {
      chat.activate(); chat.selectedId = 'one'; chat.runId = 'run';
      const recovered = { session: { key: 'one', messages: [{ id: 'assistant', role: 'assistant', content: [
        { type: 'thinking', thinking: 'Inspect' }, { type: 'toolCall', id: 'call', name: 'read' }, { type: 'text', text: 'Answer' }] },
        { role: 'toolResult', toolCallId: 'call', content: 'Tool output' }] }, pagination: { hasMore: false } };
      mocks.history.mockResolvedValue(recovered); mocks.activeRun.mockResolvedValue({ active: true, runId: 'run' });
      realtimeClient.onGap('run:run'); await vi.advanceTimersByTimeAsync(0);
      expect(chat.rows[0].blocks?.map(block => block.kind)).toEqual(['thinking', 'tool', 'text']);
      expect(chat.rows[0].toolCalls?.[0].result).toBe('Tool output');
      for (let seq = 1; seq <= 3; seq++) realtimeClient.onEvent({ topic: 'run:run', seq, event: 'assistant_delta',
        data: { conversationId: 'one', runId: 'run', payload: { messageId: 'assistant', delta: 'Answer' } } });
      await vi.advanceTimersByTimeAsync(750);
      expect(mocks.history).toHaveBeenCalledTimes(2); expect(chat.rows[0].text).toBe('Answer'); expect(chat.liveRow).toBeUndefined();
    } finally { chat.dispose(); vi.useRealTimers(); }
  });
  it('keeps the partial rich projection visible when reconnect history is unavailable', async () => {
    const chat = new XopcChatViewModel(); chat.activate(); chat.selectedId = 'one'; chat.runId = 'run';
    realtimeClient.onEvent({ topic: 'run:run', seq: 1, event: 'assistant_delta',
      data: { conversationId: 'one', runId: 'run', payload: { delta: 'Partial answer' } } });
    mocks.history.mockRejectedValueOnce(new Error('OFFLINE')); mocks.activeRun.mockResolvedValue({ active: true, runId: 'run' });
    realtimeClient.onState('connected');
    await vi.waitFor(() => expect(chat.error).toBe('OFFLINE'));
    expect(chat.liveRow?.text).toBe('Partial answer'); expect(chat.runId).toBe('run'); chat.dispose();
  });
});
