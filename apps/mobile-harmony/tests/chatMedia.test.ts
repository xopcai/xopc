import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ request: vi.fn(), destroy: vi.fn(), transferAuth: vi.fn(), gateway: vi.fn(), save: vi.fn(), open: vi.fn(), write: vi.fn(), close: vi.fn(), assertConnection: vi.fn() }));
vi.mock('@kit.AbilityKit', () => ({}));
vi.mock('@kit.CoreFileKit', () => ({ fileIo: { open: mocks.open, write: mocks.write, close: mocks.close, OpenMode: { WRITE_ONLY: 1, TRUNC: 2 } },
  picker: { DocumentViewPicker: class { save = mocks.save; } } }));
vi.mock('@kit.NetworkKit', () => ({ http: { createHttp: () => ({ request: mocks.request, destroy: mocks.destroy }),
  RequestMethod: { GET: 'GET' }, HttpDataType: { ARRAY_BUFFER: 'buffer' } } }));
vi.mock('../entry/src/main/ets/service/transport.ets', () => ({ XopcHttpError: class extends Error { constructor(code: number) { super(`HTTP_${code}`); } } }));
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: { transferAuth: mocks.transferAuth, request: mocks.gateway,
  connectionRevision: () => 1, assertConnection: mocks.assertConnection } }));
import { readChatMedia, saveChatMedia } from '../entry/src/main/ets/service/chatMedia.ets';
const file = { id: 'f', name: 'f.png', type: 'image', mimeType: 'image/png', size: 5, uri: 'xopc-file:f' };
describe('authenticated chat media transport', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.transferAuth.mockResolvedValue({ origin: 'https://gateway.test', token: 'fixture-token' });
    mocks.request.mockResolvedValue({ responseCode: 200, result: new ArrayBuffer(5) }); });
  it('does not resolve an old workspace path against a newly activated Gateway', async () => {
    mocks.gateway.mockResolvedValueOnce(JSON.stringify({ space: { id: 'old-space' } }));
    mocks.assertConnection.mockImplementationOnce(() => { throw new Error('OPERATION_CANCELLED'); });
    await expect(readChatMedia({ ...file, uri: '', workspaceRelativePath: 'out/report.png' }, 'old-chat')).rejects.toThrow('OPERATION_CANCELLED');
    expect(mocks.gateway).toHaveBeenCalledTimes(1); expect(mocks.transferAuth).not.toHaveBeenCalled();
  });
  it('uses bounded authenticated requests for registered artifacts', async () => {
    await readChatMedia(file, 'c');
    expect(mocks.request).toHaveBeenCalledWith('https://gateway.test/api/files/f/content', expect.objectContaining({ maxRedirects: 0,
      maxLimit: 16 * 1024 * 1024, header: { Authorization: 'Bearer fixture-token' } }));
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });
  it('never sends credentials or obtains a gateway token for external images', async () => {
    await readChatMedia({ ...file, uri: 'https://external.test/image.png' }, 'c');
    expect(mocks.transferAuth).not.toHaveBeenCalled(); expect(mocks.request.mock.calls[0][1].header).toBeUndefined();
  });
  it('resolves workspace files only within the current session file space', async () => {
    mocks.gateway.mockResolvedValueOnce(JSON.stringify({ space: { id: 'space' } })).mockResolvedValueOnce(JSON.stringify({ resource: { id: 'resolved' } }));
    await readChatMedia({ ...file, uri: '', workspaceRelativePath: 'out/report.png' }, 'c/d');
    expect(mocks.gateway.mock.calls).toEqual([['/api/files/contexts/session/c%2Fd'], ['/api/files/resolve', 'POST', JSON.stringify({ spaceId: 'space', path: 'out/report.png' })]]);
    expect(mocks.request.mock.calls[0][0]).toBe('https://gateway.test/api/files/resolved/content');
  });
  it('releases HTTP resources on errors and never decodes an error response as an image', async () => {
    mocks.request.mockResolvedValueOnce({ responseCode: 404, result: new ArrayBuffer(1) });
    await expect(readChatMedia(file, 'c')).rejects.toThrow('HTTP_404'); expect(mocks.destroy).toHaveBeenCalledOnce();
  });
  it('rejects oversized metadata before HTTP and decodes embedded media offline', async () => {
    await expect(readChatMedia({ ...file, size: 17000000 }, 'c')).rejects.toThrow('INVALID_MEDIA_OR_TOO_LARGE');
    expect(await readChatMedia({ ...file, uri: 'data:image/png;base64,YQ==' }, '')).toEqual(new Uint8Array([97]).buffer);
    expect(mocks.request).not.toHaveBeenCalled(); expect(mocks.transferAuth).not.toHaveBeenCalled();
  });
  it('does not create or truncate a document when its download fails', async () => {
    mocks.request.mockRejectedValueOnce(new Error('OFFLINE'));
    await expect(saveChatMedia({} as never, file, 'c')).rejects.toThrow('OFFLINE');
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.open).not.toHaveBeenCalled();
  });
  it('honors picker cancellation without opening a destination', async () => {
    mocks.save.mockResolvedValueOnce([]);
    await saveChatMedia({} as never, file, 'c');
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it('closes the destination and reports incomplete writes', async () => {
    mocks.save.mockResolvedValueOnce(['file://selected']); mocks.open.mockResolvedValueOnce({ fd: 17 }); mocks.write.mockResolvedValueOnce(2);
    await expect(saveChatMedia({} as never, file, 'c')).rejects.toThrow('INCOMPLETE_FILE_WRITE');
    expect(mocks.close).toHaveBeenCalledWith({ fd: 17 });
  });
  it('rejects invalid or oversized HTTP bodies even when metadata claims a small file', async () => {
    for (const body of ['wrong type', new ArrayBuffer(16 * 1024 * 1024 + 1)]) {
      mocks.request.mockResolvedValueOnce({ responseCode: 200, result: body });
      await expect(readChatMedia(file, 'c')).rejects.toThrow('INVALID_MEDIA_OR_TOO_LARGE');
    }
    expect(mocks.destroy).toHaveBeenCalledTimes(2);
  });
});
