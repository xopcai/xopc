import { afterEach, describe, expect, it, vi } from 'vitest';

const io = vi.hoisted(() => ({ access: vi.fn() }));
vi.mock('node:fs/promises', () => io);
import { CuaComputerDriver, scopeWindowAccessibility, summarizeWindowAccessibility } from '../cua-driver.js';

const priorType = Object.getOwnPropertyDescriptor(process, 'type');
afterEach(() => { vi.resetAllMocks(); if (priorType) Object.defineProperty(process, 'type', priorType); else delete (process as any).type; });
describe('private native driver admission', () => {
  function native(windows: Array<Record<string, unknown>>, apps = [{ bundle_id: 'fixture', name: '飞书', pid: 42, running: true }]) {
    const driver = new CuaComputerDriver('/fixture/cua-driver', 'host');
    vi.spyOn(driver as any, 'start').mockResolvedValue(undefined);
    vi.spyOn(driver as any, 'processIdentity').mockResolvedValue('42:fixture-start');
    const call = vi.spyOn(driver as any, 'callUntyped').mockImplementation(async (name: unknown, args: any) => ({ data: name === 'list_apps' ? { apps }
      : name === 'get_window_state' ? { pid: 42, window_id: args.window_id, elements: [{ role: 'AXWindow', depth: 0 }] } : { windows } }));
    vi.spyOn(driver as any, 'listApps').mockImplementation(async () => {
      const rows = (await call('list_apps', {})).data.apps as Array<any>;
      return rows.map(row => ({ pid: row.pid, name: row.name ?? '', running: row.running ?? row.pid > 0, active: false,
        bundleId: row.bundle_id ?? undefined, launchPath: row.launch_path ?? undefined }));
    });
    vi.spyOn(driver as any, 'listWindows').mockImplementation(async (pid: number) => {
      const rows = (await call('list_windows', { pid })).data.windows as Array<any>;
      return rows.filter(row => row.pid === pid).map(row => ({ windowId: BigInt(row.window_id), pid: row.pid, appName: '', title: row.title ?? '',
        bounds: row.bounds, isOnScreen: row.is_on_screen, zIndex: row.z_index == null ? undefined : BigInt(row.z_index) }));
    });
    vi.spyOn(driver as any, 'getWindowState').mockImplementation(async (pid: number, windowId: bigint, options: any) => {
      const data = (await call('get_window_state', { pid, window_id: Number(windowId), include_screenshot: options.includeScreenshot,
        max_elements: options.maxElements, max_depth: options.maxDepth, max_dimension: options.maxDimension })).data as any;
      return { pid: data.pid, windowId: BigInt(data.window_id), degraded: data.degraded,
        elements: data.elements?.map((element: any, index: number) => ({ elementIndex: BigInt(element.element_index ?? index), ...element })), images: [] };
    });
    class WindowTarget { inner: unknown; constructor(inner: unknown) { this.inner = inner; } }
    class Coordinates { inner: unknown; constructor(inner: unknown) { this.inner = inner; } }
    const client = { click: vi.fn(), pressKey: vi.fn(), hotkey: vi.fn(), scroll: vi.fn() };
    Object.assign(driver as any, { client, sdk: { ActionTarget: { Window: WindowTarget }, ClickPosition: { Coordinates },
      ClickButton: { Left: 'left', Right: 'right' }, InputDeliveryMode: { Background: 'background' },
      ScrollDirection: { Up: 'up', Down: 'down', Left: 'left', Right: 'right' }, ScrollBy: { Line: 'line' } } });
    return { driver, call, client };
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
  it('restores a hidden multi-surface app before selecting its now-visible main window', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => window(i + 1, i === 4 ? 'Today' : '', false));
    const f = native(rows);
    f.call.mockImplementation(async (name: unknown, args: any) => {
      if (name === 'bring_to_front' && args.window_id === undefined) rows[4].is_on_screen = true;
      if (name === 'get_window_state') {
        if (args.window_id !== 5) throw new Error('proxy unavailable');
        return { data: { pid: 42, window_id: 5, elements: [{ role: 'AXWindow', depth: 0 }] } };
      }
      return { data: name === 'list_apps' ? { apps: [{ bundle_id: 'fixture', pid: 42 }] } : { windows: rows } };
    });
    expect(await f.driver.resolveTarget('fixture', new AbortController().signal, { prepare: true })).toMatchObject({ windowId: '5' });
    expect(f.call).toHaveBeenCalledWith('bring_to_front', { pid: 42 }, expect.any(AbortSignal));
    expect(f.call).toHaveBeenCalledWith('bring_to_front', { pid: 42, window_id: 5 }, expect.any(AbortSignal));
  });
  it('does not restore an unprepared app or infer the target from its only nonempty title', async () => {
    const f = native([window(9, 'Today', false), window(10, '', false)]);
    await expect(f.driver.resolveTarget('fixture', new AbortController().signal, { prepare: false })).rejects.toThrow('WINDOW_AMBIGUOUS');
    expect(f.call).not.toHaveBeenCalledWith('bring_to_front', expect.anything(), expect.anything());
  });
  it('retains an unknown visible window instead of discarding it as a proxy', async () => {
    const rows = [window(9, 'First'), window(10, '')]; const f = native(rows);
    f.call.mockImplementation(async (name: unknown, args: any) => {
      if (name === 'get_window_state' && args.window_id === 10) throw new Error('timeout');
      return { data: name === 'list_apps' ? { apps: [{ bundle_id: 'fixture', pid: 42 }] }
        : name === 'get_window_state' ? { pid: 42, window_id: 9, elements: [{ role: 'AXWindow', depth: 0 }] } : { windows: rows } };
    });
    await expect(f.driver.resolveTarget('fixture', new AbortController().signal, { prepare: false })).rejects.toThrow('WINDOW_AMBIGUOUS');
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
    vi.spyOn(driver as any, 'getWindowState').mockResolvedValue({
      pid: 42, windowId: 9n, screenshotFrameValid: true, windowBounds: { x: 0, y: 0, width: 800, height: 600 }, screenshotWidth: 800, screenshotHeight: 600,
      treeMarkdown: '- [0] AXWindow "Fixture"\n  - AXStaticText = "PASS: Continue clicked"', elements: [
        { elementIndex: 0n, role: 'AXWindow', depth: 0 },
        { elementIndex: 1n, parentIndex: 0n, depth: 1, elementToken: 'private-native-token', role: 'AXButton', label: 'Continue' }],
      images: [{ mimeType: 'image/png', dataBase64: 'AQID' }],
    });
    const frame = await driver.observe({ appId: 'fixture', pid: 42, processIdentity: '42:fixture-start', windowId: '9', width: 800, height: 600, geometryRevision: '1' }, new AbortController().signal);
    expect(frame.summary).toContain('PASS: Continue clicked');
    expect(frame.summary).toContain('e1');
    expect(frame.summary).not.toContain('private-native-token');
  });
  it('preserves valid pixels and explicitly reports unavailable accessibility content', async () => {
    const driver = new CuaComputerDriver('/fixture/cua-driver', 'host');
    vi.spyOn(driver as any, 'processIdentity').mockResolvedValue('42:fixture-start');
    vi.spyOn(driver as any, 'getWindowState').mockResolvedValue({ pid: 42, windowId: 9n,
      windowBounds: { x: 0, y: 0, width: 800, height: 600 }, screenshotWidth: 800, screenshotHeight: 600, elements: [],
      images: [{ mimeType: 'image/png', dataBase64: 'AQID' }] });
    const result = await driver.observe({ appId: 'fixture', pid: 42, processIdentity: '42:fixture-start', windowId: '9', width: 800, height: 600, geometryRevision: '1' }, new AbortController().signal);
    expect(result.summary).toContain('Use observe with a visual question');
    expect(Array.from(result.image)).toEqual([1, 2, 3]);
  });
  it('preserves a 64-bit window identifier through binding and typed actions', async () => {
    const largeWindowId = 9_007_199_254_740_993n;
    const f = native([{ window_id: largeWindowId, pid: 42, title: 'Large ID', is_on_screen: true,
      bounds: { x: 0, y: 0, width: 800, height: 600 } }]);
    const target = await f.driver.resolveTarget('fixture', new AbortController().signal, { prepare: false });
    expect(target.windowId).toBe(largeWindowId.toString());
    await f.driver.perform(target, { kind: 'click', point: { x: 5, y: 7 }, button: 'left', count: 1 }, new AbortController().signal);
    expect(f.client.click.mock.calls[0][0].target.inner.windowId).toBe(largeWindowId);
  });
  it('accepts native app catalogs containing processes without a bundle identifier', async () => {
    const driver = new CuaComputerDriver('/fixture/cua-driver', 'host');
    vi.spyOn(driver as any, 'start').mockResolvedValue(undefined);
    vi.spyOn(driver as any, 'processIdentity').mockResolvedValue('42:fixture-start');
    vi.spyOn(driver as any, 'listApps').mockResolvedValue([
      { pid: 10, name: '', running: true, active: false },
      { bundleId: 'fixture', pid: 42, name: '', running: true, active: false },
    ]);
    vi.spyOn(driver as any, 'listWindows').mockResolvedValue([
      { windowId: 9n, pid: 42, appName: '', title: '', bounds: { x: 0, y: 0, width: 800, height: 600 }, isOnScreen: true },
    ]);
    await expect(driver.resolveTarget('fixture', new AbortController().signal, { prepare: false })).resolves.toMatchObject({ appId: 'fixture', pid: 42, windowId: '9' });
  });
  it('cancels startup before loading the SDK when stop races with binary access', async () => {
    Object.defineProperty(process, 'type', { value: 'browser', configurable: true });
    let release!: () => void;
    io.access.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    const loadSdk = vi.fn();
    const driver = new CuaComputerDriver('/fixture/cua-driver', 'host', loadSdk as any);
    const starting = driver.resolveTarget('fixture', new AbortController().signal, { prepare: false });
    const rejected = expect(starting).rejects.toThrow('STOPPED');
    const stopped = driver.stop(); release(); await stopped; await rejected;
    expect(loadSdk).not.toHaveBeenCalled();
  });
  it('stops an SDK host created concurrently with an emergency stop', async () => {
    Object.defineProperty(process, 'type', { value: 'browser', configurable: true });
    io.access.mockResolvedValue(undefined);
    let release!: (connection: Record<string, unknown>) => void;
    const stop = vi.fn().mockResolvedValue(undefined);
    const destroy = vi.fn();
    const host = { start: vi.fn(() => new Promise(resolve => { release = resolve; })), stop, uniffiDestroy: destroy };
    const loadSdk = vi.fn(async () => ({
      EmbeddedCuaDriverHost: class { constructor() { return host; } },
      CuaDriver: { connect: vi.fn() },
    }));
    const driver = new CuaComputerDriver('/fixture/cua-driver', 'host', loadSdk as any);
    const starting = driver.resolveTarget('fixture', new AbortController().signal, { prepare: false });
    const rejected = expect(starting).rejects.toThrow('STOPPED');
    await vi.waitFor(() => expect(host.start).toHaveBeenCalled());
    const stopped = driver.stop();
    release({ socketPath: '/tmp/cua.sock' });
    await stopped; await rejected;
    expect(stop).toHaveBeenCalled();
    expect(destroy).toHaveBeenCalled();
  });
  it('rejects ungrounded text and unsafe/global shortcuts', () => {
    const driver = new CuaComputerDriver('/fixture/cua-driver', 'host');
    expect(() => driver.validateAction({ kind: 'typeText', text: 'secret' })).toThrow('EDITABLE');
    expect(() => driver.validateAction({ kind: 'pressKeys', keys: ['cmd', 'q'] })).toThrow('UNSAFE');
    expect(() => driver.validateAction({ kind: 'pressKeys', keys: ['cmd', 'shift', 'a'] })).not.toThrow();
    expect(() => driver.validateAction({ kind: 'pressKeys', keys: ['shift', 'tab'] })).not.toThrow();
    expect(() => driver.validateAction({ kind: 'pressKeys', keys: ['Enter'] })).not.toThrow();
    expect(() => driver.validateAction({ kind: 'scroll', point: { x: 0, y: 0 }, deltaX: 1, deltaY: 1 })).toThrow('ONE_AXIS');
  });
  it('keeps large and escaped accessibility summaries valid without clipping field values', () => {
    const elements = [{ role: 'AXWindow', element_index: 0 }, ...Array.from({ length: 180 }, (_, i) => ({
      element_index: i + 1, role: 'AXTextField', value: 'x'.repeat(500), element_token: 'private-token' }))];
    for (const text of ['page text', '\u0000'.repeat(4000)]) {
      const summary = summarizeWindowAccessibility(elements, text);
      expect(summary.length).toBeLessThanOrEqual(12_000);
      expect(summary).not.toContain('private-token');
      const parsed = JSON.parse(summary);
      expect(parsed.truncated).toBe(true);
      expect(parsed.elements[0].role).toBe('AXWindow');
      expect(parsed.elements.slice(1).every((e: any) => e.value.length === 500)).toBe(true);
    }
  });
  it.each([false, true])('grounds typing with Retina coordinates and uses the appropriate native/web route (web=%s)', async web => {
    const f = native([]);
    (f.driver as any).frame = { bounds: { x: 100, y: 50, width: 800, height: 600 }, width: 1600, height: 1200 };
    (f.driver as any).elements = [{ role: 'AXTextField', label: 'Message', element_index: 1, element_token: 'field-token',
      in_web_content: web, frame: { x: 200, y: 150, w: 200, h: 50 } }];
    const target = { appId: 'fixture', pid: 42, processIdentity: '42:fixture-start', windowId: '9', width: 800, height: 600, geometryRevision: '1' };
    await f.driver.perform(target, { kind: 'typeText', point: { x: 300, y: 250 }, text: '测试' }, new AbortController().signal);
    expect(f.call).toHaveBeenCalledWith('type_text', { pid: 42, window_id: 9, delivery_mode: 'background', text: '测试',
      ...(web ? { x: 300, y: 250 } : { element_token: 'field-token' }) }, expect.any(AbortSignal));
    expect(f.call).toHaveBeenCalledTimes(1);
  });
  it.each([
    [{ kind: 'click', point: { x: 5, y: 7 }, button: 'right', count: 1 }, 'click', { count: 1, button: 'right' }],
    [{ kind: 'click', point: { x: 5, y: 7 }, button: 'left', count: 2 }, 'click', { count: 2, button: 'left' }],
    [{ kind: 'pressKeys', keys: ['Enter'] }, 'pressKey', { key: 'return' }],
    [{ kind: 'pressKeys', keys: ['Shift', 'Tab'] }, 'hotkey', { keys: ['shift', 'tab'] }],
    [{ kind: 'scroll', point: { x: 5, y: 7 }, deltaX: -200, deltaY: 0 }, 'scroll', { x: 5, y: 7, by: 'line', amount: 2n, direction: 'left' }],
    [{ kind: 'scroll', point: { x: 5, y: 7 }, deltaX: 0, deltaY: 2000 }, 'scroll', { x: 5, y: 7, by: 'line', amount: 5n, direction: 'down' }],
  ])('dispatches %j once to the bound window', async (action, method, args) => {
    const f = native([]);
    await f.driver.perform({ appId: 'fixture', pid: 42, processIdentity: '42:fixture-start', windowId: '9', width: 800, height: 600, geometryRevision: '1' }, action as any, new AbortController().signal);
    const invocation = (f.client as any)[method];
    expect(invocation).toHaveBeenCalledOnce();
    expect(invocation.mock.calls[0][0]).toMatchObject(args);
    expect(invocation.mock.calls[0][0].target.inner).toEqual({ pid: 42, windowId: 9n });
    if (method === 'click') expect(invocation.mock.calls[0][0].position.inner).toEqual({ x: 5, y: 7 });
  });
  it('dispatches a bounded straight drag to the bound window', async () => {
    const f = native([]);
    const target = { appId: 'fixture', pid: 42, processIdentity: '42:fixture-start', windowId: '9', width: 800, height: 600, geometryRevision: '1' };
    await f.driver.perform(target, { kind: 'drag', from: { x: 10, y: 20 }, to: { x: 30, y: 40 } }, new AbortController().signal);
    expect(f.call).toHaveBeenCalledWith('drag', { pid: 42, window_id: 9, delivery_mode: 'background',
      from_x: 10, from_y: 20, to_x: 30, to_y: 40, duration_ms: 500, steps: 20, button: 'left' }, expect.any(AbortSignal));
    expect(() => f.driver.validateAction({ kind: 'drag', from: { x: 1, y: 1 }, to: { x: 1, y: 1 } })).toThrow('MOVEMENT');
  });
});
