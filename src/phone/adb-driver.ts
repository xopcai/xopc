import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { DOMParser } from 'linkedom';
import sharp from 'sharp';

import { runPhoneCommandText } from '../process/phone-process.js';
import { managedPhoneAdbPath } from '../runtime-tools/phone-dependency-catalog.js';
import { parsePhoneApplications, phoneApplicationsCommand } from './applications.js';
import { readScrcpyServer, scrcpyServerPath } from './scrcpy-assets.js';
import { PhoneError, type PhoneApplication, type PhoneTextInputStatus, type DiscoveredPhone, type PhoneAction, type PhoneElement, type PhoneObservation } from './contracts.js';

import { readPhoneForeground } from './foreground.js';
import { runAdb } from './adb-command.js';

export { runAdb } from './adb-command.js';

export function resolveAdbPath(configured?: string, stateDir?: string): string {
  if (configured) return configured;
  const roots = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, join(homedir(), 'Library/Android/sdk'), join(homedir(), 'Android/Sdk')];
  for (const root of roots) {
    const candidate = root && join(root, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
    if (candidate && existsSync(candidate)) return candidate;
  }
  const managed = managedPhoneAdbPath(stateDir);
  return existsSync(managed) ? managed : 'adb';
}

export function parseAdbDevices(text: string): DiscoveredPhone[] {
  return text.split(/\r?\n/).slice(1).flatMap(line => {
    const match = /^(\S+)\s+(device|offline|unauthorized|recovery|sideload)\b(.*)$/.exec(line.trim());
    if (!match) return [];
    return [{ serial: match[1], state: match[2], name: /model:(\S+)/.exec(match[3])?.[1]?.replaceAll('_', ' ') ?? match[1], emulator: /^emulator-\d+$/.test(match[1]) }];
  });
}

export function parsePhoneUi(xml: string): PhoneElement[] {
  const document = new DOMParser().parseFromString(xml.slice(xml.indexOf('<?xml') >= 0 ? xml.indexOf('<?xml') : xml.indexOf('<hierarchy')), 'text/xml');
  return Array.from(document.querySelectorAll('node')).slice(0, 500).flatMap(node => {
    const bounds = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(node.getAttribute('bounds') ?? '');
    if (!bounds || node.getAttribute('visible-to-user') === 'false') return [];
    const password = node.getAttribute('password') === 'true';
    return [{ text: password ? '' : (node.getAttribute('text') ?? '').slice(0, 500), description: password ? '' : (node.getAttribute('content-desc') ?? '').slice(0, 300),
      resourceId: node.getAttribute('resource-id') ?? '', clickable: node.getAttribute('clickable') === 'true', focused: node.getAttribute('focused') === 'true', password,
      editable: /(?:EditText|AutoCompleteTextView)$/.test(node.getAttribute('class') ?? ''),
      bounds: bounds.slice(1).map(Number) as [number, number, number, number] }];
  });
}

export function parseAndroidLayout(raw: string): PhoneElement[] {
  const windows: unknown = JSON.parse(raw);
  if (!Array.isArray(windows)) return [];
  const window = windows.find(item => item.type === 'APPLICATION' && item.focused);
  if (!window || !Array.isArray(window.content)) return [];
  return window.content.slice(0, 500).flatMap((node: Record<string, unknown>) => {
    const bounds = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(String(node.bounds ?? ''));
    if (!bounds || node.hidden || node['off-screen']) return [];
    const interactions = Array.isArray(node.interactions) ? node.interactions.map(value => String(value).toUpperCase()) : [];
    const state = Array.isArray(node.state) ? node.state.map(value => String(value).toUpperCase()) : [];
    const password = interactions.includes('PASSWORD');
    return [{ text: password ? '' : String(node.text ?? '').slice(0, 500), description: password ? '' : String(node['content-desc'] ?? '').slice(0, 300),
      resourceId: String(node['resource-id'] ?? ''), clickable: interactions.includes('CLICKABLE'), focused: state.includes('FOCUSED'), password,
      editable: /(?:EditText|AutoCompleteTextView)$/.test(String(node.class ?? '')),
      bounds: bounds.slice(1).map(Number) as [number, number, number, number] }];
  });
}

