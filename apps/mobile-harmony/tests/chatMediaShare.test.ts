import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn(), access: vi.fn(), mkdir: vi.fn(), listFile: vi.fn(), stat: vi.fn(), unlink: vi.fn(), open: vi.fn(), write: vi.fn(), close: vi.fn(), show: vi.fn(), data: vi.fn(), assertConnection: vi.fn() }));
vi.mock('@kit.AbilityKit', () => ({}));
vi.mock('@kit.CoreFileKit', () => ({ fileIo: { ...mocks, OpenMode: { CREATE: 1, WRITE_ONLY: 2, EXCL: 4 } }, fileUri: { getUriFromPath: (path: string) => 'file://' + path } }));
vi.mock('@kit.ArkTS', () => ({ util: { generateRandomUUID: () => '00000000-0000-4000-8000-000000000001' } }));
vi.mock('@kit.ArkData', () => ({ uniformTypeDescriptor: { UniformDataType: { FILE: 'general.file' }, getUniformDataTypeByMIMEType: () => 'general.image' } }));
vi.mock('@kit.ShareKit', () => ({ systemShare: { SharedData: class { constructor(data: unknown) { mocks.data(data); } }, ShareController: class { show = mocks.show; }, SelectionMode: { SINGLE: 1 }, SharePreviewMode: { DEFAULT: 0 } } }));
vi.mock('../entry/src/main/ets/service/chatMedia.ets', () => ({ readChatMedia: mocks.read }));
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: { connectionRevision: () => 1, assertConnection: mocks.assertConnection } }));
import { shareChatMedia } from '../entry/src/main/ets/service/chatMediaShare.ets';
const context = { cacheDir: '/sandbox/cache' } as never;
const file = { id: 'f', name: '../photo.png', mimeType: 'image/png', uri: 'xopc-file:f', size: 5, type: 'image' };
describe('chat file share handoff', () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.read.mockResolvedValue(new ArrayBuffer(5)); mocks.access.mockResolvedValue(true);
    mocks.listFile.mockResolvedValue([]); mocks.open.mockResolvedValue({ fd: 9 }); mocks.write.mockResolvedValue(5);
  });
  it('shares only a sandbox URI and keeps the file for the receiving app', async () => {
    await shareChatMedia(context, file, 'c');
    expect(mocks.open.mock.calls[0][0]).toBe('/sandbox/cache/chat-shares/00000000-0000-4000-8000-000000000001_.._photo.png');
    expect(mocks.data.mock.calls[0][0].uri).toMatch(/^file:\/\/\/sandbox\/cache\/chat-shares\//);
    expect(mocks.data.mock.calls[0][0].uri).not.toContain('xopc-file:');
    expect(mocks.close).toHaveBeenCalledWith({ fd: 9 }); expect(mocks.unlink).not.toHaveBeenCalled();
  });
  it('cleans only the newly created file after failed handoff or incomplete write', async () => {
    mocks.write.mockResolvedValueOnce(2);
    await expect(shareChatMedia(context, file, 'c')).rejects.toThrow('INCOMPLETE_MEDIA');
    expect(mocks.close).toHaveBeenCalledWith({ fd: 9 }); expect(mocks.unlink).toHaveBeenCalledOnce(); expect(mocks.show).not.toHaveBeenCalled();
    mocks.show.mockRejectedValueOnce(new Error('NO_SHARE_SERVICE'));
    await expect(shareChatMedia(context, file, 'c')).rejects.toThrow('NO_SHARE_SERVICE');
    expect(mocks.unlink).toHaveBeenCalledTimes(2);
  });
  it('does not create files or open the panel when download or connection validation fails', async () => {
    mocks.read.mockRejectedValueOnce(new Error('OFFLINE'));
    await expect(shareChatMedia(context, file, 'c')).rejects.toThrow('OFFLINE');
    mocks.assertConnection.mockImplementationOnce(() => { throw new Error('OPERATION_CANCELLED'); });
    await expect(shareChatMedia(context, file, 'c')).rejects.toThrow('OPERATION_CANCELLED');
    expect(mocks.open).not.toHaveBeenCalled(); expect(mocks.show).not.toHaveBeenCalled();
  });
  it('prunes only expired owned files and refuses to evict active handoffs at capacity', async () => {
    const owned = '00000000-0000-4000-8000-000000000002_old.png';
    mocks.listFile.mockResolvedValueOnce([owned, 'unrelated']);
    mocks.stat.mockResolvedValueOnce({ isFile: () => true, mtime: 0, size: 5 });
    await shareChatMedia(context, file, 'c');
    expect(mocks.unlink).toHaveBeenCalledExactlyOnceWith('/sandbox/cache/chat-shares/' + owned);
    mocks.listFile.mockResolvedValueOnce([owned]);
    mocks.stat.mockResolvedValueOnce({ isFile: () => true, mtime: Date.now() / 1000, size: 64 * 1024 * 1024 });
    await expect(shareChatMedia(context, file, 'c')).rejects.toThrow('SHARE_CACHE_FULL');
    expect(mocks.unlink).toHaveBeenCalledOnce(); expect(mocks.show).toHaveBeenCalledOnce();
  });
});
