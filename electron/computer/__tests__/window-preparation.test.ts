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
  const capture = vi.spyOn(driver as any, 'getWindowState').mockImplementation(async () => ({ ...state, windowBounds: { ...state.windowBounds }, images: [...state.images] }));
  const controller = new AbortController();
  const open = () => driver.resolveTarget('fixture', controller.signal, { prepare: true });
  return { driver, identity, apps, window, windows, command, capture, state, controller, open };
}

describe('window preparation readiness', () => {
  it('samples readiness immediately and cancels a pending short poll without another read', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const sample = vi.fn().mockResolvedValue(undefined);
    const pending = withWindowReadiness(controller.signal, (_signal, poll) => poll(sample, { intervalMs: 16 }));
    const failure = expect(pending).rejects.toThrow('cancelled');
    await vi.advanceTimersByTimeAsync(0);
    expect(sample).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(15);
    expect(sample).toHaveBeenCalledOnce();
    controller.abort(new Error('cancelled'));
    await failure;
    await vi.advanceTimersByTimeAsync(100);
    expect(sample).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

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
    await vi.advanceTimersByTimeAsync(8);
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

  it('does not capture an animation plateau until logical and composited bounds agree', async () => {
    vi.useFakeTimers();
    const f = fixture();
    Object.assign(f.window, { layoutBounds: { ...f.window.bounds, height: 650 } });
    f.command.mockImplementation(async () => { f.window.isOnScreen = true; return { data: {} }; });
    const opening = f.open(); await vi.advanceTimersByTimeAsync(150);
    expect(f.capture).not.toHaveBeenCalled();
    expect(f.driver.getLastPreparationTiming()?.readinessSamples.some(sample => sample.reason === 'layout_pending')).toBe(true);
    f.window.bounds.height = 650;
    await vi.advanceTimersByTimeAsync(100);
    await expect(opening).resolves.toMatchObject({ height: 650 });
    expect(f.capture).toHaveBeenCalledOnce();
  });

  it('rechecks changed bounds and reuses a native-valid capture without a second AX/pixel read', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.command.mockImplementation(async () => { f.window.isOnScreen = true; return { data: {} }; });
    f.capture.mockImplementation(async () => {
      f.window.bounds.width = 900;
      return { ...f.state, windowBounds: { ...f.window.bounds }, screenshotWidth: 900, images: [...f.state.images] };
    });
    const opening = f.open(); await vi.advanceTimersByTimeAsync(200);
    await expect(opening).resolves.toMatchObject({ width: 900 });
    expect(f.capture).toHaveBeenCalledOnce();
    expect(f.driver.getLastPreparationTiming()?.reusedPendingCapture).toBe(true);
  });

  it('recaptures an expired candidate after the same window becomes visible again', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.command.mockImplementation(async () => { f.window.isOnScreen = true; return { data: {} }; });
    f.capture.mockImplementationOnce(async () => {
      f.window.bounds.width = 900; f.window.isOnScreen = false;
      return { ...f.state, windowBounds: { ...f.window.bounds }, screenshotWidth: 900, images: [...f.state.images] };
    });
    const opening = f.open(); await vi.advanceTimersByTimeAsync(350);
    expect(f.capture).toHaveBeenCalledOnce();
    f.window.isOnScreen = true;
    await vi.advanceTimersByTimeAsync(200);
    await expect(opening).resolves.toMatchObject({ width: 900 });
    expect(f.capture).toHaveBeenCalledTimes(2);
    expect(f.driver.getLastPreparationTiming()?.reusedPendingCapture).toBe(false);
  });

  it.each(['process', 'window', 'cancel'] as const)('refuses a pending capture after %s changes', async reason => {
    vi.useFakeTimers();
    const f = fixture();
    f.command.mockImplementation(async () => { f.window.isOnScreen = true; return { data: {} }; });
    f.capture.mockImplementation(async () => {
      const state = { ...f.state, windowBounds: { ...f.window.bounds, width: 900 }, screenshotWidth: 900, images: [...f.state.images] };
      if (reason === 'process') f.identity.mockResolvedValue('replacement');
      if (reason === 'window') f.windows.mockResolvedValue([{ ...f.window, windowId: 10n }]);
      if (reason === 'cancel') f.controller.abort(new Error('cancelled'));
      return state;
    });
    const failure = expect(f.open()).rejects.toThrow({ process: 'PROCESS_CHANGED', window: 'WINDOW_CHANGED', cancel: 'cancelled' }[reason]);
    await vi.advanceTimersByTimeAsync(200);
    await failure;
    expect(f.capture).toHaveBeenCalledOnce();
    expect(f.driver.getLastPreparationTiming()?.reusedPendingCapture).toBe(false);
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

  it('uses foreground preparation once for a cold app and verifies the launched process', async () => {
    vi.useFakeTimers();
    const f = fixture(); Object.assign(f.driver as any, { foregroundAppPreparation: true });
    f.apps.mockResolvedValueOnce([]); f.window.isOnScreen = true;
    const prepare = vi.spyOn(f.driver as any, 'prepareApplication').mockResolvedValue(undefined);
    const opening = f.open(); await vi.advanceTimersByTimeAsync(500);
    await expect(opening).resolves.toMatchObject({ pid: 42, windowId: '9' });
    expect(prepare).toHaveBeenCalledExactlyOnceWith('fixture', expect.any(AbortSignal));
    expect(f.command).not.toHaveBeenCalled();
  });

  it('restores an off-Space app once and waits for current-Space window evidence', async () => {
    vi.useFakeTimers();
    const f = fixture(); Object.assign(f.driver as any, { foregroundAppPreparation: true });
    Object.assign(f.window, { onCurrentSpace: false });
    const prepare = vi.spyOn(f.driver as any, 'prepareApplication').mockResolvedValue(undefined);
    const opening = f.open(); await vi.advanceTimersByTimeAsync(64);
    expect(f.capture).not.toHaveBeenCalled();
    Object.assign(f.window, { onCurrentSpace: true, isOnScreen: true });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(opening).resolves.toMatchObject({ windowId: '9' });
    expect(prepare).toHaveBeenCalledOnce();
    expect(f.command).not.toHaveBeenCalled();
  });

  it('does not activate another Space when preparation was not requested', async () => {
    const f = fixture(); Object.assign(f.driver as any, { foregroundAppPreparation: true });
    Object.assign(f.window, { onCurrentSpace: false });
    await expect(f.driver.resolveTarget('fixture', f.controller.signal, { prepare: false })).rejects.toThrow('WINDOW_OTHER_SPACE');
    expect(f.command).not.toHaveBeenCalled();
  });

  it('refuses a process change during host activation', async () => {
    const f = fixture(); Object.assign(f.driver as any, { foregroundAppPreparation: true });
    Object.assign(f.window, { onCurrentSpace: false });
    vi.spyOn(f.driver as any, 'prepareApplication').mockImplementation(async () => { f.identity.mockResolvedValue('changed'); });
    await expect(f.open()).rejects.toThrow('PROCESS_CHANGED');
    expect(f.capture).not.toHaveBeenCalled();
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

  it('reuses the preparation frame once after fresh process and geometry checks', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.command.mockImplementation(async () => { f.window.isOnScreen = true; return { data: {} }; });
    const opening = f.open(); await vi.advanceTimersByTimeAsync(100);
    const target = await opening;
    await f.driver.observe(target, f.controller.signal);
    expect(f.capture).toHaveBeenCalledOnce();
    expect(f.driver.getLastPreparationTiming()?.reusedPreparedFrame).toBe(true);
    await f.driver.observe(target, f.controller.signal);
    expect(f.capture).toHaveBeenCalledTimes(2);
  });

  it.each(['expired', 'geometry'] as const)('captures again when the preparation frame is %s', async reason => {
    vi.useFakeTimers();
    const f = fixture();
    f.command.mockImplementation(async () => { f.window.isOnScreen = true; return { data: {} }; });
    const opening = f.open(); await vi.advanceTimersByTimeAsync(100);
    const target = await opening;
    if (reason === 'expired') await vi.advanceTimersByTimeAsync(251);
    else f.window.bounds.width = 900;
    await f.driver.observe(target, f.controller.signal);
    expect(f.capture).toHaveBeenCalledTimes(2);
    expect(f.driver.getLastPreparationTiming()?.reusedPreparedFrame).toBe(false);
  });

  it.each(['file:///tmp/App.app', 'org.example.App --args', '--args'])('refuses non-bundle host activation input %s', async appId => {
    const f = fixture();
    await expect((f.driver as any).prepareApplication(appId, f.controller.signal)).rejects.toThrow('COMPUTER_APP_ID_INVALID');
  });
});

describe('readiness event hints', () => {
  it('consumes early notifications without sleeping and cancels a pending wait', async () => {
    const { ReadinessPulse } = await import('../window-readiness.js');
    vi.useFakeTimers();
    const pulse = new ReadinessPulse(); const controller = new AbortController();
    pulse.notify(); await pulse.wait(controller.signal, 128);
    expect(vi.getTimerCount()).toBe(0);
    const pending = pulse.wait(controller.signal, 128);
    const refused = expect(pending).rejects.toThrow('cancelled');
    controller.abort(new Error('cancelled')); await refused;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('wakes before the watchdog and samples again without treating an event as readiness', async () => {
    const { ReadinessPulse } = await import('../window-readiness.js');
    vi.useFakeTimers(); const pulse = new ReadinessPulse(); const controller = new AbortController();
    const sample = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce('ready');
    const pending = withWindowReadiness(controller.signal, (_signal, poll) => poll(sample), undefined, (s, ms) => pulse.wait(s, ms));
    await vi.advanceTimersByTimeAsync(0); expect(sample).toHaveBeenCalledOnce();
    pulse.notify(); await expect(pending).resolves.toBe('ready'); expect(sample).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});

it('discards workspace hints already covered by a metadata read but retains newer events', async () => {
  const { ReadinessPulse } = await import('../window-readiness.js');
  vi.useFakeTimers(); const pulse = new ReadinessPulse(); const signal = new AbortController().signal;
  pulse.notify(); const beforeRead = pulse.version;
  pulse.acknowledge(beforeRead);
  const waited = pulse.wait(signal, 16);
  expect(vi.getTimerCount()).toBe(1); await vi.advanceTimersByTimeAsync(16); await waited;
  pulse.notify(); const staleRead = pulse.version;
  pulse.notify(); pulse.acknowledge(staleRead);
  await pulse.wait(signal, 16); expect(vi.getTimerCount()).toBe(0);
});