function androidCliPath(): string | undefined {
  const filename = process.platform === 'win32' ? 'android.cmd' : 'android';
  return (process.env.PATH ?? '').split(delimiter).map(path => join(path, filename)).find(path => existsSync(path));
}

export interface PhoneDriver {
  discover(signal?: AbortSignal): Promise<DiscoveredPhone[]>;
  applications?(serial: string, signal: AbortSignal): Promise<PhoneApplication[]>;
  textInputStatus?(serial: string, signal: AbortSignal): Promise<PhoneTextInputStatus>;
  observe(serial: string, signal: AbortSignal): Promise<PhoneObservation>;
  capture?(serial: string, signal: AbortSignal): Promise<PhoneObservation>;
  observeForText?(serial: string, signal: AbortSignal): Promise<PhoneObservation>;
  execute(serial: string, action: PhoneAction, observation: PhoneObservation, signal: AbortSignal, options?: { settleMs: number; resetTask?: boolean; settingsPage?: 'about-phone' }): Promise<void>;
}

/** Read only the active native editor, never historical input-method entries. */
export function parseAndroidFocusedEditor(raw: string, app: string): PhoneElement | undefined {
  for (const section of raw.split('Input method client state for ').slice(1)) {
    const client = section.split('Input method service state for ')[0];
    if (!/\bmActive=true\b/.test(client) || !/\bmServedConnecting=false\b/.test(client)) continue;
    const view = /^\s*mServedView=((?:[\w.]+\.)?(?:EditText|AutoCompleteTextView))\{([^\s}]+)/m.exec(client);
    const connection = /^\s*mServedInputConnectionWrapper=([^\n]+)/m.exec(client)?.[1];
    if (!view || !connection?.includes('finished=false') || !connection.includes('isActive()=true')
      || !connection.includes(`mServedView=${view[1]}{${view[2]} `)) continue;
    const editor = /mCurrentTextBoxAttribute:\s*([\s\S]*?)(?=\n\s{0,2}\w|$)/.exec(client)?.[1];
    const packageName = /\bpackageName=([\w.]+)/.exec(editor ?? '')?.[1];
    const value = /\binputType=0x([0-9a-f]+)/i.exec(editor ?? '')?.[1];
    if (packageName !== app || !value) continue;
    const inputType = Number.parseInt(value, 16); const kind = inputType & 0xf; const variation = inputType & 0xff0;
    if (![1, 2, 3, 4].includes(kind)) continue;
    const password = kind === 1 ? [0x80, 0x90, 0xe0].includes(variation) : kind === 2 && variation === 0x10;
    return { text: '', description: '', resourceId: 'android:active-editor', bounds: [0, 0, 0, 0],
      clickable: false, focused: true, editable: true, password };
  }
  return undefined;
}

function sameTextEditor(target: PhoneElement, node: PhoneElement): boolean {
  return node.focused && Boolean(node.editable) && !node.password
    && (target.resourceId ? node.resourceId === target.resourceId : node.bounds.every((value, index) => value === target.bounds[index]));
}

export class AdbPhoneDriver implements PhoneDriver {
  constructor(private readonly adbPath = resolveAdbPath(), private readonly command = runAdb, private readonly useAndroidCli = true,
    private readonly readApplications?: (signal: AbortSignal) => Promise<PhoneApplication[]>,
    private readonly pasteText?: (text: string, signal: AbortSignal) => Promise<void>,
    private readonly readHierarchy?: (signal: AbortSignal) => Promise<string>) {}
  async textInputStatus(serial: string, signal: AbortSignal): Promise<PhoneTextInputStatus> {
    const androidSdk = Number((await this.shell(serial, ['getprop', 'ro.build.version.sdk'], signal)).trim()) || 0;
    let ready = false;
    try { await readScrcpyServer(); ready = true; } catch { signal.throwIfAborted(); }
    return { androidSdk, unicode: androidSdk < 24 ? 'unsupported' : ready ? 'available' : 'setup_required', method: 'scrcpy-clipboard', keyboardRequired: false };
  }
  async discover(signal?: AbortSignal): Promise<DiscoveredPhone[]> { return parseAdbDevices((await this.command(this.adbPath, ['devices', '-l'], signal)).toString()); }
  async applications(serial: string, signal: AbortSignal): Promise<PhoneApplication[]> {
    if (this.readApplications) return this.readApplications(signal);
    await readScrcpyServer();
    const remote = `/data/local/tmp/xopc-apps-${randomUUID()}.jar`;
    try {
      await this.command(this.adbPath, ['-s', serial, 'push', scrcpyServerPath(), remote], signal);
      return parsePhoneApplications(await this.shell(serial, phoneApplicationsCommand(remote), signal));
    } finally { await this.shell(serial, ['rm', '-f', remote], AbortSignal.timeout(3000)).catch(() => {}); }
  }
  async foreground(serial: string, signal: AbortSignal): Promise<string> {
    return readPhoneForeground(this.command, this.adbPath, serial, signal);
  }

