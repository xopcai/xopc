import { afterEach, describe, expect, it, vi } from 'vitest';
import { CuaComputerDriver } from '../cua-driver.js';
import { withWindowReadiness } from '../window-readiness.js';

afterEach(() => vi.useRealTimers());

function fixture() {
  const driver = new CuaComputerDriver('/fixture', 'host', undefined, 'darwin');
  vi.spyOn(driver as any, 'start').mockResolvedValue(undefined);
  const identity = vi.spyOn(driver as any, 'processIdentity').mockResolvedValue('identity');
  const apps = vi.spyOn(driver as any, 'listApps').mockResolvedValue([{ bundleId: 'fixture', pid: 42 }]);
  const window = { windowId: 9n, pid: 42, isOnScreen: false, bounds: { x: 0, y: 0, width: 800, height: 600 } };
  const windows = vi.spyOn(driver as any, 'appWindows').mockImplementation(async () => [{ ...window }]);
  const command = vi.spyOn(driver as any, 'callUntyped').mockResolvedValue({ data: {} });
  const state = { pid: 42, windowId: 9n, windowBounds: window.bounds, screenshotWidth: 800, screenshotHeight: 600,
    elements: [], images: [{ mimeType: 'image/png', dataBase64: 'AQID' }] };
  const capture = vi.spyOn(driver as any, 'getWindowState').mockImplementation(async () => ({ ...state, images: [...state.images] }));
  const controller = new AbortController();
  const open = () => driver.resolveTarget('fixture', controller.signal, { prepare: true });
  return { driver, identity, apps, window, windows, command, capture, state, controller, open };
}

describe('window preparation readiness', () => {
  it('activates at most once when a running app initially has no published windows', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.windows.mockResolvedValueOnce([]);
    const opening = f.open();
    await vi.advanceTimersByTimeAsync(300);
    f.window.isOnScreen = true;
    await vi.advanceTimersByTimeAsync(1000);
    await expect(opening).resolves.toMatchObject({ windowId: '9' });
    expect(f.command.mock.calls.map(([name]) => name)).toEqual(['bring_to_front']);
  });

  it('waits through geometry changes before accepting a restored screenshot', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.command.mockImplementation(async () => { f.window.isOnScreen = true; return { data: {} }; });
    f.windows.mockResolvedValueOnce([{ ...f.window }]).mockResolvedValueOnce([{ ...f.window, isOnScreen: true, bounds: { ...f.window.bounds, width: 600 } }]);
    const opening = f.open();
    await vi.advanceTimersByTimeAsync(100);
    expect(f.capture).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    await expect(opening).resolves.toMatchObject({ width: 800 });
    expect(f.capture).toHaveBeenCalledOnce();
  });
  it('waits for delayed restoration and stable geometry without another activation', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const opening = f.open();
    await vi.advanceTimersByTimeAsync(300);
    expect(f.driver.getPreparationState()).toBeDefined();
    expect(f.capture).not.toHaveBeenCalled();
    f.window.isOnScreen = true;
    await vi.advanceTimersByTimeAsync(1000);
    await expect(opening).resolves.toMatchObject({ windowId: '9' });
    expect(f.command).toHaveBeenCalledTimes(1);
    expect(f.capture).toHaveBeenCalledTimes(1);
    expect(f.driver.getPreparationState()).toBeUndefined();
  });

  it('shares a five-second deadline between restoration, metadata and invalid captures', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.capture.mockResolvedValue({ ...f.state, screenshotFrameValid: false, images: [] });
    const opening = f.open();
    const failure = expect(opening).rejects.toThrow('COMPUTER_WINDOW_READY_TIMEOUT');
    await vi.advanceTimersByTimeAsync(3000);
    f.window.isOnScreen = true;
    await vi.advanceTimersByTimeAsync(2000);
    await failure;
    expect(f.command).toHaveBeenCalledTimes(1);
    expect(f.capture).toHaveBeenCalled();
    expect(f.driver.getPreparationState()).toBeUndefined();
  });

  it('waits for a newly launched process and window within the same deadline', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.apps.mockResolvedValueOnce([{ bundleId: 'fixture', pid: 0 }]).mockResolvedValueOnce([{ bundleId: 'fixture', pid: 0 }]);
    f.windows.mockResolvedValueOnce([]);
    f.window.isOnScreen = true;
    await expect((async () => { const result = f.open(); await vi.advanceTimersByTimeAsync(2000); return result; })()).resolves.toMatchObject({ windowId: '9' });
    expect(f.command.mock.calls.map(([name]) => name)).toEqual(['launch_app']);
  });

  it.each(['cancel', 'process', 'window', 'space'] as const)('stops on %s during preparation without capture or input', async reason => {
    vi.useFakeTimers();
    const f = fixture();
    const opening = f.open();
    const failure = expect(opening).rejects.toThrow({ cancel: 'cancelled', process: 'PROCESS_CHANGED', window: 'WINDOW_CHANGED', space: 'WINDOW_OTHER_SPACE' }[reason]);
    await vi.advanceTimersByTimeAsync(50);
    if (reason === 'cancel') f.controller.abort(new Error('cancelled'));
    if (reason === 'process') f.identity.mockResolvedValue('new-process');
    if (reason === 'window') f.windows.mockResolvedValue([{ ...f.window, windowId: 10n }]);
    if (reason === 'space') f.windows.mockResolvedValue([{ ...f.window, onCurrentSpace: false }]);
    await vi.advanceTimersByTimeAsync(1000);
    await failure;
    expect(f.capture).not.toHaveBeenCalled();
    expect(f.command).toHaveBeenCalledTimes(1);
  });

  it('refuses another Space before any activation, even when prepare is authorized', async () => {
    const f = fixture();
    f.windows.mockResolvedValue([{ ...f.window, onCurrentSpace: false }]);
    await expect(f.open()).rejects.toThrow('WINDOW_OTHER_SPACE');
    expect(f.command).not.toHaveBeenCalled();
  });

  it('stops immediately on capture identity mismatch instead of waiting or selecting a replacement', async () => {
    vi.useFakeTimers();
    const f = fixture(); f.command.mockImplementation(async () => { f.window.isOnScreen = true; return { data: {} }; });
    f.capture.mockResolvedValue({ ...f.state, windowId: 10n });
    const failure = expect(f.open()).rejects.toThrow('CAPTURE_TARGET_MISMATCH');
    await vi.advanceTimersByTimeAsync(500);
    await failure;
    expect(f.capture).toHaveBeenCalledOnce();
  });

  it('bounds an unresponsive SDK call as well as polling delays', async () => {
    vi.useFakeTimers();
    const failure = expect(withWindowReadiness(new AbortController().signal, async () => new Promise(() => {}))).rejects.toThrow('WINDOW_READY_TIMEOUT');
    await vi.advanceTimersByTimeAsync(5000);
    await failure;
  });
});
