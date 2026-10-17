import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  root: '',
  bounds: { x: 0, y: 0, width: 0, height: 0 },
  setBounds: vi.fn(),
  cursor: { x: 0, y: 0 },
  ignoreMouse: vi.fn(),
}));

vi.mock('electron', () => {
  class BrowserWindow {
    static getAllWindows() { return []; }
    webContents = { send: vi.fn(), on: vi.fn() };
    constructor(options: typeof native.bounds) { native.bounds = { ...options }; }
    getBounds() { return native.bounds; }
    setBounds(bounds: typeof native.bounds) { native.bounds = bounds; native.setBounds(bounds); }
    isDestroyed() { return false; }
    isVisible() { return true; }
    on() {}
    destroy() {}
    showInactive() {}
    setAlwaysOnTop() {}
    setIgnoreMouseEvents = native.ignoreMouse;
    async loadURL() {}
  }
  return {
    BrowserWindow,
    app: { getPath: () => native.root },
    screen: {
      getCursorScreenPoint: () => native.cursor,
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 24, width: 1440, height: 876 } }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 24, width: 1440, height: 876 } }),
    },
    shell: {},
  };
});
vi.mock('../../config/paths-state.js', () => ({ resolveStateDir: () => native.root }));

import { patchDesktopPetPrefs, readDesktopPetPrefs } from '../../../electron/desktop-pet/prefs.js';
import {
  destroyDesktopPetWindow, dragDesktopPet, endDesktopPetDrag,
  initDesktopPetWindow, setDesktopPetContentSize, showDesktopPet, startDesktopPetDrag,
} from '../../../electron/desktop-pet/window.js';

describe('native desktop pet visible bounds', () => {
  afterEach(async () => {
    destroyDesktopPetWindow();
    vi.useRealTimers();
    if (native.root) await rm(native.root, { recursive: true, force: true });
  });

  it('keeps expanded bubbles onscreen at the top-left edge and persists the clamped drag endpoint', async () => {
    native.root = await mkdtemp(join(tmpdir(), 'xopc-pet-bounds-'));
    initDesktopPetWindow({ resolveUrl: () => 'http://localhost/#/desktop-pet', openMainWindow: vi.fn(), disableSandbox: false });
    await patchDesktopPetPrefs({ anchor: { x: 138, y: 156 } });
    await showDesktopPet();
    setDesktopPetContentSize({ width: 420, height: 253 });
    expect(native.bounds).toMatchObject({ x: 0, y: 24, width: 420, height: 253 });

    startDesktopPetDrag({ screenX: 300, screenY: 200 });
    dragDesktopPet({ screenX: -5000, screenY: -5000 });
    await endDesktopPetDrag();
    expect(native.bounds).toMatchObject({ x: 0, y: 24 });
    expect((await readDesktopPetPrefs()).anchor).toEqual({ x: 420, y: 277 });

    setDesktopPetContentSize({ width: 138, height: 132 });
    expect(native.bounds.x + native.bounds.width).toBe(420);
    expect(native.bounds.y + native.bounds.height).toBe(277);
  });

  it('retains the native surface when messages close, while allowing the idle pet to reach the edge', async () => {
    native.root = await mkdtemp(join(tmpdir(), 'xopc-pet-surface-'));
    initDesktopPetWindow({ resolveUrl: () => 'http://localhost/#/desktop-pet', openMainWindow: vi.fn(), disableSandbox: false });
    await patchDesktopPetPrefs({ anchor: { x: 900, y: 650 } });
    await showDesktopPet();
    setDesktopPetContentSize({ width: 420, height: 253 });
    const expanded = { ...native.bounds };
    native.setBounds.mockClear();
    setDesktopPetContentSize({ width: 138, height: 132 });
    expect(native.setBounds).not.toHaveBeenCalled();
    expect(native.bounds).toEqual(expanded);

    startDesktopPetDrag({ screenX: 900, screenY: 650 });
    dragDesktopPet({ screenX: -5000, screenY: -5000 });
    await endDesktopPetDrag();
    expect((await readDesktopPetPrefs()).anchor).toEqual({ x: 138, y: 156 });
    setDesktopPetContentSize({ width: 420, height: 253 });
    expect(native.bounds).toMatchObject({ x: 0, y: 24, width: 420, height: 253 });
  });

  it('restores native mouse input over the pet and bubbles without forwarded renderer events', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    native.root = await mkdtemp(join(tmpdir(), 'xopc-pet-input-'));
    initDesktopPetWindow({ resolveUrl: () => 'http://localhost/#/desktop-pet', openMainWindow: vi.fn(), disableSandbox: false });
    await patchDesktopPetPrefs({ anchor: { x: 900, y: 650 } });
    await showDesktopPet();
    setDesktopPetContentSize({ width: 420, height: 253 });
    native.cursor = { x: 500, y: 420 };
    vi.advanceTimersByTime(40);
    expect(native.ignoreMouse).toHaveBeenLastCalledWith(false, { forward: true });
    setDesktopPetContentSize({ width: 138, height: 132 });
    vi.advanceTimersByTime(40);
    expect(native.ignoreMouse).toHaveBeenLastCalledWith(true, { forward: true });
    native.cursor = { x: 830, y: 580 };
    vi.advanceTimersByTime(40);
    expect(native.ignoreMouse).toHaveBeenLastCalledWith(false, { forward: true });
    startDesktopPetDrag({ screenX: 830, screenY: 580 });
    native.cursor = { x: 200, y: 200 };
    vi.advanceTimersByTime(40);
    expect(native.ignoreMouse).toHaveBeenLastCalledWith(false, { forward: true });
    await endDesktopPetDrag();
    vi.advanceTimersByTime(40);
    expect(native.ignoreMouse).toHaveBeenLastCalledWith(true, { forward: true });
  });
});
