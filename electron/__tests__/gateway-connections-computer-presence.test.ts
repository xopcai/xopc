import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';

import { DesktopComputerPresence } from '../desktop/computer-presence.js';

it('requires explicit current native consent and a visible trusted parent, independently of target application focus', async () => {
  let visible = true, minimized = false, current = true;
  const setVisibleOnAllWorkspaces = vi.fn();
  const parent = { isDestroyed: () => false, isVisible: () => visible, isMinimized: () => minimized,
    isVisibleOnAllWorkspaces: () => false, setVisibleOnAllWorkspaces, isFullScreen: () => false,
    setFullScreen: vi.fn(), once: vi.fn(), on: vi.fn(), removeListener: vi.fn() };
  const presence = new DesktopComputerPresence(), controller = new AbortController();
  expect(presence.visible()).toBe(false);
  await presence.begin(parent as never, () => current, controller.signal, 'darwin');
  expect(presence.visible()).toBe(true);
  expect(setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, { visibleOnFullScreen: true });
  visible = false; expect(presence.visible()).toBe(false);
  visible = true; expect(presence.visible()).toBe(false);
  visible = true; minimized = true; expect(presence.visible()).toBe(false);
  minimized = false; current = false; expect(presence.visible()).toBe(false);
  current = true; controller.abort(); expect(presence.visible()).toBe(false);
  expect(setVisibleOnAllWorkspaces).toHaveBeenLastCalledWith(false);
  presence.close(); expect(presence.visible()).toBe(false);
});
it('latches minimize and hide revocation instead of restoring old consent when a window returns', async () => {
  let visible = true;
  const parent = Object.assign(new EventEmitter(), { isDestroyed: () => false, isVisible: () => visible, isMinimized: () => false,
    isVisibleOnAllWorkspaces: () => false, setVisibleOnAllWorkspaces: vi.fn(), isFullScreen: () => false, setFullScreen: vi.fn() });
  const revoke = vi.fn(), presence = new DesktopComputerPresence(revoke), signal = new AbortController().signal;
  await presence.begin(parent as never, () => true, signal, 'darwin');
  parent.emit('hide'); expect(presence.visible()).toBe(true); expect(revoke).not.toHaveBeenCalled();
  parent.emit('minimize'); expect(presence.visible()).toBe(false); expect(revoke).toHaveBeenCalledOnce();
  parent.emit('restore'); expect(presence.visible()).toBe(false);
  await presence.begin(parent as never, () => true, signal, 'darwin');
  visible = false; parent.emit('hide'); expect(presence.visible()).toBe(false); expect(revoke).toHaveBeenCalledTimes(2);
  expect(parent.listenerCount('minimize')).toBe(0);
});
it('refuses hidden or stale parents before changing window policy and never restores an aborted grant', async () => {
  const parent = { isDestroyed: () => false, isVisible: () => false, isMinimized: () => false, setVisibleOnAllWorkspaces: vi.fn() };
  const presence = new DesktopComputerPresence(), controller = new AbortController();
  await expect(presence.begin(parent as never, () => true, controller.signal, 'darwin')).rejects.toThrow('LOCAL_UI_REQUIRED');
  expect(parent.setVisibleOnAllWorkspaces).not.toHaveBeenCalled();
  controller.abort();
  await expect(presence.begin(parent as never, () => true, controller.signal, 'darwin')).rejects.toThrow();
  expect(presence.visible()).toBe(false);
});
