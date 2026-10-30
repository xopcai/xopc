import { writeFile } from 'node:fs/promises';

import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import { HdcPhoneDriver, parseHarmonyLaunch, parseHarmonyLayout, parseHdcDevices } from '../hdc-driver.js';
import type { PhoneAction, PhoneObservation } from '../contracts.js';

const signal = () => new AbortController().signal;
const layout = (bundle = 'com.example.phone') => ({ attributes: {}, children: [{ attributes: { hostWindowId: '42', bundleName: bundle, bounds: '[0,0][100,200]' }, children: [
  { attributes: { text: 'Hello', id: 'title', bounds: '[0,10][90,30]', clickable: 'true' } },
  { attributes: { text: 'secret', description: 'secret', type: 'TextInput', focused: 'true', bounds: '[0,40][90,70]' }, children: [{ attributes: { text: 'nested secret', bounds: '[0,40][90,70]' } }] },
] }] });
const observation: PhoneObservation = { platform: 'harmonyos', frameId: 'frame', capturedAt: Date.now(), width: 100, height: 200, rotation: 0,
  package: 'com.example.phone', frame: Buffer.alloc(0), elements: [] };
const bundle = { hapModuleInfos: [{ moduleName: 'entry', abilityInfos: [{ name: 'MainAbility', skills: [{ entities: ['entity.system.home'] }] }] }] };

describe('HDC USB discovery and native parsing', () => {
  it('discovers only USB targets and preserves unavailable USB states', () => {
    expect(parseHdcDevices('List of targets:\nABC\tUSB\tConnected\tlocalhost\thdc\nDEF USB Unauthorized localhost hdc\nGHI USB Offline localhost hdc\n127.0.0.1:5555 TCP Connected localhost hdc\n[Empty]')).toEqual([
      { serial: 'ABC', name: 'HarmonyOS ABC', state: 'device', emulator: false, platform: 'harmonyos' },
      { serial: 'DEF', name: 'HarmonyOS DEF', state: 'unauthorized', emulator: false, platform: 'harmonyos' },
      { serial: 'GHI', name: 'HarmonyOS GHI', state: 'offline', emulator: false, platform: 'harmonyos' },
    ]);
  });
  it('reads only the focused window and redacts unknown editor contents', () => {
    const tree = layout();
    tree.children.push({ attributes: { hostWindowId: '99', bundleName: 'com.other.app', bounds: '[0,0][100,200]' }, children: [] });
    const parsed = parseHarmonyLayout(JSON.stringify(tree), '42');
    expect(parsed.package).toBe('com.example.phone');
    expect(parsed.elements[1]).toMatchObject({ text: 'Hello', resourceId: 'title', clickable: true });
    expect(parsed.elements[2]).toMatchObject({ text: '', description: '', password: true, editable: true });
    expect(parsed.elements[3]).toMatchObject({ text: '', password: true });
    expect(JSON.stringify(parsed)).not.toContain('secret');
    expect(() => parseHarmonyLayout(JSON.stringify(tree), '100')).toThrow('focused HarmonyOS window');
  });
  it('rejects ambiguous focused roots and launcher abilities', () => {
    const tree = layout(); tree.children.push(tree.children[0]);
    expect(() => parseHarmonyLayout(JSON.stringify(tree), '42')).toThrow();
    expect(parseHarmonyLaunch(JSON.stringify(bundle))).toEqual({ module: 'entry', ability: 'MainAbility' });
    expect(() => parseHarmonyLaunch(JSON.stringify({ hapModuleInfos: [...bundle.hapModuleInfos, ...bundle.hapModuleInfos] }))).toThrow();
    expect(() => parseHarmonyLaunch('{}')).toThrow();
  });
});

async function fixture(options: { changed?: boolean; screenshotFallback?: boolean; invalidPixels?: boolean; rotated?: boolean } = {}) {
  const png = await sharp({ create: { width: 100, height: 200, channels: 3, background: 'white' } }).png().toBuffer();
  const jpeg = await sharp(png).jpeg().toBuffer();
  let windows = 0; let displays = 0;
  const command = vi.fn(async (_path: string, args: string[], _signal?: AbortSignal) => {
    if (args[0] === 'list') return Buffer.from('ABC USB Connected localhost hdc');
    if (args[2] === 'file') {
      await writeFile(args[5], args[4].endsWith('.json') ? JSON.stringify(layout()) : options.invalidPixels ? Buffer.from('invalid') : args[4].endsWith('.jpeg') ? jpeg : png);
      return Buffer.from('FileTransfer finish');
    }
    if (args.includes('WindowManagerService')) return Buffer.from(`Focus window: ${options.changed && ++windows > 1 ? '99' : '42'}\n`);
    if (args.includes('DisplayManagerService')) return Buffer.from(`---- Screen ID: 0 ----\nRotation: ${options.rotated && ++displays > 1 ? '2' : '0'}\n`);
    if (options.screenshotFallback && args.includes('screenCap')) return Buffer.from('Error: unsupported command');
    if (args.includes('dumpLayout')) return Buffer.from('DumpLayout saved');
    if (args.includes('bm')) return Buffer.from(JSON.stringify(bundle));
    if (args.includes('aa')) return Buffer.from('start ability successfully.');
    return Buffer.alloc(0);
  });
  return { command, driver: new HdcPhoneDriver('/sdk/hdc', command) };
}

