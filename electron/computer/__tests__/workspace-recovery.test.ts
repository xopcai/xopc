import { afterEach, describe, expect, it, vi } from 'vitest';
import { CuaComputerDriver } from '../cua-driver.js';

function fixture() {
  let following = true;
  const controller = new AbortController();
  const driver = new CuaComputerDriver('/fixture', 'host', undefined, 'darwin', () => following);
  Object.assign(driver, { client: {} });
  vi.spyOn(driver as any, 'start').mockResolvedValue(undefined);
  const identity = vi.spyOn(driver as any, 'processIdentity').mockResolvedValue('identity');
  vi.spyOn(driver as any, 'listApps').mockResolvedValue([{ bundleId: 'fixture', pid: 42 }]);
  const window = { pid: 42, windowId: 9n, bounds: { x: 10, y: 20, width: 800, height: 600 }, isOnScreen: false, onCurrentSpace: false };
  const windows = vi.spyOn(driver as any, 'listWindows').mockImplementation(async () => [{ ...window }]);
  const command = vi.spyOn(driver as any, 'prepareApplication').mockImplementation(async () => {
    window.isOnScreen = true; window.onCurrentSpace = true;
    return { data: {} };
  });
  const state = { pid: 42, windowId: 9n, windowBounds: window.bounds, screenshotWidth: 800, screenshotHeight: 600,
    screenshotFrameValid: true, elements: [{ elementIndex: 0n, role: 'AXWindow', depth: 0 },
      { elementIndex: 1n, parentIndex: 0n, role: 'AXStaticText', depth: 1, label: '1068' }],
    images: [{ mimeType: 'image/png', dataBase64: 'AQID' }] };
  const capture = vi.spyOn(driver as any, 'getWindowState').mockImplementation(async () => window.onCurrentSpace ? state
    : { ...state, images: [], screenshotFrameValid: false });
  const perform = vi.spyOn(driver, 'perform');
  const target = { appId: 'fixture', pid: 42, processIdentity: 'identity', windowId: '9', width: 800, height: 600, geometryRevision: 'original' };
  return { driver, controller, identity, window, windows, command, capture, perform, target, revoke: () => { following = false; } };
}
afterEach(() => vi.useRealTimers());
describe('authorized cross-Space recovery', () => {
  it('reveals the exact existing window even for a read-only preparation-free open', async () => {
    const f = fixture();
    expect(await f.driver.resolveTarget('fixture', f.controller.signal, { prepare: false })).toMatchObject({ pid: 42, windowId: '9' });
    expect(f.command).toHaveBeenCalledExactlyOnceWith('fixture', expect.any(AbortSignal));
    expect(f.capture).not.toHaveBeenCalled(); expect(f.perform).not.toHaveBeenCalled();
  });
  it('recovers a verification capture without repeating the previous calculator input', async () => {
    const f = fixture();
    const result = await f.driver.observe(f.target, f.controller.signal);
    expect(result.summary).toContain('1068');
    expect(f.capture).toHaveBeenCalledTimes(2);
    expect(f.command).toHaveBeenCalledExactlyOnceWith('fixture', expect.any(AbortSignal));
    expect(f.perform).not.toHaveBeenCalled();
  });
  it('refuses process replacement after activation without capturing or sending input', async () => {
    const f = fixture();
    f.command.mockImplementation(async () => { f.identity.mockResolvedValue('replacement'); return { data: {} }; });
    await expect(f.driver.observe(f.target, f.controller.signal)).rejects.toThrow('COMPUTER_PROCESS_CHANGED');
    expect(f.capture).toHaveBeenCalledOnce(); expect(f.perform).not.toHaveBeenCalled();
  });
  it('never follows a replacement window during recovery', async () => {
    const f = fixture();
    f.command.mockImplementation(async () => { f.windows.mockResolvedValue([{ ...f.window, windowId: 10n }]); return { data: {} }; });
    await expect(f.driver.observe(f.target, f.controller.signal)).rejects.toThrow('COMPUTER_WINDOW_CHANGED');
    expect(f.capture).toHaveBeenCalledOnce(); expect(f.perform).not.toHaveBeenCalled();
  });
  it('stops if the chat can no longer follow the active desktop', async () => {
    const f = fixture();
    f.command.mockImplementation(async () => { f.revoke(); return { data: {} }; });
    await expect(f.driver.observe(f.target, f.controller.signal)).rejects.toThrow('COMPUTER_LOCAL_UI_REQUIRED');
    expect(f.capture).toHaveBeenCalledOnce(); expect(f.perform).not.toHaveBeenCalled();
  });
  it('bounds a refused Space transition without repeated activation', async () => {
    vi.useFakeTimers(); const f = fixture();
    f.command.mockResolvedValue({ data: {} });
    const pending = f.driver.observe(f.target, f.controller.signal);
    const rejected = expect(pending).rejects.toThrow('COMPUTER_WINDOW_READY_TIMEOUT');
    await vi.advanceTimersByTimeAsync(5000); await rejected;
    expect(f.command).toHaveBeenCalledOnce(); expect(f.capture).toHaveBeenCalledOnce(); expect(f.perform).not.toHaveBeenCalled();
  });
  it('keeps the manual fallback when there is no host workspace lease', async () => {
    const f = fixture(); f.revoke();
    await expect(f.driver.observe(f.target, f.controller.signal)).rejects.toThrow('COMPUTER_WINDOW_OTHER_SPACE');
    expect(f.command).not.toHaveBeenCalled(); expect(f.perform).not.toHaveBeenCalled();
  });
});
