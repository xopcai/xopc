import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { cachedList: vi.fn(), list: vi.fn(), detail: vi.fn(), load: vi.fn(), initialize: vi.fn(), pending: vi.fn(), uuid: vi.fn(), save: vi.fn(), remove: vi.fn(), create: vi.fn() };
});
vi.mock('@kit.PerformanceAnalysisKit', () => ({ hilog: { warn: vi.fn() } }));
vi.mock('../entry/src/main/ets/repository/noteRepository.ets', () => ({ XopcNoteRepository: class {
  cachedList = mocks.cachedList;
  list = mocks.list;
  detail = mocks.detail;
  create = mocks.create;
} }));
vi.mock('../entry/src/main/ets/service/noteDraftStore.ets', () => ({ XopcNoteDraftStore: class {
  initialize = mocks.initialize;
  pending = mocks.pending;
  load = mocks.load;
  save = mocks.save;
  remove = mocks.remove;
} }));
vi.mock('../entry/src/main/ets/service/deviceCrypto.ets', () => ({ XopcDeviceCrypto: class {
  uuid = mocks.uuid;
} }));
vi.mock('../entry/src/main/ets/service/noteMedia.ets', () => ({ XopcNoteMediaService: class {} }));

import { XopcNoteViewModel } from '../entry/src/main/ets/viewmodel/noteViewModel.ets';

const page = (ids: string[]) => ({ items: ids.map((id) => ({ id, title: id, updatedAt: 10 })), hasMore: false });