describe('HDC screenshot and actions', () => {
  it('captures a PNG with native evidence and cleans temporary files', async () => {
    const f = await fixture(); const o = await f.driver.observe('ABC', signal());
    expect(o).toMatchObject({ platform: 'harmonyos', width: 100, height: 200, package: 'com.example.phone', rotation: 0 });
    expect(o.frame.subarray(1, 4).toString()).toBe('PNG');
    expect(f.command.mock.calls.at(-1)?.[1]).toEqual(expect.arrayContaining(['rm', '-f'])); o.frame.fill(0);
  });
  it('uses JPEG snapshot_display on systems without UiTest screenCap and normalizes to PNG', async () => {
    const f = await fixture({ screenshotFallback: true }); const o = await f.driver.observe('ABC', signal());
    expect(o.frame.subarray(1, 4).toString()).toBe('PNG');
    expect(f.command.mock.calls.some(([, args]) => args.includes('snapshot_display') && args.some(a => a.endsWith('.jpeg')))).toBe(true); o.frame.fill(0);
  });
  it.each([{ changed: true }, { rotated: true }, { invalidPixels: true }])('rejects inconsistent or invalid captures %j and cleans up', async options => {
    const f = await fixture(options);
    await expect(f.driver.observe('ABC', signal())).rejects.toThrow();
    expect(f.command.mock.calls.at(-1)?.[1]).toEqual(expect.arrayContaining(['rm', '-f']));
  });
  it.each<[PhoneAction, string[]]>([
    [{ type: 'tap', point: [1000, 1000] }, ['click', '99', '199']],
    [{ type: 'doubleTap', point: [500, 500] }, ['doubleClick', '50', '100']],
    [{ type: 'longPress', point: [500, 500], durationMs: 800 }, ['longClick', '50', '100']],
    [{ type: 'swipe', start: [0, 0], end: [1000, 1000], durationMs: 500 }, ['swipe', '0', '0', '99', '199', '447']],
    [{ type: 'back' }, ['keyEvent', 'Back']], [{ type: 'home' }, ['keyEvent', 'Home']],
  ])('maps %j to UiTest using pixel coordinates and velocity', async (action, args) => {
    const f = await fixture(); await f.driver.execute('ABC', action, observation, signal(), { settleMs: 0 });
    expect(f.command).toHaveBeenCalledWith('/sdk/hdc', ['-t', 'ABC', 'shell', 'uitest', 'uiInput', ...args], expect.any(AbortSignal));
  });
  it('resolves the launcher module and ability instead of assuming EntryAbility', async () => {
    const f = await fixture(); await f.driver.execute('ABC', { type: 'launch', package: 'com.example.phone' }, observation, signal(), { settleMs: 0 });
    expect(f.command.mock.calls.at(-1)?.[1]).toEqual(['-t', 'ABC', 'shell', 'aa', 'start', '-b', 'com.example.phone', '-m', 'entry', '-a', 'MainAbility']);
  });
  it('does not inject text, shell syntax, or an aborted action', async () => {
    const f = await fixture();
    await expect(f.driver.execute('ABC', { type: 'typeText', text: 'hello' }, observation, signal())).rejects.toMatchObject({ code: 'PHONE_TEXT_INPUT_UNAVAILABLE' });
    await expect(f.driver.execute('ABC', { type: 'launch', package: 'x; touch /tmp/pwn' }, observation, signal())).rejects.toMatchObject({ code: 'PHONE_INVALID_INPUT' });
    await expect(f.driver.execute('ABC', { type: 'tap', point: [1, 1] }, observation, AbortSignal.abort())).rejects.toThrow();
    expect(f.command).not.toHaveBeenCalled();
  });
  it('detects device-side failures even when the host command succeeds', async () => {
    const command = vi.fn(async () => Buffer.from('ErrorCode: 17000001 permission denied'));
    await expect(new HdcPhoneDriver('hdc', command).execute('ABC', { type: 'back' }, observation, signal())).rejects.toMatchObject({ code: 'PHONE_HDC_FAILED' });
    expect(command).toHaveBeenCalledOnce();
  });
});
