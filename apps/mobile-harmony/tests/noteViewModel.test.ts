import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { list: vi.fn(), initialize: vi.fn(), pending: vi.fn(), uuid: vi.fn() };
});
vi.mock('@kit.PerformanceAnalysisKit', () => ({ hilog: { warn: vi.fn() } }));
vi.mock('../entry/src/main/ets/repository/noteRepository.ets', () => ({ XopcNoteRepository: class {
  list = mocks.list;
} }));
vi.mock('../entry/src/main/ets/service/noteDraftStore.ets', () => ({ XopcNoteDraftStore: class {
  initialize = mocks.initialize;
  pending = mocks.pending;
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
});
