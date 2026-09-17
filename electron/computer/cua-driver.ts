import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, access, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';
import type { ComputerAction, ComputerTarget } from '@xopcai/computer-control-contract';
import type { ComputerDriver, DriverObservation } from '../../src/computer/broker.js';
import { ComputerTargetError } from '../../src/computer/errors.js';

const exec = promisify(execFile);
const Bounds = z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() });
const hash = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const DENIED_APPS = /(^com\.apple\.(Terminal|systempreferences|KeychainAccess)$|password|1password|bitwarden|iterm)/i;
const Apps = z.array(z.object({ bundle_id: z.string().nullish(), name: z.string().optional(), pid: z.number().int(),
  running: z.boolean().optional(), launch_path: z.string().nullish() }));
const Windows = z.array(z.object({ window_id: z.number().int().safe(), pid: z.number().int(), bounds: Bounds,
  title: z.string().nullish(), is_on_screen: z.boolean(), z_index: z.number().int().nullish() }));

/** Cua also returns application menus; never disclose or act on those sibling roots. */
export function scopeWindowAccessibility(data: Record<string, unknown>) {
  const rows = Array.isArray(data.elements) ? data.elements as Array<Record<string, unknown>> : [];
  const roots = rows.filter(item => item.role === 'AXWindow' && item.depth === 0 && Number.isInteger(item.element_index));
  if (roots.length > 1) throw new Error('COMPUTER_AMBIGUOUS_WINDOW_TREE');
  if (!roots.length) return { elements: [], text: '' };
  const root = roots[0];
  const allowed = new Set([root.element_index]);
  const elements = rows.filter(item => {
    if (item === root) return true;
    if (!Number.isInteger(item.element_index) || !allowed.has(item.parent_index)) return false;
    allowed.add(item.element_index); return true;
  });
  const lines = typeof data.tree_markdown === 'string' ? data.tree_markdown.split('\n') : [];
  const start = lines.findIndex(line => line.startsWith(`- [${root.element_index}] AXWindow`));
  const selected: string[] = [];
  if (start >= 0) {
    selected.push(lines[start]);
    for (const line of lines.slice(start + 1)) {
      if (!/^\s+- /.test(line)) break;
      selected.push(line);
    }
  }
  const text = selected.join('\n');
  return { elements, text: text.slice(0, 4000), truncated: text.length > 4000 };
}

/** Truncate whole records, not serialized JSON or field values used as evidence. */
export function summarizeWindowAccessibility(elements: Array<Record<string, unknown>>, text: string, truncated = false): string {
  const summary = { text, ...(!elements.length ? { notice: 'Accessibility content is unavailable, not an empty page. Use observe with a visual question. Do not guess controls or claim text was read.' } : {}),
    truncated, elements: [] as Array<Record<string, unknown>> };
  while (JSON.stringify(summary.text).length > 6000) { summary.text = summary.text.slice(0, Math.floor(summary.text.length / 2)); summary.truncated = true; }
  for (const { element_token: _token, ...item } of elements) {
    summary.elements.push({ ...item, ref: `e${item.element_index}` });
    if (JSON.stringify(summary).length > 12_000) { summary.elements.pop(); summary.truncated = true; }
  }
  return JSON.stringify(summary);
}

