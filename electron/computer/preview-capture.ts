import { join } from 'node:path';
import { BrowserWindow, desktopCapturer, MessageChannelMain } from 'electron';
import type { ComputerPreviewAuthority } from '../../src/computer/broker.js';
import type { PreviewCapture, PreviewPixels } from './preview-manager.js';
import { createLogger } from '../../src/utils/logger.js';

const log = createLogger('ComputerPreview');

/** Electron's documented source IDs contain the native window ID/handle. */
export function exactPreviewSource(sources: Array<{ id: string }>, windowId: string): string {
  const expected = BigInt(windowId);
  const matches = sources.filter(source => {
    const match = /^window:(\d+):0$/.exec(source.id);
    return !!match && BigInt(match[1]) === expected;
  });
  if (matches.length !== 1) throw new Error('COMPUTER_PREVIEW_EXACT_WINDOW_UNAVAILABLE');
  return matches[0].id;
}

/** A private, nonpersistent capture renderer keeps encoding off the input lane. */
export async function startPreviewCapture(authority: ComputerPreviewAuthority, preset: 'compact' | 'expanded',
  frame: (pixels: PreviewPixels) => Promise<void>, failed: (code: string) => void,
  validate: () => Promise<void>): Promise<PreviewCapture> {
  authority.signal.throwIfAborted();
  if (!authority.target || process.platform !== 'darwin' && process.platform !== 'win32') throw new Error('COMPUTER_PREVIEW_UNSUPPORTED');
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });
  const sourceId = exactPreviewSource(sources, authority.target.windowId);
  await validate();
  authority.signal.throwIfAborted();
  const worker = new BrowserWindow({ show: false, focusable: false, skipTaskbar: true, width: 32, height: 32,
    webPreferences: { preload: join(import.meta.dirname, '../preload/computer-preview.cjs'),
      partition: 'computer-preview-private',
      contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
  worker.webContents.setFrameRate(15);
  const captureSession = worker.webContents.session;
  const { port1, port2 } = new MessageChannelMain();
  let closed = false;
  let checking = false;
  let ready = false;
  let frameInFlight = false;
  const close = () => {
    if (closed) return;
    closed = true; clearInterval(watchdog); clearTimeout(firstFrameDeadline);
    authority.signal.removeEventListener('abort', close);
    captureSession.setPermissionCheckHandler(() => false);
    captureSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    port1.close(); if (!worker.isDestroyed()) worker.destroy();
  };
  const fail = (code: string) => { if (!closed) { close(); failed(code); } };
  const watchdog = setInterval(() => {
    if (checking || closed) return;
    checking = true;
    void validate().catch(() => fail('COMPUTER_PREVIEW_TARGET_CHANGED')).finally(() => { checking = false; });
  }, 2000);
  const firstFrameDeadline = setTimeout(() => fail('COMPUTER_PREVIEW_FIRST_FRAME_TIMEOUT'), 10_000);
  authority.signal.addEventListener('abort', close, { once: true });
  captureSession.setPermissionCheckHandler((contents, permission, _origin, details) => !closed
    && contents === worker.webContents && permission === 'display-capture' && details.isMainFrame === true);
  captureSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(!closed && contents === worker.webContents && permission === 'display-capture' && details.isMainFrame === true);
  });
  worker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  worker.webContents.on('will-navigate', event => event.preventDefault());
  worker.webContents.on('render-process-gone', () => fail('COMPUTER_PREVIEW_CAPTURE_EXITED'));
  worker.once('closed', () => { if (!closed) fail('COMPUTER_PREVIEW_CAPTURE_EXITED'); });
  port1.on('message', async event => {
    const data = event.data;
    if (closed) return;
    if (data?.kind === 'error') { fail('COMPUTER_PREVIEW_CAPTURE_UNAVAILABLE'); return; }
    const bytes = data?.bytes instanceof ArrayBuffer ? new Uint8Array(data.bytes)
      : ArrayBuffer.isView(data?.bytes) ? new Uint8Array(data.bytes.buffer, data.bytes.byteOffset, data.bytes.byteLength) : undefined;
    if (data?.kind !== 'frame' || !bytes || frameInFlight) {
      log.warn({ phase: 'frame_decode', kind: data?.kind, envelopeKeys: Object.keys(event ?? {}).slice(0, 8), dataType: typeof data,
        dataKeys: data && typeof data === 'object' ? Object.keys(data).slice(0, 8) : [], dataTag: Object.prototype.toString.call(data), bytesType: Object.prototype.toString.call(data?.bytes), frameInFlight }, 'Preview frame envelope rejected');
      fail('COMPUTER_PREVIEW_INVALID_FRAME'); return;
    }
    frameInFlight = true;
    if (!ready) { ready = true; clearTimeout(firstFrameDeadline); }
    try { await frame({ width: data.width, height: data.height, bytes }); }
    catch (error) {
      log.warn({ phase: 'frame_delivery', width: data.width, height: data.height, size: bytes.byteLength,
        errorMessage: error instanceof Error && error.message.startsWith('COMPUTER_') ? error.message : 'presentation_failed' }, 'Preview frame presentation failed');
      fail('COMPUTER_PREVIEW_INVALID_FRAME');
    }
    finally { frameInFlight = false; if (!closed) port1.postMessage({ kind: 'ack' }); }
  });
  port1.start();
  try {
    await worker.loadFile(join(import.meta.dirname, '../preload/computer-preview.html'));
    if (closed) throw new Error('COMPUTER_PREVIEW_REVOKED');
    worker.webContents.postMessage('computer-preview:worker', { sourceId, preset }, [port2]);
  } catch (error) { close(); throw error; }
  return { close, setPreset(next) { if (!closed) port1.postMessage({ kind: 'preset', preset: next }); } };
}
