import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  request: vi.fn(), destroy: vi.fn(), open: vi.fn(), write: vi.fn(), close: vi.fn(), unlink: vi.fn(),
}));
vi.mock('@kit.NetworkKit', () => ({
  http: { createHttp: () => ({ destroy: mocks.destroy }), RequestMethod: { GET: 'GET' }, HttpDataType: { ARRAY_BUFFER: 1 } },
}));
vi.mock('@kit.CoreFileKit', () => ({
  fileIo: { open: mocks.open, write: mocks.write, close: mocks.close, unlink: mocks.unlink,
    OpenMode: { CREATE: 1, WRITE_ONLY: 2, TRUNC: 4 } },
}));
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({
  gatewaySession: { transferAuth: async () => ({ origin: 'https://gateway.test', token: 'fixture' }),
    connectionRevision: () => 1, assertConnection: () => {} },
}));
vi.mock('../entry/src/main/ets/service/requestProof.ets', () => ({ signedHttpRequest: mocks.request }));
vi.mock('../entry/src/main/ets/service/transport.ets', () => ({ XopcHttpError: Error }));

import { downloadGeneratedMedia } from '../entry/src/main/ets/service/generatedMediaFile.ets';

describe('generated media transfers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.open.mockResolvedValue({ fd: 4 });
    mocks.write.mockImplementation(async (_fd, bytes: ArrayBuffer) => bytes.byteLength);
  });

  it('downloads signed ranges into one bounded local video', async () => {
    const chunk = 2 * 1024 * 1024;
    mocks.request
      .mockResolvedValueOnce({ responseCode: 206, header: { 'Content-Range': `bytes 0-${chunk - 1}/${chunk + 2}` },
        result: new ArrayBuffer(chunk) })
      .mockResolvedValueOnce({ responseCode: 206, header: JSON.stringify({ 'content-range': `bytes ${chunk}-${chunk + 1}/${chunk + 2}` }),
        result: new ArrayBuffer(2) });
    await expect(downloadGeneratedMedia('video', 'chat', 'clip', '/cache/clip.mp4', () => true)).resolves.toBe(chunk + 2);
    expect(mocks.request.mock.calls.map(call => call[2].header.Range)).toEqual([`bytes=0-${chunk - 1}`, `bytes=${chunk}-${2 * chunk - 1}`]);
    expect(mocks.request.mock.calls[0][1]).toBe('https://gateway.test/api/video-generation/sessions/chat/jobs/clip/video');
    expect(mocks.write).toHaveBeenCalledTimes(2);
    expect(mocks.close).toHaveBeenCalledWith({ fd: 4 });
    expect(mocks.unlink).not.toHaveBeenCalled();
  });

  it('removes incomplete downloads on invalid ranges', async () => {
    mocks.request.mockResolvedValue({ responseCode: 206, header: { 'Content-Range': 'bytes 1-2/3' }, result: new ArrayBuffer(2) });
    await expect(downloadGeneratedMedia('music', 'chat', 'song', '/cache/song.audio', () => true)).rejects.toThrow('INVALID_MEDIA_RANGE');
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.unlink).toHaveBeenCalledWith('/cache/song.audio');
  });
});
