import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const ipc = vi.hoisted(() => ({ once: vi.fn() }));
vi.mock('electron', () => ({ ipcRenderer: ipc }));
let receive: (event: unknown, input: unknown) => void;
let port: any;
let media: ReturnType<typeof vi.fn>, encode: ReturnType<typeof vi.fn>;
let canvas: { width: number; height: number };
let video: { videoWidth: number; videoHeight: number };

beforeEach(() => {
  vi.resetModules();
  ipc.once.mockImplementation((_event, callback) => { receive = callback; });
  port = { postMessage: vi.fn(), close: vi.fn(), start: vi.fn(), addEventListener: vi.fn() };
  video = { videoWidth: 2000, videoHeight: 1200, readyState: 2, play: vi.fn().mockResolvedValue(undefined) } as any;
  media = vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }], getVideoTracks: () => [{ addEventListener: vi.fn() }] });
  encode = vi.fn().mockResolvedValue(new Blob([new Uint8Array([1, 2, 3])]));
  vi.stubGlobal('document', { createElement: () => video });
  vi.stubGlobal('window', { addEventListener: vi.fn() });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: media } });
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(public width: number, public height: number) { canvas = this; }
    getContext() { return { drawImage: vi.fn() }; }
    convertToBlob(options: unknown) { return encode(options); }
  });
});
afterEach(() => { port.onmessageerror?.(); vi.unstubAllGlobals(); });

it.each([
  ['compact', 2000, 1200, 1280, 768, 1280],
  ['expanded', 2000, 1200, 1600, 960, 1600],
  ['compact', 640, 480, 640, 480, 1280],
] as const)('captures %s previews sharply without upscaling the source', async (preset, width, height, outWidth, outHeight, limit) => {
  video.videoWidth = width; video.videoHeight = height;
  await import('../preview-worker.js');
  receive({ ports: [port] }, { sourceId: 'window:9:0', preset });
  await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: 'frame' })));
  expect(media.mock.calls[0][0].video.mandatory).toMatchObject({ maxWidth: limit, maxHeight: limit });
  expect([canvas.width, canvas.height]).toEqual([outWidth, outHeight]);
  expect(encode).toHaveBeenCalledWith({ type: 'image/jpeg', quality: .92 });
  expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ width: outWidth, height: outHeight }));
});
