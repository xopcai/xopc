import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CuaComputerDriver } from '../cua-driver.js';
import { enrichWindowsInput, windowsInputAllowed } from '../windows-input.js';
import type { WindowsInputField } from '../windows-native.js';

const native = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../windows-native.js', () => ({ readWindowsComputerIdentity: native.read }));
const field: WindowsInputField = { runtimeId: '42,1', role: 'ControlType.Edit', password: false,
  enabled: true, writable: true, offscreen: false, x: 100, y: 100, w: 200, h: 60 };
const row = { element_index: '0', element_token: 'private-token', role: 'Edit', depth: 1,
  label: 'Message', value: 'existing', frame: { x: 100, y: 100, w: 200, h: 60 }, actions: ['set_value'] };
beforeEach(() => native.read.mockReset());

describe('native Windows input certification', () => {
  it.each([{ password: true }, { password: null }, { enabled: false }, { writable: false }, { offscreen: true }])(
    'refuses unsafe or unknown native input metadata: %j', override => {
      const unsafe = { ...field, ...override };
      expect(windowsInputAllowed(unsafe)).toBe(false);
      const [element] = enrichWindowsInput([{ ...row, label: 'do-not-disclose', value: 'private-value' }], { fields: [unsafe], focused: unsafe });
      expect(element.inputAllowed).toBe(false);
      expect(JSON.stringify(element)).not.toMatch(/do-not-disclose|private-value/);
    });
  it('does not match a field by label, overlapping geometry, or stale coordinates', () => {
    for (const fields of [[field, { ...field, runtimeId: '42,2' }], [{ ...field, x: 101 }], []]) {
      expect(enrichWindowsInput([row], { fields, focused: null })[0].inputAllowed).toBe(false);
    }
  });
  it('matches the WinForms multiline Edit/Document proxy difference by exact native bounds', () => {
    const [element] = enrichWindowsInput([row], { fields: [{ ...field, role: 'ControlType.Document' }],
      focused: { ...field, role: 'ControlType.Document' } });
    expect(element).toMatchObject({ inputAllowed: true, keyboardFocused: true });
  });
});

