import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { history: vi.fn(), list: vi.fn(), activeRun: vi.fn(), send: vi.fn(), uuid: vi.fn() };
});
vi.mock('../entry/src/main/ets/repository/chatRepository.ets', () => ({ XopcChatRepository: class {
  history = mocks.history; list = mocks.list; activeRun = mocks.activeRun; send = mocks.send; uuid = mocks.uuid;
} }));
vi.mock('../entry/src/main/ets/service/realtimeClient.ets', () => ({ realtimeClient: { subscribe() {}, unsubscribe() {} } }));
import { XopcChatViewModel } from '../entry/src/main/ets/viewmodel/chatViewModel.ets';

const page = (id: string, text: string, before = '') => ({
  session: { key: id, name: id, transcriptId: id + '-transcript', messages: [{ role: 'assistant', content: text }] },
  pagination: { hasMore: !!before, nextBeforeCursor: before },
});
describe('chat history isolation', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.activeRun.mockResolvedValue({ active: false }); });
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
});