describe('native notes list', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.initialize.mockResolvedValue(undefined);
    mocks.pending.mockResolvedValue([]);
    mocks.list.mockResolvedValue(page(['first']));
    mocks.load.mockResolvedValue(undefined);
    mocks.save.mockResolvedValue(undefined);
    mocks.remove.mockResolvedValue(undefined);
    mocks.uuid.mockReturnValue("test-id");
    mocks.detail.mockResolvedValue({ id: 'recorded-note', title: 'Voice note', markdown: '', updatedAt: 10 });
  });

  it('starts the remote read while local drafts are initializing', async () => {
    let finishInitialization!: () => void;
    mocks.initialize.mockReturnValue(new Promise<void>((resolve) => { finishInitialization = resolve; }));
    const vm = new XopcNoteViewModel();
    const starting = vm.start({} as never);
    expect(mocks.list).toHaveBeenCalledOnce();
    expect(vm.loading).toBe(true);
    finishInitialization();
    await starting;
    expect(vm.items.map((item) => item.id)).toEqual(['first']);
  });

  it('shows a cached unfiltered page before the refresh completes', async () => {
    mocks.cachedList.mockReturnValueOnce(page(['cached']));
    let finish!: (result: ReturnType<typeof page>) => void;
    mocks.list.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const vm = new XopcNoteViewModel();
    const loading = vm.start({} as never);
    expect(vm.items.map((item) => item.id)).toEqual(['cached']);
    expect(vm.loading).toBe(true);
    finish(page(['latest']));
    await loading;
    expect(vm.items.map((item) => item.id)).toEqual(['latest']);
  });

  it('keeps existing notes visible on refresh failure and replaces them after retry', async () => {
    const vm = new XopcNoteViewModel();
    await vm.start({} as never);
    mocks.list.mockRejectedValueOnce(new Error('OFFLINE'));
    await vm.list();
    expect(vm.items.map((item) => item.id)).toEqual(['first']);
    expect(vm.error).toBe('OFFLINE');
    mocks.list.mockResolvedValueOnce(page(['second']));
    await vm.list();
    expect(vm.items.map((item) => item.id)).toEqual(['second']);
    expect(vm.error).toBe('');
    expect(mocks.list).toHaveBeenCalledTimes(3);
  });

  it('paginates by remote rows even when local drafts and overlapping pages are visible', async () => {
    mocks.pending.mockResolvedValueOnce([{
      noteId: 'local:draft', title: 'Draft', markdown: 'Unsynced note', updatedAt: 10,
    }]);
    mocks.list.mockResolvedValueOnce({ ...page(['first']), hasMore: true });
    const vm = new XopcNoteViewModel();
    await vm.start({} as never);

    vm.search = 'not yet submitted';
    mocks.list.mockResolvedValueOnce({ ...page(['first', 'second']), hasMore: true });
    await Promise.all([vm.list(true), vm.list(true)]);
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(mocks.list).toHaveBeenLastCalledWith('', '', 1, '');

    mocks.list.mockResolvedValueOnce(page(['third']));
    await vm.list(true);
    expect(mocks.list).toHaveBeenLastCalledWith('', '', 3, '');
    expect(vm.items.map((item) => item.id)).toEqual(['local:draft', 'first', 'second', 'third']);
    expect(vm.hasMore).toBe(false);
  });

  it('restores the unfiltered list when search closes before the search response', async () => {
    const vm = new XopcNoteViewModel();
    await vm.start({} as never);
    let finishSearch!: (result: ReturnType<typeof page>) => void;
    mocks.list.mockReturnValueOnce(new Promise((resolve) => { finishSearch = resolve; }));
    vm.search = 'match';
    const searching = vm.list(false, true);
    expect(mocks.list).toHaveBeenLastCalledWith('match', '', 0, '');
    vm.search = '';
    await vm.list(false, true);
    finishSearch(page(['filtered']));
    await searching;
    expect(mocks.list).toHaveBeenLastCalledWith('', '', 0, '');
    expect(vm.items.map((item) => item.id)).toEqual(['first']);
    expect(vm.loading).toBe(false);
  });

  it('waits for draft initialization when navigation opens a recorded note during startup', async () => {
    let finishInitialization!: () => void;
    mocks.initialize.mockReturnValue(new Promise<void>((resolve) => { finishInitialization = resolve; }));
    const vm = new XopcNoteViewModel();
    const starting = vm.start({} as never, 'recorded-note');
    const opening = vm.open('recorded-note');
    expect(mocks.detail).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();
    finishInitialization();
    await Promise.all([starting, opening]);
    expect(vm.selected?.id).toBe('recorded-note');
    expect(mocks.load).toHaveBeenCalledWith('recorded-note');
  });

  it('opens the new note editor without fetching a list or creating an empty remote note', async () => {
    const vm = new XopcNoteViewModel();
    await vm.start({} as never, '', '', 'project-1', false);
    vm.create();
    expect(vm.editing).toBe(true);
    expect(mocks.list).not.toHaveBeenCalled();
    await vm.closeEditor();
    expect(vm.editing).toBe(false);
    expect(vm.draft).toBeUndefined();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('reopens an existing unsynced draft when its remote note cannot be fetched', async () => {
    mocks.load.mockResolvedValueOnce({
      noteId: 'recorded-note', title: 'Offline', markdown: 'Local text', baseRevision: 3,
      updatedAt: 10, localVersion: 1, syncState: 'offline',
    });
    mocks.detail.mockRejectedValueOnce(new Error('OFFLINE'));
    const vm = new XopcNoteViewModel();
    await vm.start({} as never, 'recorded-note');
    expect(vm.draft?.markdown).toBe('Local text');
    expect(vm.editing).toBe(true);
    expect(vm.error).toBe('OFFLINE');
  });

  it('retains the conflict while persisting further local edits', async () => {
    mocks.load.mockResolvedValueOnce({
      noteId: 'recorded-note', title: 'Local', markdown: 'Original', baseRevision: 3,
      updatedAt: 10, localVersion: 1, syncState: 'dirty',
    });
    mocks.detail.mockResolvedValueOnce({ id: 'recorded-note', markdown: 'Remote', remoteVersion: 4 });
    const vm = new XopcNoteViewModel();
    await vm.start({} as never, 'recorded-note');
    vm.updateMarkdown('Further local edits');
    expect(vm.remoteConflict?.markdown).toBe('Remote');
    expect(vm.draft?.syncState).toBe('conflict');
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ markdown: 'Further local edits', syncState: 'conflict' }));
    expect(await vm.saveNow()).toBe(false);
  });

  it('leaves the loading state when draft initialization fails', async () => {
    mocks.initialize.mockRejectedValueOnce(new Error('DRAFT_STORE_UNAVAILABLE'));
    const vm = new XopcNoteViewModel();
    await vm.start({} as never, 'recorded-note');
    expect(vm.openingId).toBe('');
    expect(vm.error).toBe('DRAFT_STORE_UNAVAILABLE');
  });
});
