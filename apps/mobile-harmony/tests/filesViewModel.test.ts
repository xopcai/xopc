import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { request: vi.fn(), upload: vi.fn() };
});

vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({
  gatewaySession: { request: mocks.request, currentProfile: () => undefined },
}));
vi.mock('../entry/src/main/ets/repository/chatRepository.ets', () => ({ XopcChatRepository: class {} }));
vi.mock('../entry/src/main/ets/service/fileTransfer.ets', () => ({
  XopcFileTransfer: class { upload = mocks.upload; },
}));

import { XopcFilesViewModel } from '../entry/src/main/ets/viewmodel/filesViewModel.ets';

const space = { id: 'workspace', title: 'Workspace', kind: 'workspace', writable: true };
const file = { id: 'report', spaceId: space.id, name: 'report.md' };
const directory = { id: 'src', spaceId: space.id, relativePath: 'src', kind: 'directory' };
const results = (...items: object[]) => JSON.stringify({ items });

describe('file list search', () => {
  beforeEach(() => {
    mocks.request.mockReset();
    mocks.upload.mockReset();
  });

  it('restores the current directory and ignores a superseded search response', async () => {
    const model = new XopcFilesViewModel();
    model.spaces = [space];
    mocks.request.mockResolvedValueOnce(results(file));
    await model.open(directory);

    let finishSearch!: (value: string) => void;
    let finishDirectory!: (value: string) => void;
    mocks.request
      .mockImplementationOnce(() => new Promise<string>(resolve => { finishSearch = resolve; }))
      .mockImplementationOnce(() => new Promise<string>(resolve => { finishDirectory = resolve; }));

    const searching = model.load(' report ');
    expect(model.clearSearch()).toBe(true);
    expect(mocks.request).toHaveBeenNthCalledWith(2, '/api/files/search?q=report&limit=50');
    expect(mocks.request).toHaveBeenNthCalledWith(3, '/api/files/spaces/workspace/children?path=src');

    finishSearch(results({ id: 'stale-search-result' }));
    await searching;
    expect(model.items).toEqual([]);
    expect(model.busy).toBe(true);

    finishDirectory(results(file));
    await vi.waitFor(() => expect(model.busy).toBe(false));
    expect(model.items).toEqual([file]);
  });

  it('keeps an upload in progress when search is cleared', async () => {
    const model = new XopcFilesViewModel();
    model.spaces = [space];
    model.space = space;
    mocks.request.mockResolvedValueOnce(results(file));
    await model.load('report');

    let finishUpload!: () => void;
    mocks.upload.mockImplementationOnce(() => new Promise<void>(resolve => { finishUpload = resolve; }));
    const uploading = model.upload({} as Parameters<XopcFilesViewModel['upload']>[0]);
    expect(model.clearSearch()).toBe(false);
    expect(model.busy).toBe(true);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    mocks.request.mockResolvedValueOnce(results(file));
    finishUpload();
    await uploading;
    expect(model.clearSearch()).toBe(true);
  });
});