  private async shell(serial: string, args: string[], signal: AbortSignal): Promise<string> {
    return (await this.command(this.adbPath, ['-s', serial, 'shell', ...args], signal)).toString();
  }
  async observe(serial: string, signal: AbortSignal): Promise<PhoneObservation> {
    if (this.readHierarchy) {
      const xml = await this.readHierarchy(signal);
      const elements = parsePhoneUi(xml);
      const app = new DOMParser().parseFromString(xml, 'text/xml').querySelector('node')?.getAttribute('package');
      const observation = await this.capture(serial, signal);
      if (!app || app !== observation.package) {
        observation.frame.fill(0);
        throw new PhoneError('PHONE_FRAME_CHANGED', 'Application changed between the UI hierarchy and screenshot; retry');
      }
      return { ...observation, elements };
    }
    // Dump first: screenshots represent the UI after the accessibility snapshot.
    let elements: PhoneElement[] = [];
    const android = this.useAndroidCli ? androidCliPath() : undefined;
    if (android && process.platform !== 'win32') {
      // Official CLI can capture non-idle layouts (e.g. marquee titles) without waiting for idle.
      for (let attempt = 0; attempt < 3 && !elements.length; attempt++) {
        try {
          const data = await runPhoneCommandText(android, ['layout', '--device', serial, '--no-idle', '--flat'], signal);
          elements = parseAndroidLayout(data);
        } catch { signal.throwIfAborted(); }
        if (!elements.length) await delay(350, undefined, { signal });
      }
    }
    // Keep the hierarchy mode stable across captures; switching modes changes container nodes.
    if (!elements.length) for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const path = `/data/local/tmp/xopc-phone-${randomUUID()}.xml`;
        try {
          const result = await this.shell(serial, ['uiautomator', 'dump', '--compressed', path], signal);
          if (!result.includes(path)) throw new Error('UI hierarchy dump did not complete');
          const xml = await this.shell(serial, ['cat', path], signal);
          if (!xml.includes('<hierarchy') || (!xml.includes('</hierarchy>') && !/<hierarchy\b[^>]*\/>/.test(xml))) throw new Error('UI hierarchy dump is incomplete');
          elements = parsePhoneUi(xml);
        } finally { await this.shell(serial, ['rm', '-f', path], signal).catch(() => {}); }
        break;
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof Error && error.message === 'PHONE_UI_INVALID') throw error;
        if (attempt === 2) throw new PhoneError('PHONE_UI_UNAVAILABLE', 'Unable to capture the phone UI hierarchy; retry observation before controlling the phone', 502);
        await delay(1000, undefined, { signal });
      }
    }
    return { ...await this.capture(serial, signal), elements };
  }
  async observeForText(serial: string, signal: AbortSignal): Promise<PhoneObservation> {
    const observation = await this.capture(serial, signal);
    try {
      const editor = parseAndroidFocusedEditor(await this.shell(serial, ['dumpsys', 'input_method'], signal), observation.package);
      if (await this.foreground(serial, signal) !== observation.package) throw new PhoneError('PHONE_FRAME_CHANGED', 'Application changed before text input');
      if (editor) return { ...observation, elements: [editor] };
    } catch (error) { observation.frame.fill(0); throw error; }
    observation.frame.fill(0);
    // Unrecognized Android dump formats retain the existing accessibility check.
    return this.observe(serial, signal);
  }
  /** Pixel capture avoids accessibility dumps on the human interaction path. */
  async capture(serial: string, signal: AbortSignal): Promise<PhoneObservation> {
    const foreground = async () => {
      const activity = await this.shell(serial, ['dumpsys', 'activity', 'activities'], signal);
      const app = /(?:mResumedActivity|topResumedActivity)[^\n]*?\s([\w.]+)\//.exec(activity)?.[1];
      if (!app) throw new PhoneError('PHONE_APP_UNKNOWN', 'Unable to identify the foreground app');
      return app;
    };
    const app = await foreground();
    const capturedAt = Date.now();
    const results = await Promise.allSettled([
      this.command(this.adbPath, ['-s', serial, 'exec-out', 'screencap', '-p'], signal),
      this.shell(serial, ['dumpsys', 'input'], signal),
    ]);
    const pixels = results[0]; const display = results[1];
    if (pixels.status === 'rejected') throw pixels.reason;
    const frame = pixels.value;
    try {
      if (display.status === 'rejected') throw display.reason;
      if (await foreground() !== app) throw new PhoneError('PHONE_FRAME_CHANGED', 'Application changed while capturing the screen; retry');
      const info = await sharp(frame, { limitInputPixels: 16_000_000 }).metadata();
      if (info.format !== 'png' || !info.width || !info.height) throw new Error('Invalid frame');
      const rotation = Number(/SurfaceOrientation:\s*(\d)/.exec(display.value)?.[1] ?? 0);
      return { frameId: randomUUID(), capturedAt, width: info.width, height: info.height, rotation, package: app, frame, elements: [] };
    } catch (error) { frame.fill(0); throw error; }
  }
  private async confirmText(serial: string, app: string, target: PhoneElement, matches: (text: string) => boolean, signal: AbortSignal): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      await delay(150, undefined, { signal });
      const after = await this.observe(serial, signal);
      try {
        if (after.package !== app) break;
        const candidates = after.elements.filter(node => target.resourceId === 'android:active-editor'
          ? node.focused && node.editable && !node.password : sameTextEditor(target, node));
        if (candidates.length === 1 && matches(candidates[0].text)) return;
        if (candidates.length !== 1) break;
      } finally { after.frame.fill(0); }
    }
    throw new PhoneError('PHONE_TEXT_INPUT_UNCONFIRMED', 'Text was sent but the target field value could not be verified. Take over and inspect the input field before retrying.', 409);
  }
  async execute(serial: string, action: PhoneAction, observation: PhoneObservation, signal: AbortSignal, options?: { settleMs: number; resetTask?: boolean; settingsPage?: 'about-phone' }): Promise<void> {
    const point = ([x, y]: number[]) => [String(Math.min(observation.width - 1, Math.round(x * observation.width / 1000))), String(Math.min(observation.height - 1, Math.round(y * observation.height / 1000)))];
    const input = (args: string[]) => this.shell(serial, ['input', ...args], signal);
    switch (action.type) {
      case 'tapElement': throw new PhoneError('PHONE_SEMANTIC_UNRESOLVED', 'Resolve the native element against a fresh observation before dispatch', 409);
      case 'launch': {
        if (options?.settingsPage) {
          if (action.package !== 'com.android.settings') throw new PhoneError('PHONE_APP_DENIED', 'About phone requires the Settings application');
          const output = await this.shell(serial, ['am', 'start', '-a', 'android.settings.DEVICE_INFO_SETTINGS', '-p', action.package], signal);
          if (/Error|Exception/.test(output)) throw new PhoneError('PHONE_LAUNCH_FAILED', 'Unable to open About phone');
          break;
        }
        const result = await this.shell(serial, ['cmd', 'package', 'resolve-activity', '--brief', action.package], signal);
        const component = result.trim().split(/\r?\n/).find(line => /^[\w.]+\/[\w.$]+$/.test(line));
        if (!component) throw new PhoneError('PHONE_APP_UNAVAILABLE', 'The selected application has no launchable activity');
        const output = await this.shell(serial, ['am', 'start', ...(options?.resetTask ? ['--activity-clear-top', '--activity-single-top'] : []), '-n', component], signal);
        if (/Error|Exception/.test(output)) throw new PhoneError('PHONE_LAUNCH_FAILED', 'Unable to launch application');
        break;
      }
      case 'tap': await input(['tap', ...point(action.point)]); break;
      case 'doubleTap': await input(['tap', ...point(action.point)]); signal.throwIfAborted(); await input(['tap', ...point(action.point)]); break;
      case 'longPress': { const p = point(action.point); await input(['swipe', ...p, ...p, String(action.durationMs)]); break; }
      case 'swipe': await input(['swipe', ...point(action.start), ...point(action.end), String(action.durationMs)]); break;
      case 'typeText': {
        const editors = observation.elements.filter(node => node.focused && node.editable && !node.password);
        if (editors.length !== 1) throw new PhoneError('PHONE_INPUT_NOT_FOCUSED', 'Focus one non-password editable field before typing');
        const ascii = /^[a-zA-Z0-9 .,_@+-]+$/.test(action.text) && !action.text.includes('%');
        if (!ascii) {
          const capability = await this.textInputStatus(serial, signal);
          if (capability.unicode !== 'available') throw new PhoneError('PHONE_TEXT_INPUT_UNAVAILABLE', 'Automatic text input is unavailable. Check Phone settings or take over and type with the phone keyboard.', 409);
        }
        let target = editors[0];
        if (action.mode === 'replace') {
          // Replacement requires an accessible identity and current value, not an IME-only focus hint.
          if (target.resourceId === 'android:active-editor') throw new PhoneError('PHONE_TEXT_INPUT_UNAVAILABLE', 'Replacing text requires a visible editable field. Take over and inspect the field.', 409);
          const fresh = await this.observe(serial, signal);
          try {
            const current = fresh.elements.filter(node => sameTextEditor(target, node));
            if (fresh.package !== observation.package || current.length !== 1) throw new PhoneError('PHONE_INPUT_NOT_FOCUSED', 'The focused input field changed before replacement', 409);
            target = current[0];
          } finally { fresh.frame.fill(0); }
          if (target.text) {
            const help = await this.shell(serial, ['input'], signal);
            if (!help.includes('keycombination')) throw new PhoneError('PHONE_TEXT_INPUT_UNAVAILABLE', 'This phone cannot safely select all text. Take over and replace the field manually.', 409);
            try {
              await input(['keycombination', 'KEYCODE_CTRL_LEFT', 'KEYCODE_A']);
              const selected = await this.observe(serial, signal);
              try {
                if (selected.package !== observation.package || selected.elements.filter(node => sameTextEditor(target, node) && node.text === target.text).length !== 1)
                  throw new Error('Editor changed during selection');
              } finally { selected.frame.fill(0); }
            } catch {
              signal.throwIfAborted();
              throw new PhoneError('PHONE_TEXT_INPUT_UNCONFIRMED', 'Text selection started but the target field could not be verified. Take over and inspect the input field before retrying.', 409);
            }
          }
        }
        try {
          // The remote adb shell still parses arguments. Only a conservative ASCII subset uses input text.
          if (ascii) await input(['text', action.text.replaceAll(' ', '%s')]);
          else if (this.pasteText) await this.pasteText(action.text, signal);
          else {
            const { LocalScrcpyProvider } = await import('./scrcpy.js');
            const provider = new LocalScrcpyProvider(this.adbPath, serial, () => {}, undefined, true);
            try { await provider.pasteText(action.text, signal); } finally { await provider.close(); }
          }
          // Transport receipt does not prove insertion. Poll observations, never repeat input.
          await this.confirmText(serial, observation.package, target,
            text => action.mode === 'replace' ? text === action.text : text.includes(action.text), signal);
        } catch (error) {
          signal.throwIfAborted();
          if (error instanceof PhoneError && error.code === 'PHONE_TEXT_INPUT_UNCONFIRMED') throw error;
          throw new PhoneError('PHONE_TEXT_INPUT_UNCONFIRMED', 'Text may have been sent but insertion could not be verified. Take over and inspect the input field before retrying.', 409);
        }
        break;
      }
      case 'home': await input(['keyevent', 'KEYCODE_HOME']); break;
      case 'back': await input(['keyevent', 'KEYCODE_BACK']); break;
      case 'wait': await delay(action.durationMs, undefined, { signal }); return;
    }
    if (options?.settleMs !== 0) await delay(options?.settleMs ?? 350, undefined, { signal });
  }
}
