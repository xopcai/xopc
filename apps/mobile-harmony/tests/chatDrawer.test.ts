import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { list: vi.fn(), action: vi.fn(), request: vi.fn() };
});
vi.mock('../entry/src/main/ets/repository/chatRepository.ets', () => ({ XopcChatRepository: class { list = mock.list; action = mock.action; } }));
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: { request: mock.request } }));
import { XopcChatDrawerViewModel } from '../entry/src/main/ets/viewmodel/chatDrawerViewModel.ets';
import { groupChatSessions, sessionAge } from '../entry/src/main/ets/common/sessionGroups.ets';
const item = (key: string, updatedAt = '2026-09-17T10:00:00') => ({ key, updatedAt, messageCount: 1 });
describe('chat drawer', () => {
  beforeEach(() => vi.resetAllMocks());
  it('uses mobile relative-time boundaries and tolerates invalid/future timestamps', () => {
    const now = Date.parse('2026-09-17T12:00:00Z');
    for (const [minutes, unit, count] of [[-1, 'now', 0], [0, 'now', 0], [59, 'minute', 59], [60, 'hour', 1],
      [1440, 'day', 1], [10080, 'week', 1], [50400, 'date', 5]] as const) {
      expect(sessionAge(new Date(now - minutes * 60000).toISOString(), now)).toEqual({ unit, count });
    }
    expect(sessionAge('bad', now).unit).toBe('invalid');
  });
  it('matches the mobile calendar groups, including Monday boundaries and invalid dates', () => {
    const rows = [item('today'), item('yesterday', '2026-09-16'), item('week', '2026-09-14'), item('last', '2026-09-07'), item('month', '2026-09-01'), item('old', '2026-08-01'), item('bad', 'bad')];
    expect(groupChatSessions(rows, new Date('2026-09-17T12:00:00')).map(g => g.id))
      .toEqual(['today', 'yesterday', 'this_week', 'last_week', 'this_month', '2026-08', 'earlier']);
  });
  it('deduplicates items without using the deduplicated length as the next page offset', async () => {
    mock.list.mockResolvedValueOnce({ items: [item('a'), item('b')], total: 5, hasMore: true })
      .mockResolvedValueOnce({ items: [item('b'), item('c')], total: 5, hasMore: true })
      .mockResolvedValueOnce({ items: [item('d')], total: 5, hasMore: false });
    const model = new XopcChatDrawerViewModel(); await model.load(); await model.load('', true); await model.load('', true);
    expect(model.items.map(x => x.key)).toEqual(['a', 'b', 'c', 'd']);
    expect(mock.list.mock.calls.map(call => call[1])).toEqual([0, 2, 4]); expect(model.total).toBe(5);
  });
  it('search replaces an in-flight request and rejects its late response', async () => {
    let finish!: (value: unknown) => void;
    mock.list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const model = new XopcChatDrawerViewModel(); const old = model.load('old');
    mock.list.mockResolvedValueOnce({ items: [item('new')], total: 1, hasMore: false });
    await model.load('new'); finish({ items: [item('old')], total: 1, hasMore: false }); await old;
    expect(model.items[0].key).toBe('new'); expect(model.loading).toBe(false);
  });
  it('opens directly into history', async () => {
    mock.list.mockResolvedValue({ items: [item('a')], total: 1, hasMore: false });
    const model = new XopcChatDrawerViewModel(); await model.open(); expect(model.items).toHaveLength(1); expect(model.error).toBe('');
    expect(mock.request).not.toHaveBeenCalled();
  });
  it('closing the drawer rejects late responses', async () => {
    let finish!: (value: unknown) => void; mock.list.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const model = new XopcChatDrawerViewModel(); const pending = model.load(); model.dispose();
    finish({ items: [item('a')], total: 1, hasMore: false }); await pending; expect(model.items).toEqual([]);
  });
  it('updates pin state and removes deleted rows after successful drawer actions', async () => {
    mock.list.mockResolvedValue({ items: [item('a'), item('b')], total: 2, hasMore: false });
    mock.action.mockResolvedValue(undefined);
    const model = new XopcChatDrawerViewModel(); await model.load();
    expect(await model.action(model.items[0], 'pin')).toBe(true);
    expect(model.items[0].status).toBe('pinned');
    expect(await model.action(model.items[1], 'delete')).toBe(true);
    expect(model.items.map(row => row.key)).toEqual(['a']); expect(model.total).toBe(1);
    expect(mock.action.mock.calls).toEqual([['a', 'pin'], ['b', 'delete']]);
  });
  it('keeps the row and exposes an action error when a drawer mutation fails', async () => {
    mock.list.mockResolvedValue({ items: [item('a')], total: 1, hasMore: false });
    mock.action.mockRejectedValue(new Error('denied'));
    const model = new XopcChatDrawerViewModel(); await model.load();
    expect(await model.action(model.items[0], 'delete')).toBe(false);
    expect(model.items).toHaveLength(1); expect(model.actionError).toBe('denied'); expect(model.busy).toBe(false);
  });
});
