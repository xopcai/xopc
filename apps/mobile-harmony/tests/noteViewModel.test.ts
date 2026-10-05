import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { list: vi.fn(), detail: vi.fn(), load: vi.fn(), initialize: vi.fn(), pending: vi.fn(), uuid: vi.fn() };
});
vi.mock('@kit.PerformanceAnalysisKit', () => ({ hilog: { warn: vi.fn() } }));
vi.mock('../entry/src/main/ets/repository/noteRepository.ets', () => ({ XopcNoteRepository: class {
  list = mocks.list;
  detail = mocks.detail;
} }));
vi.mock('../entry/src/main/ets/service/noteDraftStore.ets', () => ({ XopcNoteDraftStore: class {
  initialize = mocks.initialize;
  pending = mocks.pending;
  load = mocks.load;
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

  it('leaves the loading state when draft initialization fails', async () => {
    mocks.initialize.mockRejectedValueOnce(new Error('DRAFT_STORE_UNAVAILABLE'));
    const vm = new XopcNoteViewModel();
    await vm.start({} as never, 'recorded-note');
    expect(vm.openingId).toBe('');
    expect(vm.error).toBe('DRAFT_STORE_UNAVAILABLE');
  });
});
