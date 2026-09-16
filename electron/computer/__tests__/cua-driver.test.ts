import { afterEach, describe, expect, it, vi } from 'vitest';

const io = vi.hoisted(() => ({ access: vi.fn(), mkdtemp: vi.fn(), rm: vi.fn(), rmdir: vi.fn(), spawn: vi.fn() }));
vi.mock('node:fs/promises', () => io);
vi.mock('node:child_process', async (original) => ({ ...await original<typeof import('node:child_process')>(), spawn: io.spawn }));
import { CuaComputerDriver, scopeWindowAccessibility } from '../cua-driver.js';

const priorType = Object.getOwnPropertyDescriptor(process, 'type');
afterEach(() => { vi.resetAllMocks(); if (priorType) Object.defineProperty(process, 'type', priorType); else delete (process as any).type; });
describe('private native driver admission', () => {
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
    const driver = new CuaComputerDriver('/fixture/cua-driver', 'fixture');
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
  it('accepts native app catalogs containing processes without a bundle identifier', async () => {
    const driver = new CuaComputerDriver('/fixture/cua-driver', 'fixture');
    vi.spyOn(driver as any, 'start').mockResolvedValue(undefined);
    vi.spyOn(driver as any, 'processIdentity').mockResolvedValue('42:fixture-start');
    vi.spyOn(driver as any, 'call')
      .mockResolvedValueOnce({ data: { apps: [{ bundle_id: null, pid: 10 }, { bundle_id: 'fixture', pid: 42, running: true }] } })
      .mockResolvedValueOnce({ data: { windows: [{ window_id: 9, pid: 42, bounds: { x: 0, y: 0, width: 800, height: 600 }, is_on_screen: true }] } });
    await expect(driver.resolveTarget('fixture', new AbortController().signal)).resolves.toMatchObject({ appId: 'fixture', pid: 42, windowId: '9' });
  });
  it('cancels startup before spawning when stop races with binary access', async () => {
    Object.defineProperty(process, 'type', { value: 'browser', configurable: true });
    let release!: () => void;
    io.access.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    const driver = new CuaComputerDriver('/fixture/cua-driver', 'fixture');
    const starting = driver.resolveTarget('fixture', new AbortController().signal);
    const rejected = expect(starting).rejects.toThrow('STOPPED');
    const stopped = driver.stop(); release(); await stopped; await rejected;
    expect(io.spawn).not.toHaveBeenCalled();
  });
  it('cleans a directory created concurrently with stop without late input', async () => {
    Object.defineProperty(process, 'type', { value: 'browser', configurable: true });
    io.access.mockResolvedValue(undefined); io.rm.mockResolvedValue(undefined); io.rmdir.mockResolvedValue(undefined);
    let release!: (path: string) => void;
    io.mkdtemp.mockImplementation(() => new Promise<string>(resolve => { release = resolve; }));
    const driver = new CuaComputerDriver('/fixture/cua-driver', 'fixture');
    const starting = driver.resolveTarget('fixture', new AbortController().signal);
    const rejected = expect(starting).rejects.toThrow('STOPPED');
    await vi.waitFor(() => expect(io.mkdtemp).toHaveBeenCalled());
    const stopped = driver.stop(); release('/private/tmp/xc-owned'); await stopped; await rejected;
    expect(io.spawn).not.toHaveBeenCalled(); expect(io.rmdir).toHaveBeenCalledWith('/private/tmp/xc-owned');
  });
  it('rejects ungrounded text and unsafe/global shortcuts', () => {
    const driver = new CuaComputerDriver('/fixture/cua-driver', 'fixture');
    expect(() => driver.validateAction({ kind: 'typeText', text: 'secret' })).toThrow('EDITABLE');
    expect(() => driver.validateAction({ kind: 'pressKeys', keys: ['cmd', 'q'] })).toThrow('UNSAFE');
    expect(() => driver.validateAction({ kind: 'pressKeys', keys: ['cmd', 'shift', 'a'] })).not.toThrow();
    expect(() => driver.validateAction({ kind: 'scroll', point: { x: 0, y: 0 }, deltaX: 1, deltaY: 1 })).toThrow('ONE_AXIS');
  });
});
