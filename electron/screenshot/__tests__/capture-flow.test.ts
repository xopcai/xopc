import { afterEach, describe, expect, it, vi } from 'vitest';

import { desktopCapturer, dialog, nativeImage, screen, type Display, type NativeImage } from 'electron';

import { captureDesktopScreenshot } from '../../desktop-screenshot.js';
import { captureDesktopFrames } from '../capture-provider.js';
import { captureLinuxPortalScreenshot } from '../linux-helper.js';
import { ScreenshotManager } from '../screenshot-manager.js';

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  desktopCapturer: { getSources: vi.fn() },
  dialog: { showMessageBox: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  nativeImage: { createFromPath: vi.fn() },
  screen: { getAllDisplays: vi.fn(() => []), getPrimaryDisplay: vi.fn() },
}));
vi.mock('../../desktop-screenshot.js', () => ({ captureDesktopScreenshot: vi.fn() }));
vi.mock('../../ipc/system-settings-ipc.js', () => ({ getElectronShellLanguage: () => 'en' }));
vi.mock('../linux-helper.js', async (original) => ({
  ...await original<typeof import('../linux-helper.js')>(),
  captureLinuxPortalScreenshot: vi.fn(),
}));
vi.mock('../windows-helper.js', () => ({ queryWindowsSnapList: async () => [] }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Windows desktop screenshot fallback', () => {
  it('opens the system screenshot tool if Electron cannot enumerate screens', async () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    vi.mocked(desktopCapturer.getSources).mockRejectedValue(new Error('Failed to get sources'));
    const manager = new ScreenshotManager({
      getMainWindow: () => null,
      focusOrCreateMainWindow: () => {},
      getGatewayTarget: () => undefined,
      assertMainRenderer: () => {},
    });
    vi.spyOn(manager, 'getPreferences').mockReturnValue({ hideMainWindow: false });

    await expect(manager.startCapture()).resolves.toEqual({ ok: true });
    expect(captureDesktopScreenshot).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
  });
});

describe('Wayland screen capture', () => {
  it('fits both monitors in one overlay while retaining the original PNG', async () => {
    vi.stubGlobal('process', { ...process, platform: 'linux' });
    vi.stubEnv('XDG_SESSION_TYPE', 'wayland');
    const primary = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 } as Display;
    const secondary = { id: 2, bounds: { x: 1920, y: 0, width: 1280, height: 720 }, scaleFactor: 1 } as Display;
    vi.mocked(screen.getAllDisplays).mockReturnValue([primary, secondary]);
    vi.mocked(screen.getPrimaryDisplay).mockReturnValue(primary);
    vi.mocked(captureLinuxPortalScreenshot).mockResolvedValue({ status: 'ok', filePath: '/dev/null/wayland-test.png' });
    const png = Buffer.from('captured pixels');
    vi.mocked(nativeImage.createFromPath).mockReturnValue({
      isEmpty: () => false,
      getSize: () => ({ width: 3200, height: 1080 }),
      toPNG: () => png,
    } as NativeImage);

    const result = await captureDesktopFrames({});
    expect(result.frames).toEqual([{
      displayId: 1,
      bounds: primary.bounds,
      scaleFactor: 1,
      pixelWidth: 3200,
      pixelHeight: 1080,
      pngBase64: png.toString('base64'),
      imageBounds: { x: 0, y: 0, width: 1280, height: 432 },
    }]);
  });
});
