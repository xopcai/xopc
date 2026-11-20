import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platform: vi.fn(),
  release: vi.fn(),
  run: vi.fn(),
  openExternal: vi.fn(),
  write: vi.fn(),
  readImage: vi.fn(),
}));

vi.mock('node:os', () => ({ platform: mocks.platform, release: mocks.release }));
vi.mock('node:util', () => ({ promisify: () => mocks.run }));
vi.mock('electron', () => ({
  ClipboardItem: class {
    constructor(readonly items: Record<string, Blob>) {}
  },
  clipboard: { write: mocks.write },
  nativeImage: { createFromPath: mocks.readImage },
  shell: { openExternal: mocks.openExternal },
}));

import { captureDesktopScreenshot } from '../desktop-screenshot.js';

const capture = () => captureDesktopScreenshot(new AbortController().signal);
const failure = (code: number) => Object.assign(new Error('Capture failed'), { code });

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.unstubAllEnvs());

describe('captureDesktopScreenshot', () => {
  it('opens Snipping Tool in rectangle mode on current Windows builds', async () => {
    mocks.platform.mockReturnValue('win32');
    mocks.release.mockReturnValue('10.0.26100');

    await capture();

    expect(mocks.openExternal).toHaveBeenCalledWith(expect.stringMatching(/^ms-screenclip:\/\/capture\/image\?rectangle&/));
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('uses the legacy screen snipping URI on Windows 10', async () => {
    mocks.platform.mockReturnValue('win32');
    mocks.release.mockReturnValue('10.0.19045');

    await capture();

    expect(mocks.openExternal).toHaveBeenCalledWith('ms-screenclip:');
  });

  it('copies the Linux portal image to the clipboard as PNG', async () => {
    mocks.platform.mockReturnValue('linux');
    mocks.run.mockResolvedValue({ stdout: 'file:///tmp/portal%20screenshot.png\n' });
    mocks.readImage.mockReturnValue({ isEmpty: () => false, toPNG: () => Buffer.from([1, 2, 3]) });

    await capture();

    expect(mocks.readImage).toHaveBeenCalledWith('/tmp/portal screenshot.png');
    expect(mocks.write).toHaveBeenCalledWith([
      expect.objectContaining({ items: { 'image/png': expect.objectContaining({ type: 'image/png', size: 3 }) } }),
    ]);
  });

  it('keeps the clipboard and avoids a second picker when Linux capture is cancelled', async () => {
    mocks.platform.mockReturnValue('linux');
    mocks.run.mockRejectedValueOnce(failure(10));

    await capture();

    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it('falls back to Spectacle on KDE when the portal is unavailable', async () => {
    mocks.platform.mockReturnValue('linux');
    vi.stubEnv('XDG_CURRENT_DESKTOP', 'KDE');
    mocks.run.mockRejectedValueOnce(failure(11)).mockResolvedValueOnce({});

    await capture();

    expect(mocks.run).toHaveBeenLastCalledWith('spectacle', ['-b', '-r', '-c'], expect.anything());
  });
});