describe('Windows input dispatch', () => {
  function fixture() {
    const driver = new CuaComputerDriver('C:\\driver.exe', 'host', undefined, 'win32');
    const target = { appId: 'fixture', pid: 42, processIdentity: '42:start', windowId: '9', width: 800, height: 600, geometryRevision: '1' };
    const identity = { processIdentity: '42:start', executable: 'C:\\Apps\\fixture.exe', appIds: [], sessionId: 1,
      input: { fields: [field], focused: field } };
    (driver as any).windowsApps.set('fixture', { bundleId: identity.executable, name: 'fixture', pid: 42, running: true, active: true });
    native.read.mockResolvedValue(identity);
    vi.spyOn(driver as any, 'processIdentity').mockResolvedValue('42:start');
    vi.spyOn(driver as any, 'getWindowState').mockResolvedValue({ pid: 42, windowId: 9n,
      windowBounds: { x: 0, y: 0, width: 800, height: 600 }, screenshotWidth: 800, screenshotHeight: 600,
      elements: [{ elementIndex: 0n, elementToken: 'private-token', role: 'Edit', depth: 1,
        label: 'Message', value: 'existing', enabled: true, actions: ['set_value'], frame: row.frame }],
      images: [{ mimeType: 'image/png', dataBase64: 'AQID' }] });
    class Target { constructor(readonly inner: unknown) {} }
    Object.assign(driver as any, { client: {}, sdk: { ActionTarget: { Window: Target } } });
    const call = vi.spyOn(driver as any, 'callUntyped').mockResolvedValue({ data: {}, content: [] });
    return { driver, target, identity, call, signal: AbortSignal.timeout(10_000) };
  }
  it('types only into a certified field by its private Cua token', async () => {
    const f = fixture();
    const observed = await f.driver.observe(f.target, f.signal);
    const context = JSON.parse(observed.summary);
    expect(context.platform).toBe('win32');
    expect(observed.summary).not.toMatch(/private-token|42,1|windows_runtime_id|windows_focus_id/);
    const input = context.elements.find((e: any) => e.label === 'Message');
    expect(input).toMatchObject({ inputAllowed: true, keyboardFocused: true });
    await f.driver.perform(f.target, { kind: 'typeText', point: { x: 150, y: 130 }, text: '中文🙂' }, f.signal);
    expect(f.call).toHaveBeenCalledWith('type_text', expect.objectContaining({ pid: 42, window_id: 9,
      element_token: 'private-token', text: '中文🙂', delivery_mode: 'background' }), f.signal);
  });
  it('sets exact field values and targets background keys to the verified focused element', async () => {
    const f = fixture(); await f.driver.observe(f.target, f.signal);
    await f.driver.perform(f.target, { kind: 'setValue', ref: 'e0', text: 'new value' }, f.signal);
    expect(f.call).toHaveBeenCalledWith('set_value', expect.objectContaining({ element_token: 'private-token', value: 'new value' }), f.signal);
    await f.driver.perform(f.target, { kind: 'pressKeys', keys: ['ctrl', 'a'] }, f.signal);
    expect(f.call).toHaveBeenCalledWith('hotkey', expect.objectContaining({
      pid: 42, window_id: 9, element_token: 'private-token', delivery_mode: 'background', keys: ['ctrl', 'a'] }), f.signal);
  });
  it('refuses changed secure state before any native input, without fallback', async () => {
    const f = fixture(); await f.driver.observe(f.target, f.signal);
    native.read.mockResolvedValue({ ...f.identity, input: { ...f.identity.input, fields: [{ ...field, password: true }] } });
    await expect(f.driver.perform(f.target, { kind: 'setValue', ref: 'e0', text: 'must-not-write' }, f.signal)).rejects.toThrow('EDIT_TARGET_CHANGED');
    expect(f.call).not.toHaveBeenCalled();
  });
  it('refuses a changed focus or lost metadata', async () => {
    const f = fixture(); await f.driver.observe(f.target, f.signal);
    native.read.mockResolvedValue({ ...f.identity, input: { ...f.identity.input, focused: null } });
    await expect(f.driver.perform(f.target, { kind: 'pressKeys', keys: ['a'] }, f.signal)).rejects.toThrow('KEY_TARGET_CHANGED');
    expect(f.call).not.toHaveBeenCalled();
    native.read.mockResolvedValue({ ...f.identity, input: undefined });
    const unknown = await f.driver.observe(f.target, f.signal);
    expect(unknown.summary).not.toContain('existing');
    expect(() => f.driver.validateAction({ kind: 'typeText', point: { x: 150, y: 130 }, text: 'x' })).toThrow('EDITABLE_TARGET_REQUIRED');
  });
  it('does not replay key input after an uncertain native error', async () => {
    const f = fixture(); await f.driver.observe(f.target, f.signal);
    f.call.mockRejectedValue(new Error('COMPUTER_DRIVER_KEY_REFUSED'));
    await expect(f.driver.perform(f.target, { kind: 'pressKeys', keys: ['end'] }, f.signal)).rejects.toThrow('KEY_REFUSED');
    expect(f.call).toHaveBeenCalledTimes(1);
  });
  it('does not use keys to bypass an ambiguous text-field certification', async () => {
    const f = fixture();
    native.read.mockResolvedValue({ ...f.identity, input: { fields: [field, { ...field, runtimeId: '42,2' }], focused: field } });
    await f.driver.observe(f.target, f.signal);
    expect(() => f.driver.validateAction({ kind: 'pressKeys', keys: ['ctrl', 'v'] })).toThrow('KEY_TARGET_REQUIRED');
    expect(f.call).not.toHaveBeenCalled();
  });
});
