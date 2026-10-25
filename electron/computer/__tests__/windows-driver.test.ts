import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CuaComputerDriver } from '../cua-driver.js';
import { normalizeWindowsAccessibility } from '../windows-accessibility.js';
import { windowsAppIdentity, windowsAppMatches, assertWindowsAppAllowed } from '../windows-apps.js';
import { normalizeComputerKeys } from '../../../src/computer/keyboard.js';

const native = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../windows-native.js', () => ({ readWindowsComputerIdentity: native.read }));
const calculator = { bundleId: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe',
  launchPath: 'shell:appsFolder\\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App',
  name: 'Calculator', kind: 'uwp', pid: 0, running: false, active: false };
const identity = { processIdentity: '42:start', executable: 'C:\\Windows\\System32\\ApplicationFrameHost.exe',
  appIds: ['Microsoft.WindowsCalculator_8wekyb3d8bbwe!App'], sessionId: 1 };
const appId = windowsAppIdentity(calculator)!.appId;
const signal = () => AbortSignal.timeout(10_000);

beforeEach(() => native.read.mockReset());

describe('Windows application identity', () => {
  it('keeps canonical IDs stable across case changes without exposing paths to the protocol', () => {
    const app = { ...calculator, bundleId: 'C:\\Program Files\\Example\\Example.exe', launchPath: 'untrusted shortcut arguments', kind: 'desktop' };
    const first = windowsAppIdentity(app)!;
    expect(first.appId).toMatch(/^win-[0-9a-f]{64}$/);
    expect(first.appId).toBe(windowsAppIdentity({ ...app, bundleId: app.bundleId.toLowerCase() })!.appId);
    expect(first.launch).toEqual({ path: app.bundleId });
    expect(windowsAppIdentity({ ...app, bundleId: 'example.exe' })).toBeUndefined();
  });
  it('does not confuse different packaged apps hosted by the same process', () => {
    expect(windowsAppMatches(calculator, identity)).toBe(true);
    expect(windowsAppMatches(calculator, { ...identity, appIds: ['windows.immersivecontrolpanel_cw5n1h2txyewy!App'] })).toBe(false);
    expect(windowsAppMatches(calculator, { ...identity, appIds: [...identity.appIds, 'other!App'] })).toBe(false);
  });
  it.each(['powershell.exe', 'cmd.exe', 'pwsh.exe', 'regedit.exe', 'xopc.exe', 'electron.exe', 'SystemSettings.exe', '1Password.exe'])(
    'denies sensitive or self-control target %s', name => {
      expect(() => assertWindowsAppAllowed({ ...calculator, bundleId: `C:\\Apps\\${name}`, launchPath: '', kind: 'desktop' })).toThrow('MANUAL_ONLY');
    });
});

describe('Windows bound windows', () => {
  function fixture() {
    const driver = new CuaComputerDriver('C:\\driver.exe', 'host', undefined, 'win32');
    vi.spyOn(driver as any, 'start').mockResolvedValue(undefined);
    const listApps = vi.fn().mockResolvedValue({ apps: [calculator,
      { pid: 42, name: 'ApplicationFrameHost.exe', running: true, active: true, kind: 'desktop' }] });
    const windows = [9n, 10n].map(windowId => ({ windowId, pid: 42, title: '', bounds: { x: 0, y: 0, width: 800, height: 600 }, isOnScreen: true, layer: 0 }));
    const listWindows = vi.fn().mockResolvedValue({ windows });
    Object.assign(driver as any, { client: { listApps, listWindows } });
    native.read.mockImplementation(async (_pid: number, windowId?: string) => ({ ...identity,
      appIds: windowId === '10' ? ['windows.immersivecontrolpanel_cw5n1h2txyewy!App'] : identity.appIds }));
    return { driver, listWindows };
  }
  it('resolves only the authorized Calculator window, excluding sibling Settings on the same PID', async () => {
    const { driver } = fixture();
    expect(await driver.discover('calc', signal())).toEqual([{ appId, name: 'Calculator', running: true }]);
    const target = await driver.resolveTarget(appId, signal(), { prepare: false });
    expect(target).toMatchObject({ pid: 42, windowId: '9', processIdentity: '42:start' });
  });
  it('refuses a window whose packaged identity changed even when PID and HWND were reused', async () => {
    const { driver } = fixture();
    await driver.discover('', signal());
    const target = await driver.resolveTarget(appId, signal(), { prepare: false });
    native.read.mockResolvedValue({ ...identity, appIds: ['windows.immersivecontrolpanel_cw5n1h2txyewy!App'] });
    await expect(driver.observe(target, signal())).rejects.toThrow('WINDOW_APP_CHANGED');
    await expect(driver.perform(target, { kind: 'click', point: { x: 1, y: 1 }, button: 'left', count: 1 }, signal())).rejects.toThrow('WINDOW_APP_CHANGED');
  });
});

describe('Windows observation and action boundaries', () => {
  it('retains unindexed status labels without exposing text nested inside an input subtree', () => {
    const state = normalizeWindowsAccessibility([], '- Window "Fixture"\n  - Edit "Protected"\n    - Text "do-not-disclose"\n  - Text "PASS: verified"');
    expect(state.text).toContain('PASS: verified');
    expect(state.text).not.toContain('do-not-disclose');
    expect(state.truncated).toBe(true);
  });
  it('retains rootless UIA content under a synthetic window without inventing executable refs or complete coverage', () => {
    const state = normalizeWindowsAccessibility([
      { element_index: '0', role: 'Window', depth: 1, element_token: 'title', actions: ['set_value'] },
      { element_index: '8', role: 'Text', depth: 4, label: '显示为 42', actions: ['invoke'] },
      { element_index: '31', role: 'Button', depth: 5, element_token: 'seven', label: '七', actions: ['invoke'] },
    ]);
    expect(state.truncated).toBe(true);
    expect(state.elements[0]).toMatchObject({ role: 'AXWindow', depth: 0 });
    expect(state.elements[0].element_token).toBeUndefined();
    expect(state.elements[2]).toMatchObject({ role: 'AXStaticText', actions: [] });
    expect(state.elements[3]).toMatchObject({ role: 'AXButton', actions: ['AXPress'], element_token: 'seven' });
    expect(state.text).toContain('显示为 42');
  });
  it('refuses uncertified secure editing and Windows global shortcuts', () => {
    const driver = new CuaComputerDriver('C:\\driver.exe', 'host', undefined, 'win32');
    expect(() => driver.validateAction({ kind: 'typeText', text: 'secret', point: { x: 1, y: 1 } })).toThrow('EDITABLE_TARGET_REQUIRED');
    expect(() => driver.validateAction({ kind: 'pressKeys', keys: ['alt', 'f4'] })).toThrow('UNSAFE');
    expect(() => driver.validateAction({ kind: 'pressKeys', keys: ['ctrl', 'v'] })).toThrow('KEY_TARGET_REQUIRED');
    expect(() => driver.validateAction({ kind: 'pressKeys', keys: ['a'] })).toThrow('KEY_TARGET_REQUIRED');
    expect(() => normalizeComputerKeys(['meta', 'a'], 'win32')).toThrow('NOT_SUPPORTED');
    expect(normalizeComputerKeys(['backspace'], 'win32')).toEqual(['backspace']);
    expect(normalizeComputerKeys(['delete'], 'win32')).toEqual(['delete']);
    expect(normalizeComputerKeys(['backspace'], 'darwin')).toEqual(['delete']);
  });
});
