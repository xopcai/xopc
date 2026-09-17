import { afterEach, describe, expect, it, vi } from 'vitest';

const io = vi.hoisted(() => ({ access: vi.fn(), mkdtemp: vi.fn(), rm: vi.fn(), rmdir: vi.fn(), spawn: vi.fn() }));
vi.mock('node:fs/promises', () => io);
vi.mock('node:child_process', async (original) => ({ ...await original<typeof import('node:child_process')>(), spawn: io.spawn }));
import { CuaComputerDriver, scopeWindowAccessibility } from '../cua-driver.js';

const priorType = Object.getOwnPropertyDescriptor(process, 'type');
afterEach(() => { vi.resetAllMocks(); if (priorType) Object.defineProperty(process, 'type', priorType); else delete (process as any).type; });
describe('private native driver admission', () => {
  function native(windows: Array<Record<string, unknown>>, apps = [{ bundle_id: 'fixture', name: '飞书', pid: 42, running: true }]) {
    const driver = new CuaComputerDriver('/fixture/cua-driver', 'host');
    vi.spyOn(driver as any, 'start').mockResolvedValue(undefined);
    vi.spyOn(driver as any, 'processIdentity').mockResolvedValue('42:fixture-start');
    const call = vi.spyOn(driver as any, 'call').mockImplementation(async (name: unknown, args: any) => ({ data: name === 'list_apps' ? { apps }
      : name === 'get_window_state' ? { pid: 42, window_id: args.window_id, elements: [{ role: 'AXWindow', depth: 0 }] } : { windows } }));
    return { driver, call };
  }
  const window = (id: number, title: string, visible = true, z_index?: number) => ({ window_id: id, pid: 42, title, is_on_screen: visible, z_index,
    bounds: { x: 0, y: 0, width: 800, height: 600 } });
  it('discovers localized names and installed apps without capturing windows', async () => {
    const f = native([], [{ bundle_id: 'fixture', name: '飞书', pid: 0, running: false }, { bundle_id: 'com.apple.Terminal', name: 'Terminal', pid: 7, running: true }]);
    expect(await f.driver.discover('飞书', new AbortController().signal)).toEqual([{ appId: 'fixture', name: '飞书', running: false }]);
    expect(await f.driver.discover('', new AbortController().signal)).toHaveLength(1);
    expect(f.call.mock.calls.every(([name]) => name === 'list_apps')).toBe(true);
  });
  it('uses explicit native stacking metadata, not window area or array order', async () => {
    const f = native([window(9, 'Back', true, 1), window(10, 'Front', true, 5)]);
    expect(await f.driver.resolveTarget('fixture', new AbortController().signal, { prepare: false })).toMatchObject({ windowId: '10' });
  });
  it('prefers an actual AXWindow over higher menu/proxy windows without taking screenshots', async () => {
    const f = native([window(9, 'Document', true, 1), window(10, '', true, 99)]);
    f.call.mockImplementation(async (name: unknown, args: any) => ({ data: name === 'list_apps'
      ? { apps: [{ bundle_id: 'fixture', pid: 42 }] }
      : name === 'list_windows' ? { windows: [window(9, 'Document', true, 1), window(10, '', true, 99)] }
      : { pid: 42, window_id: args.window_id, elements: args.window_id === 9 ? [{ role: 'AXWindow', depth: 0 }] : [] } }));
    expect(await f.driver.resolveTarget('fixture', new AbortController().signal, { prepare: false })).toMatchObject({ windowId: '9' });
    for (const [name, args] of f.call.mock.calls) if (name === 'get_window_state') expect(args).toMatchObject({ include_screenshot: false, max_elements: 1 });
  });
  it('starts only the catalogued app when preparation is authorized', async () => {
    const f = native([]); let running = false;
    f.call.mockImplementation(async (name: unknown) => {
      if (name === 'launch_app') running = true;
      return { data: name === 'list_apps' ? { apps: [{ bundle_id: 'fixture', pid: running ? 42 : 0 }] } : { windows: [window(9, 'Document')] } };
    });
    expect(await f.driver.resolveTarget('fixture', new AbortController().signal, { prepare: true })).toMatchObject({ windowId: '9' });
    expect(f.call).toHaveBeenCalledWith('launch_app', { bundle_id: 'fixture' }, expect.any(AbortSignal));
  });
  it('returns window references on ambiguity and can bind the selected window', async () => {
    const f = native([window(9, 'First'), window(10, 'Second')]);
    const error = await f.driver.resolveTarget('fixture', new AbortController().signal, { prepare: false }).catch(error => error);
    expect(error.message).toBe('COMPUTER_WINDOW_AMBIGUOUS');
    expect(error.windows).toHaveLength(2);
    expect(await f.driver.resolveTarget('fixture', new AbortController().signal, { prepare: false, windowRef: error.windows[1].windowRef })).toMatchObject({ windowId: '10' });
    vi.spyOn(f.driver as any, 'processIdentity').mockResolvedValue('42:new-process');
    await expect(f.driver.resolveTarget('fixture', new AbortController().signal, { prepare: false, windowRef: error.windows[1].windowRef })).rejects.toThrow('WINDOW_CHANGED');
  });
  it('never starts an app during an unprepared read-only attach', async () => {
    const f = native([], [{ bundle_id: 'fixture', name: '飞书', pid: 0, running: false }]);
    await expect(f.driver.resolveTarget('fixture', new AbortController().signal, { prepare: false })).rejects.toThrow('APP_NOT_RUNNING');
    expect(f.call).not.toHaveBeenCalledWith('launch_app', expect.anything(), expect.anything());
  });
  it('restores only an explicitly prepared target and checks the resulting visibility', async () => {
    const rows = [window(9, 'First', false)]; const f = native(rows);
    await expect(f.driver.resolveTarget('fixture', new AbortController().signal, { prepare: false })).rejects.toThrow('WINDOW_REQUIRED');
    expect(f.call).not.toHaveBeenCalledWith('bring_to_front', expect.anything(), expect.anything());
    f.call.mockImplementation(async (name: unknown) => {
      if (name === 'bring_to_front') rows[0].is_on_screen = true;
      return { data: name === 'list_apps' ? { apps: [{ bundle_id: 'fixture', pid: 42 }] } : { windows: rows } };
    });
    expect(await f.driver.resolveTarget('fixture', new AbortController().signal, { prepare: true })).toMatchObject({ windowId: '9' });
    expect(f.call).toHaveBeenCalledWith('bring_to_front', { pid: 42, window_id: 9 }, expect.any(AbortSignal));
  });
  it('also brings an already-visible window forward when preparation is authorized', async () => {
    const f = native([window(9, 'Today', true)]);
    await f.driver.resolveTarget('fixture', new AbortController().signal, { prepare: false });
    expect(f.call).not.toHaveBeenCalledWith('bring_to_front', expect.anything(), expect.anything());
    await f.driver.resolveTarget('fixture', new AbortController().signal, { prepare: true });
    expect(f.call).toHaveBeenCalledWith('bring_to_front', { pid: 42, window_id: 9 }, expect.any(AbortSignal));
  });
  it.each(['ai.xopc.xopc', 'com.github.Electron', 'custom.host'])('refuses self-control of %s before starting the driver', async appId => {
    const driver = new CuaComputerDriver('/fixture/cua-driver', 'custom.host');
    await expect(driver.resolveTarget(appId, new AbortController().signal, { prepare: false })).rejects.toThrow('SELF_CONTROL_DENIED');
    expect(io.access).not.toHaveBeenCalled();
  });
  it('excludes application menus and recent-item metadata from a window observation', () => {
    const scoped = scopeWindowAccessibility({ tree_markdown: '- [0] AXWindow "Fixture"\n  - AXStaticText = "PASS"\n  - [1] AXButton "Continue"\n- [2] AXMenuBar\n  - [3] AXMenuItem "private recent item"',
      elements: [{ role: 'AXWindow', depth: 0, element_index: 0 }, { role: 'AXButton', depth: 1, parent_index: 0, element_index: 1 },
        { role: 'AXMenuBar', depth: 0, element_index: 2 }, { role: 'AXMenuItem', depth: 1, parent_index: 2, element_index: 3, label: 'private recent item' }] });
    expect(scoped.elements.map(item => item.element_index)).toEqual([0, 1]);
    expect(scoped.text).toContain('PASS');
    expect(JSON.stringify(scoped)).not.toMatch(/AXMenu|private recent/);
    expect(scopeWindowAccessibility({ elements: [{ role: 'AXMenuBar', depth: 0, element_index: 0 }], tree_markdown: 'private menu' })).toEqual({ elements: [], text: '' });
  });
  it('includes static outcome text without exposing native element tokens', async () => {
    const driver = new CuaComputerDriver('/fixture/cua-driver', 'host');
    vi.spyOn(driver as any, 'processIdentity').mockResolvedValue('42:fixture-start');
    vi.spyOn(driver as any, 'call').mockResolvedValue({
      data: { pid: 42, window_id: 9, screenshot_frame_valid: true, window_bounds: { x: 0, y: 0, width: 800, height: 600 }, screenshot_width: 800, screenshot_height: 600,
        tree_markdown: '- [0] AXWindow "Fixture"\n  - AXStaticText = "PASS: Continue clicked"', elements: [
          { element_index: 0, role: 'AXWindow', depth: 0 },
          { element_index: 1, parent_index: 0, depth: 1, element_token: 'private-native-token', role: 'AXButton', label: 'Continue' }] },
      content: [{ type: 'image', mimeType: 'image/png', data: 'AQID' }],
    });
    const frame = await driver.observe({ appId: 'fixture', pid: 42, processIdentity: '42:fixture-start', windowId: '9', width: 800, height: 600, geometryRevision: '1' }, new AbortController().signal);
    expect(frame.summary).toContain('PASS: Continue clicked');
    expect(frame.summary).toContain('e1');
    expect(frame.summary).not.toContain('private-native-token');
  });
  it('preserves valid pixels and explicitly reports unavailable accessibility content', async () => {
    const driver = new CuaComputerDriver('/fixture/cua-driver', 'host');
    vi.spyOn(driver as any, 'processIdentity').mockResolvedValue('42:fixture-start');
    vi.spyOn(driver as any, 'call').mockResolvedValue({ data: { pid: 42, window_id: 9, screenshot_frame_valid: true,
      window_bounds: { x: 0, y: 0, width: 800, height: 600 }, screenshot_width: 800, screenshot_height: 600, elements: [] },
      content: [{ type: 'image', mimeType: 'image/png', data: 'AQID' }] });
    const result = await driver.observe({ appId: 'fixture', pid: 42, processIdentity: '42:fixture-start', windowId: '9', width: 800, height: 600, geometryRevision: '1' }, new AbortController().signal);
    expect(result.summary).toContain('Use observe with a visual question');
    expect(Array.from(result.image)).toEqual([1, 2, 3]);
  });
  it('accepts native app catalogs containing processes without a bundle identifier', async () => {
    const driver = new CuaComputerDriver('/fixture/cua-driver', 'host');
    vi.spyOn(driver as any, 'start').mockResolvedValue(undefined);
    vi.spyOn(driver as any, 'processIdentity').mockResolvedValue('42:fixture-start');
    vi.spyOn(driver as any, 'call')
      .mockResolvedValueOnce({ data: { apps: [{ bundle_id: null, pid: 10 }, { bundle_id: 'fixture', pid: 42, running: true }] } })
      .mockResolvedValueOnce({ data: { windows: [{ window_id: 9, pid: 42, bounds: { x: 0, y: 0, width: 800, height: 600 }, is_on_screen: true }] } });
    await expect(driver.resolveTarget('fixture', new AbortController().signal, { prepare: false })).resolves.toMatchObject({ appId: 'fixture', pid: 42, windowId: '9' });
  });
  it('cancels startup before spawning when stop races with binary access', async () => {
    Object.defineProperty(process, 'type', { value: 'browser', configurable: true });
    let release!: () => void;
    io.access.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    const driver = new CuaComputerDriver('/fixture/cua-driver', 'host');
    const starting = driver.resolveTarget('fixture', new AbortController().signal, { prepare: false });
    const rejected = expect(starting).rejects.toThrow('STOPPED');
    const stopped = driver.stop(); release(); await stopped; await rejected;
    expect(io.spawn).not.toHaveBeenCalled();
  });
  it('cleans a directory created concurrently with stop without late input', async () => {
    Object.defineProperty(process, 'type', { value: 'browser', configurable: true });
    io.access.mockResolvedValue(undefined); io.rm.mockResolvedValue(undefined); io.rmdir.mockResolvedValue(undefined);
    let release!: (path: string) => void;
    io.mkdtemp.mockImplementation(() => new Promise<string>(resolve => { release = resolve; }));
    const driver = new CuaComputerDriver('/fixture/cua-driver', 'host');
    const starting = driver.resolveTarget('fixture', new AbortController().signal, { prepare: false });
    const rejected = expect(starting).rejects.toThrow('STOPPED');
    await vi.waitFor(() => expect(io.mkdtemp).toHaveBeenCalled());
    const stopped = driver.stop(); release('/private/tmp/xc-owned'); await stopped; await rejected;
    expect(io.spawn).not.toHaveBeenCalled(); expect(io.rmdir).toHaveBeenCalledWith('/private/tmp/xc-owned');
  });
  it('rejects ungrounded text and unsafe/global shortcuts', () => {
    const driver = new CuaComputerDriver('/fixture/cua-driver', 'host');
    expect(() => driver.validateAction({ kind: 'typeText', text: 'secret' })).toThrow('EDITABLE');
    expect(() => driver.validateAction({ kind: 'pressKeys', keys: ['cmd', 'q'] })).toThrow('UNSAFE');
    expect(() => driver.validateAction({ kind: 'pressKeys', keys: ['cmd', 'shift', 'a'] })).not.toThrow();
    expect(() => driver.validateAction({ kind: 'scroll', point: { x: 0, y: 0 }, deltaX: 1, deltaY: 1 })).toThrow('ONE_AXIS');
  });
});
