import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import sharp from 'sharp';

import { runPhoneCommandBuffer } from '../process/phone-process.js';
import type { PhoneDriver } from './adb-driver.js';
import { PhoneError, type DiscoveredPhone, type PhoneAction, type PhoneApplication, type PhoneElement, type PhoneObservation, type PhoneTextInputStatus } from './contracts.js';

export function resolveHdcPath(configured?: string): string {
  if (configured) return configured;
  const roots = [process.env.HARMONYOS_SDK_HOME, process.env.DEVECO_SDK_HOME,
    '/Applications/DevEco-Studio.app/Contents/sdk/default', join(homedir(), 'Library/Huawei/Sdk')];
  for (const root of roots) if (root) for (const suffix of ['openharmony/toolchains', 'toolchains']) {
    const candidate = join(root, suffix, process.platform === 'win32' ? 'hdc.exe' : 'hdc');
    if (existsSync(candidate)) return candidate;
  }
  return 'hdc';
}

export function parseHdcDevices(raw: string): DiscoveredPhone[] {
  return raw.split(/\r?\n/).flatMap(line => {
    const fields = line.trim().split(/\s+/);
    // Verbose discovery is required: never treat TCP targets as USB phones.
    if (fields.length < 3 || fields[1] !== 'USB') return [];
    const state = fields[2] === 'Connected' ? 'device' : /unauth/i.test(fields[2]) ? 'unauthorized' : 'offline';
    return [{ serial: fields[0], name: `HarmonyOS ${fields[0]}`, state, emulator: false, platform: 'harmonyos' as const }];
  });
}

type LayoutNode = { attributes?: Record<string, unknown>; children?: LayoutNode[] };
const bundlePattern = /^[a-zA-Z]\w*(?:\.\w+)+$/;
const flag = (value: unknown) => value === true || value === 'true';

export function parseHarmonyLayout(raw: string, windowId: string): { package: string; elements: PhoneElement[] } {
  const root = JSON.parse(raw) as LayoutNode;
  const roots = root.children ?? [];
  const active = roots.filter(node => String(node.attributes?.hostWindowId) === windowId && bundlePattern.test(String(node.attributes?.bundleName)));
  if (active.length !== 1) throw new PhoneError('PHONE_APP_UNKNOWN', 'Unable to identify the focused HarmonyOS window', 409);
  const displayId = active[0].attributes?.displayId;
  if (displayId !== undefined && displayId !== '' && String(displayId) !== '0') throw new PhoneError('PHONE_UI_UNAVAILABLE', 'HarmonyOS USB observation supports the primary display only', 409);
  const elements: PhoneElement[] = [];
  let visited = 0;
  const visit = (node: LayoutNode, depth: number, sensitive = false) => {
    if (++visited > 10_000 || depth > 100) throw new PhoneError('PHONE_UI_UNAVAILABLE', 'HarmonyOS UI tree exceeds observation limits', 502);
    const a = node.attributes ?? {};
    if (a.visible === false || a.visible === 'false') return;
    const bounds = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(String(a.bounds ?? ''));
    const editable = /^(TextInput|TextArea|Search)$/.test(String(a.type));
    // Some commercial builds omit password metadata. Treat unknown editors as sensitive.
    const password = sensitive || flag(a.password) || flag(a.isPassword) || editable && a.password !== false && a.password !== 'false';
    if (bounds && elements.length < 500) {
      elements.push({ text: password ? '' : String(a.text ?? '').slice(0, 500), description: password ? '' : String(a.description ?? '').slice(0, 300),
        resourceId: String(a.id || a.key || ''), clickable: flag(a.clickable), focused: flag(a.focused), editable, password,
        bounds: bounds.slice(1).map(Number) as PhoneElement['bounds'] });
    }
    if (Array.isArray(node.children)) for (const child of node.children) visit(child, depth + 1, password);
  };
  visit(active[0], 0);
  return { package: String(active[0].attributes!.bundleName), elements };
}

export function parseHarmonyLaunch(raw: string): { ability: string; module: string } {
  const start = raw.indexOf('{');
  if (start < 0) throw new PhoneError('PHONE_APP_UNAVAILABLE', 'Unable to read HarmonyOS bundle information');
  const bundle = JSON.parse(raw.slice(start)) as { hapModuleInfos?: Array<{ moduleName?: string; abilityInfos?: Array<{ name?: string; skills?: Array<{ entities?: string[] }> }> }> };
  const entries = (bundle.hapModuleInfos ?? []).flatMap(module => (module.abilityInfos ?? []).flatMap(ability =>
    ability.skills?.some(skill => skill.entities?.includes('entity.system.home')) && /^[\w.$]+$/.test(ability.name ?? '') && /^[\w.]+$/.test(module.moduleName ?? '')
      ? [{ ability: ability.name!, module: module.moduleName! }] : []));
  if (entries.length !== 1) throw new PhoneError('PHONE_APP_UNAVAILABLE', 'The HarmonyOS app has no unique launcher ability');
  return entries[0];
}

