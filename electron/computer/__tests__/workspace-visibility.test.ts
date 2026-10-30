import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComputerWorkspaceVisibility } from '../workspace-visibility.js';

function fixture(fullscreen = false, sticky = false) {
  const events = new EventEmitter();
  const window = Object.assign(events, { isDestroyed: () => false, isFullScreen: () => fullscreen,
    isVisibleOnAllWorkspaces: () => sticky, setVisibleOnAllWorkspaces: vi.fn(), setFullScreen: vi.fn(),
  });
  return { window, controller: new AbortController(), visibility: new ComputerWorkspaceVisibility() };
}
afterEach(() => vi.useRealTimers());
describe('computer chat workspace visibility', () => {
  it('follows other desktops and fullscreen apps only during an authorized lease', async () => {
    const f = fixture();
    await f.visibility.begin(f.window as any, f.controller.signal, 'darwin');
    expect(f.visibility.active).toBe(true);
    expect(f.window.setVisibleOnAllWorkspaces).toHaveBeenCalledExactlyOnceWith(true, { visibleOnFullScreen: true });
    f.controller.abort(); f.visibility.close();
    expect(f.visibility.active).toBe(false);
    expect(f.window.setVisibleOnAllWorkspaces.mock.calls).toEqual([[true, { visibleOnFullScreen: true }], [false]]);
  });
  it('waits for the chat to leave its own fullscreen Space and restores fullscreen on release', async () => {
    const f = fixture(true);
    const pending = f.visibility.begin(f.window as any, f.controller.signal, 'darwin');
    expect(f.window.setFullScreen).toHaveBeenCalledExactlyOnceWith(false);
    expect(f.window.setVisibleOnAllWorkspaces).not.toHaveBeenCalled();
    f.window.emit('leave-full-screen'); await pending;
    expect(f.visibility.active).toBe(true);
    f.controller.abort();
    expect(f.window.setFullScreen).toHaveBeenLastCalledWith(true);
    expect(f.window.listenerCount('leave-full-screen')).toBe(0);
  });
  it('bounds a fullscreen transition and cleans up when it never completes', async () => {
    vi.useFakeTimers(); const f = fixture(true);
    const pending = f.visibility.begin(f.window as any, f.controller.signal, 'darwin');
    const rejected = expect(pending).rejects.toThrow('COMPUTER_WINDOW_READY_TIMEOUT');
    await vi.advanceTimersByTimeAsync(5000); await rejected;
    expect(f.visibility.active).toBe(false);
    expect(f.window.setVisibleOnAllWorkspaces).not.toHaveBeenCalled();
    expect(f.window.listenerCount('leave-full-screen')).toBe(0);
  });
  it('cancels a fullscreen transition without leaving a workspace override', async () => {
    const f = fixture(true);
    const pending = f.visibility.begin(f.window as any, f.controller.signal, 'darwin');
    f.controller.abort(new Error('cancelled'));
    await expect(pending).rejects.toThrow('cancelled');
    expect(f.visibility.active).toBe(false);
    expect(f.window.setVisibleOnAllWorkspaces).not.toHaveBeenCalled();
    expect(f.window.listenerCount('leave-full-screen')).toBe(0);
  });
  it('preserves an existing all-workspace policy', async () => {
    const f = fixture(false, true);
    await f.visibility.begin(f.window as any, f.controller.signal, 'darwin'); f.controller.abort();
    expect(f.window.setVisibleOnAllWorkspaces).not.toHaveBeenCalled();
  });
  it('does not change Windows desktop behavior', async () => {
    const f = fixture();
    await f.visibility.begin(f.window as any, f.controller.signal, 'win32');
    expect(f.visibility.active).toBe(false);
    expect(f.window.setVisibleOnAllWorkspaces).not.toHaveBeenCalled();
  });
});