function nativeKeys(keys: string[]): string[] {
  const aliases: Record<string, string> = { enter: 'return', esc: 'escape', backspace: 'delete', arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right' };
  return keys.map(key => aliases[key.toLowerCase()] ?? key.toLowerCase());
}

/** Private app-owned daemon. No shell, raw tool exposure, global daemon or foreground fallback. */
export class CuaComputerDriver implements ComputerDriver {
  private daemon?: ChildProcess;
  private client?: Client;
  private directory?: string;
  private starting?: Promise<void>;
  private stopping?: Promise<void>;
  private generation = 0;
  private elements: Array<Record<string, unknown>> = [];
  private frame?: { bounds: z.infer<typeof Bounds>; width: number; height: number };
  private setupStage = 'START';
  private readonly referenceSalt = randomUUID();
  constructor(private readonly binary: string, private readonly bundleId: string) {}

  private async start(): Promise<void> {
    if (this.stopping) throw new Error('COMPUTER_DRIVER_STOPPING');
    if (this.client) return;
    if (this.starting) return this.starting;
    this.starting = this.startPrivateDaemon(this.generation).catch(async (error) => {
      await this.cleanup();
      if (error instanceof Error && /^COMPUTER_[A-Z_]+$/.test(error.message)) throw error;
      // Stage codes contain no raw transport data, screenshots, app titles or credentials.
      throw new Error(`COMPUTER_DRIVER_SETUP_${this.setupStage}_FAILED`);
    }).finally(() => { this.starting = undefined; });
    return this.starting;
  }
  private assertGeneration(generation: number): void {
    if (generation !== this.generation) throw new Error('COMPUTER_DRIVER_STOPPED');
  }
  private async startPrivateDaemon(generation: number): Promise<void> {
    this.setupStage = 'BINARY';
    if (process.type !== 'browser') throw new Error('COMPUTER_DRIVER_REQUIRES_ELECTRON_MAIN');
    await access(this.binary);
    this.assertGeneration(generation);
    this.directory = await mkdtemp(join(tmpdir(), 'xc-'));
    this.assertGeneration(generation);
    const socket = join(this.directory, 'd.sock');
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '', TMPDIR: tmpdir(),
      CUA_DRIVER_EMBEDDED: '1', CUA_DRIVER_HOST_BUNDLE_ID: this.bundleId,
      CUA_DRIVER_PERMISSION_MODE: 'standard', CUA_DRIVER_RS_TELEMETRY_ENABLED: 'false',
    };
    this.daemon = spawn(this.binary, ['serve', '--embedded', '--parent-liveness-stdio', '--socket', socket], { env, stdio: ['pipe', 'ignore', 'ignore'] });
    this.daemon.on('error', () => { this.client = undefined; });
    const deadline = Date.now() + 10_000;
    while (true) {
      this.assertGeneration(generation);
      if (!this.daemon || this.daemon.exitCode !== null || this.daemon.signalCode) throw new Error('COMPUTER_DRIVER_START_FAILED');
      try { await access(socket); break; } catch { if (Date.now() >= deadline) throw new Error('COMPUTER_DRIVER_START_TIMEOUT'); await delay(50); }
    }
    const client = new Client({ name: 'xopc-desktop-broker', version: '1.0.0' });
    this.setupStage = 'MCP';
    this.assertGeneration(generation);
    this.client = client;
    await client.connect(new StdioClientTransport({ command: this.binary, args: ['mcp', '--embedded', '--socket', socket], env, stderr: 'ignore' }), { timeout: 5000 });
    this.assertGeneration(generation);
    this.setupStage = 'IDENTITY';
    const health = await this.call('health_report', { include: ['bundle_identity'] });
    const checks = z.array(z.object({ name: z.string(), status: z.string(), data: z.record(z.string(), z.unknown()).optional() })).parse(health.data.checks);
    const identity = checks.find(item => item.name === 'bundle_identity');
    if (identity?.status !== 'pass' || identity.data?.bundle_identifier !== this.bundleId || identity.data?.parent_process_id !== process.pid || identity.data?.identity_source !== 'parent_application') {
      throw new Error('COMPUTER_DRIVER_HOST_IDENTITY_MISMATCH');
    }
    this.setupStage = 'PERMISSIONS';
    const permissions = await this.call('check_permissions', {});
    this.assertGeneration(generation);
    const source = permissions.data.source as Record<string, unknown> | undefined;
    if (!permissions.data.accessibility || !permissions.data.screen_recording || source?.attribution !== 'host') {
      throw new Error('COMPUTER_OS_PERMISSION_REQUIRED');
    }
  }
  private async call(name: string, args: Record<string, unknown>, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (!this.client) throw new Error('COMPUTER_DRIVER_OFFLINE');
    const result = await this.client.callTool({ name, arguments: args }, undefined, { signal, timeout: 25_000 });
    signal?.throwIfAborted();
    if (result.isError) throw new Error(`COMPUTER_DRIVER_${name.toUpperCase()}_REFUSED`);
    let data = result.structuredContent as Record<string, unknown> | undefined;
    const content = result.content as Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    if (!data) {
      const text = content.find(item => item.type === 'text')?.text;
      try { data = text ? JSON.parse(text) : {}; } catch { throw new Error('COMPUTER_DRIVER_INVALID_RESULT'); }
    }
    return { data: data!, content };
  }
  private async processIdentity(pid: number): Promise<string> {
    const { stdout } = await exec('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { timeout: 2000 });
    if (!stdout.trim()) throw new Error('COMPUTER_PROCESS_EXITED');
    return `${pid}:${stdout.trim()}`;
  }
  private assertAppAllowed(appId: string): void {
    if (appId === this.bundleId || appId === 'ai.xopc.xopc' || appId === 'com.github.Electron') throw new Error('COMPUTER_SELF_CONTROL_DENIED');
    if (DENIED_APPS.test(appId)) throw new Error('COMPUTER_SENSITIVE_APP_MANUAL_ONLY');
  }
  async discover(query: string, signal: AbortSignal) {
    await this.start(); signal.throwIfAborted();
    const rows = Apps.parse((await this.call('list_apps', {}, signal)).data.apps);
    const normalized = query.normalize('NFKC').trim().toLocaleLowerCase();
    const result = new Map<string, { appId: string; name: string; running: boolean }>();
    for (const row of rows) {
      if (!row.bundle_id) continue;
      try { this.assertAppAllowed(row.bundle_id); } catch { continue; }
      const name = row.name || row.launch_path?.split('/').at(-1)?.replace(/\.app$/, '') || row.bundle_id;
      if (![name, row.bundle_id, row.launch_path?.split('/').at(-1) ?? ''].some(text => text.normalize('NFKC').toLocaleLowerCase().includes(normalized))) continue;
      const previous = result.get(row.bundle_id);
      result.set(row.bundle_id, { appId: row.bundle_id, name: name.slice(0, 300), running: row.pid > 0 || !!previous?.running });
    }
    return [...result.values()].sort((a, b) => Number(b.running) - Number(a.running) || a.name.localeCompare(b.name));
  }
  async resolveTarget(appId: string, signal: AbortSignal, options: { prepare: boolean; windowRef?: string }): Promise<ComputerTarget> {
    this.assertAppAllowed(appId);
    await this.start(); signal.throwIfAborted();
    let rows = Apps.parse((await this.call('list_apps', {}, signal)).data.apps);
    if (!rows.some(app => app.bundle_id === appId)) throw new Error('COMPUTER_APP_NOT_FOUND');
    if (options.prepare && !rows.some(app => app.bundle_id === appId && app.pid > 0)) {
      // Never accept URLs, argv, debug ports or a model-supplied launch path.
      await this.call('launch_app', { bundle_id: appId }, signal);
      rows = Apps.parse((await this.call('list_apps', {}, signal)).data.apps);
    }
    const matches = rows.filter(app => app.bundle_id === appId && app.pid > 0);
    if (!matches.length) throw new Error('COMPUTER_APP_NOT_RUNNING');
    if (matches.length !== 1) throw new Error('COMPUTER_APP_INSTANCE_AMBIGUOUS');
    const pid = matches[0].pid;
    const processIdentity = await this.processIdentity(pid);
    const listWindows = async () => Windows.parse((await this.call('list_windows', { pid }, signal)).data.windows).filter(window => window.pid === pid);
    let windows = await listWindows();
    // A hidden app can publish many proxy surfaces before its main window is restored.
    // Preparation authorizes app activation, but not a guessed window or screenshot.
    if (options.prepare && !options.windowRef && windows.length > 1 && windows.every(window => !window.is_on_screen)) {
      if (await this.processIdentity(pid) !== processIdentity) throw new Error('COMPUTER_PROCESS_CHANGED');
      await this.call('bring_to_front', { pid }, signal);
      windows = await listWindows();
    }
    const ref = (window: typeof windows[number]) => hash(`${this.referenceSalt}:${appId}:${processIdentity}:${window.window_id}`);
    const candidates = windows.slice(0, 100).map(window => ({ windowRef: ref(window), title: (window.title || 'Untitled window').slice(0, 300), visible: window.is_on_screen }));
    // WindowServer also lists menu/proxy surfaces. Prefer actual AXWindow roots,
    // without capturing pixels or reading child content during target selection.
    let selectable = windows;
    if (!options.windowRef && selectable.length > 1) {
      if (selectable.length > 12 && selectable.some(window => window.is_on_screen)) selectable = selectable.filter(window => window.is_on_screen);
      if (selectable.length > 12) throw new ComputerTargetError('COMPUTER_WINDOW_AMBIGUOUS', candidates);
      const checks = await Promise.all(selectable.map(async window => {
        try {
          const state = await this.call('get_window_state', { pid, window_id: window.window_id, include_screenshot: false, max_elements: 1, max_depth: 1 },
            AbortSignal.any([signal, AbortSignal.timeout(2000)]));
          if (state.data.pid !== pid || state.data.window_id !== window.window_id || !Array.isArray(state.data.elements)) return undefined;
          if (state.data.elements.some((element: any) => element.role === 'AXWindow' && element.depth === 0)) return true;
          return state.data.degraded === true ? undefined : false;
        } catch { signal.throwIfAborted(); return undefined; }
      }));
      // Unknown is not a proxy: retain it for native stacking/ambiguity resolution.
      selectable = selectable.filter((_window, index) => checks[index] !== false);
    }
    const visible = selectable.filter(window => window.is_on_screen);
    let window = options.windowRef ? windows.find(item => ref(item) === options.windowRef) : undefined;
    if (options.windowRef && !window) throw new ComputerTargetError('COMPUTER_WINDOW_CHANGED', candidates);
    if (!options.windowRef) {
      if (visible.length === 1) window = visible[0];
      else if (!visible.length && selectable.length === 1) window = selectable[0];
      else {
        // Native stacking metadata is authoritative; never infer focus from size or array order.
        const ranked = visible.filter(item => item.z_index != null).sort((a, b) => b.z_index! - a.z_index!);
        if (ranked.length === visible.length && ranked.length > 1 && ranked[0].z_index !== ranked[1].z_index) window = ranked[0];
      }
    }
    if (!window && windows.length > 1) throw new ComputerTargetError('COMPUTER_WINDOW_AMBIGUOUS', candidates);
    if (window && options.prepare) {
      signal.throwIfAborted();
      if (await this.processIdentity(pid) !== processIdentity) throw new Error('COMPUTER_PROCESS_CHANGED');
      await this.call('bring_to_front', { pid, window_id: window.window_id }, signal);
      const restored = Windows.parse((await this.call('list_windows', { pid }, signal)).data.windows);
      window = restored.find(item => item.pid === pid && item.window_id === window!.window_id);
    }
    if (!window?.is_on_screen) throw new ComputerTargetError('COMPUTER_WINDOW_REQUIRED', candidates);
    if (await this.processIdentity(pid) !== processIdentity) throw new Error('COMPUTER_PROCESS_CHANGED');
    return { appId, pid, processIdentity, windowId: String(window.window_id), width: Math.round(window.bounds.width), height: Math.round(window.bounds.height), geometryRevision: hash(JSON.stringify(window.bounds)) };
  }
  async observe(target: ComputerTarget, signal: AbortSignal): Promise<DriverObservation> {
    if (await this.processIdentity(target.pid) !== target.processIdentity) throw new Error('COMPUTER_PROCESS_CHANGED');
    const state = await this.call('get_window_state', { pid: target.pid, window_id: Number(target.windowId), max_elements: 180, max_depth: 12, max_dimension: 1600 }, signal);
    if (state.data.pid !== target.pid || state.data.window_id !== Number(target.windowId) || state.data.screenshot_frame_valid !== true) throw new Error('COMPUTER_CAPTURE_TARGET_MISMATCH');
    const bounds = Bounds.parse(state.data.window_bounds);
    const screenshot = state.content.find(item => item.type === 'image');
    if (!screenshot?.data || !['image/png', 'image/jpeg'].includes(screenshot.mimeType ?? '') || screenshot.data.length > 7 * 1024 * 1024) throw new Error('COMPUTER_CAPTURE_REQUIRED');
    const image = Buffer.from(screenshot.data, 'base64');
    const width = z.number().int().positive().parse(state.data.screenshot_width);
    const height = z.number().int().positive().parse(state.data.screenshot_height);
    const scoped = scopeWindowAccessibility(state.data);
    const { elements, text } = scoped;
    this.elements = elements;
    this.frame = { bounds, width, height };
    const stableElements = elements.map(({ element_token: _token, ...item }) => item);
    return { target: { ...target, width: Math.round(bounds.width), height: Math.round(bounds.height), geometryRevision: hash(JSON.stringify(bounds)) },
      summary: summarizeWindowAccessibility(stableElements, text, scoped.truncated === true || state.data.truncated === true || state.data.elements_complete === false),
      // Do not include per-snapshot tokens in the digest; compare visible content + geometry.
      stateDigest: hash(JSON.stringify({ elements: stableElements, bounds, width, height }) + hash(image)),
      image, mimeType: screenshot.mimeType as 'image/png' | 'image/jpeg', imageWidth: width, imageHeight: height };
  }
  private editable(action: Extract<ComputerAction, { kind: 'typeText' | 'setValue' }>) {
    const frame = this.frame;
    const candidates = this.elements.filter(item => {
      if (!['AXTextField', 'AXTextArea'].includes(String(item.role)) || item.enabled === false) return false;
      if (/password|passcode|验证码|密码|one.time.code/i.test(String(item.label ?? ''))) return false;
      if (action.kind === 'setValue') return action.ref === `e${item.element_index}` && item.in_web_content !== true;
      if (!action.point || !frame) return false;
      const box = item.frame as { x: number; y: number; w: number; h: number } | undefined;
      const x = frame.bounds.x + action.point.x * frame.bounds.width / frame.width;
      const y = frame.bounds.y + action.point.y * frame.bounds.height / frame.height;
      return box && x >= box.x && y >= box.y && x < box.x + box.w && y < box.y + box.h;
    });
    if (candidates.length !== 1 || typeof candidates[0].element_token !== 'string') throw new Error('COMPUTER_EDITABLE_TARGET_REQUIRED');
    return candidates[0];
  }
  validateAction(action: ComputerAction): void {
    if (action.kind === 'typeText' || action.kind === 'setValue') this.editable(action);
    if (action.kind === 'pressKeys') {
      const keys = nativeKeys(action.keys);
      const modifiers = new Set(['cmd', 'command', 'ctrl', 'control', 'alt', 'option', 'shift', 'fn']);
      const main = keys.at(-1)!;
      if (!keys.slice(0, -1).every(key => modifiers.has(key)) || !/^(return|tab|escape|up|down|left|right|space|delete|home|end|pageup|pagedown|f[1-9]|f1[0-2]|[a-z0-9])$/.test(main)) throw new Error('COMPUTER_KEY_NOT_SUPPORTED');
      // Global/app escape shortcuts are not scoped to the authorized window.
      if (keys.slice(0, -1).some(key => key !== 'shift') && ['q', 'w', 'h', 'm', 'space', 'tab', 'escape'].includes(main)) throw new Error('COMPUTER_KEY_SCOPE_UNSAFE');
    }
    if (action.kind === 'scroll' && (!!action.deltaX === !!action.deltaY)) throw new Error('COMPUTER_SCROLL_REQUIRES_ONE_AXIS');
  }
  async perform(target: ComputerTarget, action: ComputerAction, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (await this.processIdentity(target.pid) !== target.processIdentity) throw new Error('COMPUTER_PROCESS_CHANGED');
    signal.throwIfAborted();
    this.validateAction(action);
    const base = { pid: target.pid, window_id: Number(target.windowId), delivery_mode: 'background' };
    switch (action.kind) {
      case 'wait': await delay(action.durationMs, undefined, { signal }); return;
      case 'click': await this.call('click', { ...base, ...action.point, count: action.count, button: action.button }, signal); return;
      case 'typeText': {
        const field = this.editable(action);
        // Web renderers require real field focus. Never fall back after an unknown write.
        const target = field.in_web_content === true ? action.point! : { element_token: field.element_token };
        await this.call('type_text', { ...base, ...target, text: action.text }, signal); return;
      }
      case 'setValue':
        await this.call('set_value', { pid: target.pid, window_id: Number(target.windowId), element_token: this.editable(action).element_token, value: action.text }, signal); return;
      case 'pressKeys': {
        const keys = nativeKeys(action.keys);
        await this.call(keys.length === 1 ? 'press_key' : 'hotkey', { ...base, ...(keys.length === 1 ? { key: keys[0] } : { keys }) }, signal); return;
      }
      case 'scroll': {
        const delta = action.deltaY || action.deltaX;
        // Native wheel delivery is deliberately bounded, never advertised as exact pixel travel.
        await this.call('scroll', { ...base, ...action.point, by: 'line', amount: Math.min(5, Math.max(1, Math.ceil(Math.abs(delta) / 100))),
          direction: action.deltaY ? (delta > 0 ? 'down' : 'up') : (delta > 0 ? 'right' : 'left') }, signal); return;
      }
    }
  }
  stop(): Promise<void> {
    this.generation++;
    if (!this.stopping) {
      const starting = this.starting;
      this.stopping = (async () => { await this.cleanup(); await starting?.catch(() => {}); await this.cleanup(); })()
        .finally(() => { this.stopping = undefined; });
    }
    return this.stopping;
  }
  private async cleanup(): Promise<void> {
    this.elements = []; this.frame = undefined;
    const daemon = this.daemon; this.daemon = undefined;
    const client = this.client; this.client = undefined;
    if (daemon && daemon.exitCode === null && !daemon.signalCode) {
      const exited = new Promise<void>((resolve) => { daemon.once('exit', () => resolve()); daemon.once('error', () => resolve()); if (!daemon.pid) resolve(); });
      daemon.kill('SIGTERM');
      const force = setTimeout(() => daemon.kill('SIGKILL'), 250); force.unref();
      await exited; clearTimeout(force);
    }
    await client?.close().catch(() => {});
    const directory = this.directory; this.directory = undefined;
    if (directory) { await rm(join(directory, 'd.sock'), { force: true }); await rmdir(directory).catch(() => {}); }
  }
}