export class HdcPhoneDriver implements PhoneDriver {
  constructor(private readonly path = resolveHdcPath(), private readonly command = runPhoneCommandBuffer) {}
  private async run(args: string[], signal?: AbortSignal): Promise<Buffer> {
    signal?.throwIfAborted();
    try {
      const output = await this.command(this.path, args, signal);
      if (/^(?:\[Fail\]|error:|Error:|ErrorCode:|Failed to|Missing parameter|usage:|Permission denied|.*: not found|Unknown command)/mi.test(output.toString())) throw new Error('HDC rejected command');
      return output;
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof PhoneError) throw error;
      throw new PhoneError('PHONE_HDC_FAILED', 'HDC operation failed. Check the SDK path, USB authorization and UiTest availability.', 502);
    }
  }
  private async shell(serial: string, args: string[], signal: AbortSignal): Promise<string> {
    return (await this.run(['-t', serial, 'shell', ...args], signal)).toString();
  }
  async discover(signal?: AbortSignal): Promise<DiscoveredPhone[]> { return parseHdcDevices((await this.run(['list', 'targets', '-v'], signal)).toString()); }
  async applications(serial: string, signal: AbortSignal): Promise<PhoneApplication[]> {
    const raw = await this.shell(serial, ['bm', 'dump', '-a'], signal);
    return [...new Set(raw.split(/\s+/).filter(name => bundlePattern.test(name)))].slice(0, 500).map(packageName => ({ packageName, label: packageName }));
  }
  async textInputStatus(_serial: string, _signal: AbortSignal): Promise<PhoneTextInputStatus> {
    return { unicode: 'unsupported', method: 'hdc-uitest', keyboardRequired: false };
  }
  async foreground(serial: string, signal: AbortSignal): Promise<string> {
    const raw = await this.shell(serial, ['hidumper', '-s', 'WindowManagerService', '-a', '-a'], signal);
    const focus = /^Focus window:\s*(\d+)\s*$/m.exec(raw)?.[1];
    const rows = raw.split(/\r?\n/).map(line => line.trim().split(/\s+/));
    const row = rows.find(parts => parts[3] === focus && /^\d+$/.test(parts[2]) && parts[1] === '0');
    if (!row) throw new PhoneError('PHONE_APP_UNKNOWN', 'Unable to identify the focused HarmonyOS process', 409);
    const command = await this.shell(serial, ['cat', `/proc/${row[2]}/cmdline`], signal);
    const bundle = command.split('\0')[0].split(':')[0];
    if (!bundlePattern.test(bundle)) throw new PhoneError('PHONE_APP_UNKNOWN', 'Unable to identify the focused HarmonyOS app', 409);
    return bundle;
  }
  private async window(serial: string, signal: AbortSignal): Promise<string> {
    const raw = await this.shell(serial, ['hidumper', '-s', 'WindowManagerService', '-a', '-a'], signal);
    const id = /^Focus window:\s*(\d+)\s*$/m.exec(raw)?.[1];
    if (!id || id === '0') throw new PhoneError('PHONE_APP_UNKNOWN', 'No focused HarmonyOS window', 409);
    return id;
  }
  private async rotation(serial: string, signal: AbortSignal): Promise<number> {
    const raw = await this.shell(serial, ['hidumper', '-s', 'DisplayManagerService', '-a', '-a'], signal);
    const screen = raw.split(/-+ Screen ID: 0 -+/)[1]?.split(/-+ Screen ID:/)[0];
    const rotation = screen && /^Rotation:\s*(0|1|2|3|90|180|270)\s*$/m.exec(screen)?.[1];
    if (rotation === undefined) throw new PhoneError('PHONE_UI_UNAVAILABLE', 'Unable to identify HarmonyOS display rotation', 502);
    const value = Number(rotation); return value > 3 ? value / 90 : value;
  }
  async observe(serial: string, signal: AbortSignal): Promise<PhoneObservation> {
    const directory = await mkdtemp(join(tmpdir(), 'xopc-hdc-'));
    const prefix = `/data/local/tmp/xopc-phone-${randomUUID()}`;
    let frame: Buffer | undefined;
    try {
      const windowId = await this.window(serial, signal);
      const rotation = await this.rotation(serial, signal);
      await this.shell(serial, ['uitest', 'dumpLayout', '-p', `${prefix}.json`], signal);
      await this.run(['-t', serial, 'file', 'recv', `${prefix}.json`, join(directory, 'layout.json')], signal);
      const native = parseHarmonyLayout(await readFile(join(directory, 'layout.json'), 'utf8'), windowId);
      const capturedAt = Date.now();
      try {
        await this.shell(serial, ['uitest', 'screenCap', '-p', `${prefix}.png`], signal);
        await this.run(['-t', serial, 'file', 'recv', `${prefix}.png`, join(directory, 'screen.png')], signal);
      } catch {
        signal.throwIfAborted();
        await this.shell(serial, ['snapshot_display', '-f', `${prefix}.jpeg`], signal);
        await this.run(['-t', serial, 'file', 'recv', `${prefix}.jpeg`, join(directory, 'screen.jpeg')], signal);
        const jpeg = await readFile(join(directory, 'screen.jpeg'));
        try { await sharp(jpeg, { limitInputPixels: 16_000_000 }).png().toFile(join(directory, 'screen.png')); }
        finally { jpeg.fill(0); }
      }
      frame = await readFile(join(directory, 'screen.png'));
      if (await this.window(serial, signal) !== windowId || await this.rotation(serial, signal) !== rotation) throw new PhoneError('PHONE_FRAME_CHANGED', 'HarmonyOS foreground changed during capture; observe again', 409);
      const info = await sharp(frame, { limitInputPixels: 16_000_000 }).metadata();
      if (info.format !== 'png' || !info.width || !info.height) throw new PhoneError('PHONE_UI_UNAVAILABLE', 'Invalid HarmonyOS screenshot', 502);
      return { platform: 'harmonyos', frameId: randomUUID(), capturedAt, width: info.width, height: info.height, rotation, package: native.package, frame, elements: native.elements };
    } catch (error) { frame?.fill(0); throw error; }
    finally {
      await this.shell(serial, ['rm', '-f', `${prefix}.json`, `${prefix}.png`, `${prefix}.jpeg`], AbortSignal.timeout(3000)).catch(() => {});
      await rm(directory, { recursive: true, force: true });
    }
  }
  async execute(serial: string, action: PhoneAction, observation: PhoneObservation, signal: AbortSignal, options?: { settleMs: number }): Promise<void> {
    const point = ([x, y]: number[]) => [String(Math.max(0, Math.min(observation.width - 1, Math.round(x * observation.width / 1000)))), String(Math.max(0, Math.min(observation.height - 1, Math.round(y * observation.height / 1000))))];
    const input = (args: string[]) => this.shell(serial, ['uitest', 'uiInput', ...args], signal);
    switch (action.type) {
      case 'tap': await input(['click', ...point(action.point)]); break;
      case 'doubleTap': await input(['doubleClick', ...point(action.point)]); break;
      case 'longPress': await input(['longClick', ...point(action.point)]); break;
      case 'swipe': {
        const distance = Math.hypot((action.end[0] - action.start[0]) * observation.width / 1000, (action.end[1] - action.start[1]) * observation.height / 1000);
        const velocity = Math.max(200, Math.min(40000, Math.round(distance * 1000 / action.durationMs)));
        await input(['swipe', ...point(action.start), ...point(action.end), String(velocity)]); break;
      }
      case 'back': case 'home': await input(['keyEvent', action.type === 'back' ? 'Back' : 'Home']); break;
      case 'launch': {
        if (!bundlePattern.test(action.package)) throw new PhoneError('PHONE_INVALID_INPUT', 'Invalid HarmonyOS bundle name');
        const entry = parseHarmonyLaunch(await this.shell(serial, ['bm', 'dump', '-n', action.package], signal));
        const output = await this.shell(serial, ['aa', 'start', '-b', action.package, '-m', entry.module, '-a', entry.ability], signal);
        if (!/start ability successfully/i.test(output)) throw new PhoneError('PHONE_LAUNCH_FAILED', 'HarmonyOS app launch was not confirmed', 502);
        break;
      }
      case 'typeText': throw new PhoneError('PHONE_TEXT_INPUT_UNAVAILABLE', 'This HarmonyOS connection requires text entry with the phone keyboard. Take over, enter text on the phone, then hand back.', 409);
      case 'tapElement': throw new PhoneError('PHONE_SEMANTIC_UNRESOLVED', 'Resolve the native element before dispatch', 409);
      case 'wait': await delay(action.durationMs, undefined, { signal }); return;
    }
    await delay(options?.settleMs ?? 350, undefined, { signal });
  }
}
