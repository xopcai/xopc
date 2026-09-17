import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { list: vi.fn(), action: vi.fn(), rename: vi.fn(), create: vi.fn(), gatewayId: 'gateway-a' };
});
vi.mock('../entry/src/main/ets/repository/chatRepository.ets', () => ({ XopcChatRepository: class {
  list = mock.list; action = mock.action; rename = mock.rename; create = mock.create;
} }));
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: {
  currentProfile: () => ({ gatewayId: mock.gatewayId }),
} }));
import { XopcSessionsViewModel } from '../entry/src/main/ets/viewmodel/sessionsViewModel.ets';

const item = (key: string, status = 'active') => ({ key, status, updatedAt: '2026-09-17T12:00:00Z', messageCount: 3 });
const page = (keys: string[], hasMore = false) => ({ items: keys.map(key => item(key)), total: 100, hasMore });
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { resolve, promise };
};
describe('native conversation manager', () => {
  beforeEach(() => {
    vi.resetAllMocks(); vi.useFakeTimers(); mock.gatewayId = 'gateway-a';
    mock.list.mockResolvedValue(page(['a', 'b'])); mock.action.mockResolvedValue(undefined); mock.rename.mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());
  it('queries all channels and advances raw offsets even when rows overlap', async () => {
    mock.list.mockResolvedValueOnce(page(['a', 'b'], true)).mockResolvedValueOnce(page(['b', 'c'], true)).mockResolvedValueOnce(page(['d']));
    const vm = new XopcSessionsViewModel(); await vm.load(); await vm.load(true); await vm.load(true);
    expect(mock.list.mock.calls).toEqual([['', 0, 20, ''], ['', 2, 20, ''], ['', 4, 20, '']]);
    expect(vm.items.map(x => x.key)).toEqual(['a', 'b', 'c', 'd']); expect(vm.hasMore).toBe(false);
  });
  it('debounces search and ignores the old response during the debounce window', async () => {
    const old = deferred<ReturnType<typeof page>>(); mock.list.mockReturnValueOnce(old.promise);
    const vm = new XopcSessionsViewModel(); const loading = vm.load(); vm.setSearch('n'); vm.setSearch(' new ');
    old.resolve(page(['old'])); await loading; expect(vm.items).toEqual([]);
    await vi.advanceTimersByTimeAsync(249); expect(mock.list).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(mock.list).toHaveBeenLastCalledWith('new', 0, 20, ''); expect(vm.loading).toBe(false);
  });
  it('submit cancels pending debounce and clearing search resets the query', async () => {
    const vm = new XopcSessionsViewModel(); vm.setSearch('term'); await vm.load();
    await vi.advanceTimersByTimeAsync(250); expect(mock.list).toHaveBeenCalledOnce();
    vm.setSearch(''); await vi.advanceTimersByTimeAsync(250); expect(mock.list).toHaveBeenLastCalledWith('', 0, 20, '');
  });
  it('prevents duplicate pagination and stops after an empty page', async () => {
    const vm = new XopcSessionsViewModel(); mock.list.mockResolvedValueOnce(page(['a'], true)); await vm.load();
    const next = deferred<ReturnType<typeof page>>(); mock.list.mockReturnValueOnce(next.promise);
    const pending = vm.load(true); await vm.load(true); expect(mock.list).toHaveBeenCalledTimes(2);
    next.resolve(page([], true)); await pending; expect(vm.hasMore).toBe(false);
  });
  it('keeps current rows on refresh failure and exposes a retryable error', async () => {
    const vm = new XopcSessionsViewModel(); await vm.load(); mock.list.mockRejectedValueOnce(new Error('OFFLINE'));
    await vm.load(); expect(vm.error).toBe('OFFLINE'); expect(vm.items).toHaveLength(2); expect(vm.loading).toBe(false);
    await vm.load(); expect(vm.error).toBe('');
  });
  it('only explicit selection changes the selected ids; search exits selection', async () => {
    const vm = new XopcSessionsViewModel(); await vm.load(); expect(vm.selecting).toBe(false);
    vm.select('a'); vm.select('b'); vm.select('a'); expect(vm.selected).toEqual(['b']);
    vm.cancelSelection(); expect(vm.selected).toEqual([]); vm.select('a'); vm.setSearch('b'); expect(vm.selecting).toBe(false);
  });
  it('retains selected later-page rows through refresh without corrupting the raw offset', async () => {
    const vm = new XopcSessionsViewModel(); mock.list.mockResolvedValueOnce(page(['a'], true)); await vm.load();
    mock.list.mockResolvedValueOnce(page(['later'], true)); await vm.load(true); vm.select('later');
    mock.list.mockResolvedValueOnce(page(['a'], true)); await vm.load();
    expect(vm.selectedItems().map(x => x.key)).toEqual(['later']);
    await vm.load(true); expect(mock.list).toHaveBeenLastCalledWith('', 1, 20, '');
  });
  it('keeps confirmed action results if the following read fails', async () => {
    const vm = new XopcSessionsViewModel(); await vm.load(); mock.list.mockRejectedValue(new Error('OFFLINE'));
    await vm.act([item('a')], 'archive'); expect(vm.items.find(x => x.key === 'a')?.status).toBe('archived');
    await vm.rename('a', 'Confirmed'); expect(vm.items.find(x => x.key === 'a')?.name).toBe('Confirmed');
    await vm.act([item('b')], 'delete'); expect(vm.items.some(x => x.key === 'b')).toBe(false); expect(vm.error).toBe('OFFLINE');
  });
  it('preserves only failed batch targets, including targets outside refreshed page one', async () => {
    const vm = new XopcSessionsViewModel(); await vm.load();
    mock.action.mockRejectedValueOnce(new Error('CONFLICT')).mockResolvedValueOnce(undefined);
    await vm.act([item('later'), item('a')], 'delete');
    expect(mock.action.mock.calls).toEqual([['later', 'delete'], ['a', 'delete']]);
    expect(vm.selected).toEqual(['later']); expect(vm.selecting).toBe(true); expect(vm.actionError).toBe('CONFLICT');
    expect(vm.selectedItems().map(x => x.key)).toEqual(['later']); expect(vm.busy).toBe(false);
  });
  it('toggles archive per row and skips already pinned rows for batch pin', async () => {
    const vm = new XopcSessionsViewModel(); await vm.act([item('a'), item('b', 'archived')], 'archive');
    expect(mock.action.mock.calls).toEqual([['a', 'archive'], ['b', 'unarchive']]);
    mock.action.mockClear(); await vm.act([item('a', 'pinned'), item('b'), item('b')], 'pin');
    expect(mock.action.mock.calls).toEqual([['b', 'pin']]); expect(vm.selecting).toBe(false);
  });
  it('locks concurrent mutations and preserves rename draft/selection after failure', async () => {
    const vm = new XopcSessionsViewModel(); await vm.load(); vm.select('a');
    const pending = deferred<void>(); mock.rename.mockReturnValueOnce(pending.promise);
    const saving = vm.rename('a', ' Name '); await vm.act([item('a')], 'delete'); vm.cancelSelection(); vm.setSearch('ignored');
    expect(mock.action).not.toHaveBeenCalled(); expect(vm.selected).toEqual(['a']); expect(vm.search).toBe('');
    pending.resolve(); expect(await saving).toBe(true); expect(mock.rename).toHaveBeenCalledWith('a', 'Name');
    vm.select('a'); mock.rename.mockRejectedValueOnce(new Error('INVALID_NAME'));
    expect(await vm.rename('a', 'new')).toBe(false); expect(vm.selected).toEqual(['a']); expect(vm.actionError).toBe('INVALID_NAME');
    expect(await vm.rename('a', '  ')).toBe(false); expect(mock.rename).toHaveBeenCalledTimes(2);
  });
  it('hides single deletes immediately and undo cancels the five-second write', async () => {
    const vm = new XopcSessionsViewModel(); await vm.load(); vm.scheduleDelete('a');
    expect(vm.hidden).toEqual(['a']); expect(vm.undoId).toBe('a'); await vi.advanceTimersByTimeAsync(4999);
    expect(mock.action).not.toHaveBeenCalled(); vm.undoDelete(); await vi.advanceTimersByTimeAsync(1);
    expect(mock.action).not.toHaveBeenCalled(); expect(vm.hidden).toEqual([]);
  });
  it('commits requested deletes after the deadline and restores failed deletes', async () => {
    const vm = new XopcSessionsViewModel(); await vm.load(); mock.action.mockRejectedValueOnce(new Error('DENIED'));
    vm.scheduleDelete('a'); await vi.advanceTimersByTimeAsync(5000);
    expect(mock.action).toHaveBeenCalledWith('a', 'delete'); expect(vm.hidden).toEqual([]); expect(vm.undoId).toBe(''); expect(vm.actionError).toBe('DENIED');
    vm.scheduleDelete('a'); vm.dispose(); await vi.advanceTimersByTimeAsync(5000); expect(mock.action).toHaveBeenCalledTimes(2);
  });
  it('never sends delayed or subsequent batch writes to a different Gateway', async () => {
    const vm = new XopcSessionsViewModel(); vm.scheduleDelete('later'); mock.gatewayId = 'gateway-b';
    await vi.advanceTimersByTimeAsync(5000); await vm.rename('a', 'new'); await vm.act([item('a')], 'delete');
    expect(mock.action).not.toHaveBeenCalled(); expect(mock.rename).not.toHaveBeenCalled();
    mock.gatewayId = 'gateway-a';
    const first = deferred<void>(); mock.action.mockReturnValueOnce(first.promise);
    const batch = vm.act([item('a'), item('b')], 'delete'); mock.gatewayId = 'gateway-b'; first.resolve(); await batch;
    expect(mock.action.mock.calls).toEqual([['a', 'delete']]);
  });
  it('ignores old reads and creates after disposal or Gateway switch', async () => {
    const vm = new XopcSessionsViewModel(); const result = deferred<ReturnType<typeof page>>(); mock.list.mockReturnValueOnce(result.promise);
    const loading = vm.load(); vm.dispose(); result.resolve(page(['late'])); await loading; expect(vm.items).toEqual([]);
    const next = new XopcSessionsViewModel(); const created = deferred<string>(); mock.create.mockReturnValueOnce(created.promise);
    const creating = next.newConversation(); mock.gatewayId = 'gateway-b'; created.resolve('new'); expect(await creating).toBe('');
  });
});
