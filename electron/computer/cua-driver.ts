import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import type {
  AppInfo,
  CuaDriverLike,
  EmbeddedCuaDriverHostLike,
  ToolResult,
  WindowInfo,
  WindowStateOutput,
} from '@trycua/cua-driver';
import { z } from 'zod';
import type { ComputerAction, ComputerTarget } from '@xopcai/computer-control-contract';
import type { ComputerDriver, DriverObservation } from '../../src/computer/broker.js';
import { ComputerTargetError } from '../../src/computer/errors.js';

const exec = promisify(execFile);
type CuaSdkModule = typeof import('@trycua/cua-driver');
type CuaSdkLoader = () => Promise<CuaSdkModule>;
const Bounds = z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() });
const hash = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const DENIED_APPS = /(^com\.apple\.(Terminal|systempreferences|KeychainAccess)$|password|1password|bitwarden|iterm)/i;

function elementId(value: unknown): string | undefined {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string' && /^\d+$/.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  return undefined;
}

/** Cua also returns application menus; never disclose or act on those sibling roots. */
export function scopeWindowAccessibility(data: Record<string, unknown>) {
  const rows = Array.isArray(data.elements) ? data.elements as Array<Record<string, unknown>> : [];
  const roots = rows.filter(item => item.role === 'AXWindow' && item.depth === 0 && elementId(item.element_index));
  if (roots.length > 1) throw new Error('COMPUTER_AMBIGUOUS_WINDOW_TREE');
  if (!roots.length) return { elements: [], text: '' };
  const root = roots[0];
  const rootId = elementId(root.element_index)!;
  const allowed = new Set([rootId]);
  const elements = rows.filter(item => {
    if (item === root) return true;
    const id = elementId(item.element_index);
    const parentId = elementId(item.parent_index);
    if (!id || !parentId || !allowed.has(parentId)) return false;
    allowed.add(id); return true;
  });
  const lines = typeof data.tree_markdown === 'string' ? data.tree_markdown.split('\n') : [];
  const start = lines.findIndex(line => line.startsWith(`- [${rootId}] AXWindow`));
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
  private host?: EmbeddedCuaDriverHostLike;
  private client?: CuaDriverLike;
  private sdk?: CuaSdkModule;
  private starting?: Promise<void>;
  private stopping?: Promise<void>;
  private generation = 0;
  private elements: Array<Record<string, unknown>> = [];
  private frame?: { bounds: z.infer<typeof Bounds>; width: number; height: number };
  private setupStage = 'START';
  private readonly referenceSalt = randomUUID();
  constructor(
    private readonly binary: string,
    private readonly bundleId: string,
    private readonly loadSdk: CuaSdkLoader = () => import('@trycua/cua-driver'),
  ) {}

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
    this.setupStage = 'SDK';
    const sdk = await this.loadSdk();
    this.sdk = sdk;
    this.assertGeneration(generation);
    const host = new sdk.EmbeddedCuaDriverHost(this.binary, this.bundleId);
    this.host = host;
    const connection = await host.start();
    this.assertGeneration(generation);
    this.setupStage = 'IDENTITY';
    const client = sdk.CuaDriver.connect(connection.socketPath);
    this.client = client;
    const metadata = await client.metadata();
    if (!metadata.embedded || metadata.hostBundleId !== this.bundleId || metadata.pid !== connection.pid
      || metadata.driverVersion !== connection.driverVersion || metadata.contractVersion !== connection.contractVersion) {
      throw new Error('COMPUTER_DRIVER_HOST_IDENTITY_MISMATCH');
    }
    this.setupStage = 'PERMISSIONS';
    const permissions = await this.callUntyped('check_permissions', {});
    this.assertGeneration(generation);
    const source = permissions.data.source as Record<string, unknown> | undefined;
    if (!permissions.data.accessibility || !permissions.data.screen_recording || source?.attribution !== 'host') {
      throw new Error('COMPUTER_OS_PERMISSION_REQUIRED');
    }
  }
  private async callUntyped(name: string, args: Record<string, unknown>, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (!this.client) throw new Error('COMPUTER_DRIVER_OFFLINE');
    const result: ToolResult = await this.client.callTool(name, JSON.stringify(args), signal ? { signal } : undefined);
    signal?.throwIfAborted();
    if (result.isError) throw new Error(`COMPUTER_DRIVER_${name.toUpperCase()}_REFUSED`);
    let data: Record<string, unknown>;
    try { data = JSON.parse(result.structuredJson ?? result.rawJson ?? '{}') as Record<string, unknown>; }
    catch { throw new Error('COMPUTER_DRIVER_INVALID_RESULT'); }
    const content = result.images.map(image => ({ type: 'image', data: image.dataBase64, mimeType: image.mimeType }));
    return { data, content };
  }
  private async listApps(signal?: AbortSignal): Promise<AppInfo[]> {
    signal?.throwIfAborted();
    if (!this.client) throw new Error('COMPUTER_DRIVER_OFFLINE');
    const result = await this.client.listApps({}, signal ? { signal } : undefined);
    signal?.throwIfAborted();
    return result.apps;
  }
  private async listWindows(pid: number, signal?: AbortSignal): Promise<WindowInfo[]> {
    signal?.throwIfAborted();
    if (!this.client) throw new Error('COMPUTER_DRIVER_OFFLINE');
    const result = await this.client.listWindows({ pid }, signal ? { signal } : undefined);
    signal?.throwIfAborted();
    return result.windows.filter(window => window.pid === pid);
  }
  private async getWindowState(pid: number, windowId: bigint, options: {
    includeScreenshot?: boolean;
    maxElements?: number;
    maxDepth?: number;
    maxDimension?: number;
  }, signal?: AbortSignal): Promise<WindowStateOutput> {
    signal?.throwIfAborted();
    if (!this.client) throw new Error('COMPUTER_DRIVER_OFFLINE');
    const result = await this.client.getWindowState({ pid, windowId, includeAccessibilityTree: true, ...options }, signal ? { signal } : undefined);
    signal?.throwIfAborted();
    return result;
  }
  private jsonWindowId(windowId: bigint): number {
    const value = Number(windowId);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('COMPUTER_WINDOW_ID_UNSUPPORTED');
    return value;
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
    const rows = await this.listApps(signal);
    const normalized = query.normalize('NFKC').trim().toLocaleLowerCase();
    const result = new Map<string, { appId: string; name: string; running: boolean }>();
    for (const row of rows) {
      if (!row.bundleId) continue;
      try { this.assertAppAllowed(row.bundleId); } catch { continue; }
      const name = row.name || row.launchPath?.split('/').at(-1)?.replace(/\.app$/, '') || row.bundleId;
      if (![name, row.bundleId, row.launchPath?.split('/').at(-1) ?? ''].some(text => text.normalize('NFKC').toLocaleLowerCase().includes(normalized))) continue;
      const previous = result.get(row.bundleId);
      result.set(row.bundleId, { appId: row.bundleId, name: name.slice(0, 300), running: row.running || row.pid > 0 || !!previous?.running });
    }
    return [...result.values()].sort((a, b) => Number(b.running) - Number(a.running) || a.name.localeCompare(b.name));
  }
  async resolveTarget(appId: string, signal: AbortSignal, options: { prepare: boolean; windowRef?: string }): Promise<ComputerTarget> {
    this.assertAppAllowed(appId);
    await this.start(); signal.throwIfAborted();
    let rows = await this.listApps(signal);
    if (!rows.some(app => app.bundleId === appId)) throw new Error('COMPUTER_APP_NOT_FOUND');
    if (options.prepare && !rows.some(app => app.bundleId === appId && app.pid > 0)) {
      // Never accept URLs, argv, debug ports or a model-supplied launch path.
      await this.callUntyped('launch_app', { bundle_id: appId }, signal);
      rows = await this.listApps(signal);
    }
    const matches = rows.filter(app => app.bundleId === appId && app.pid > 0);
    if (!matches.length) throw new Error('COMPUTER_APP_NOT_RUNNING');
    if (matches.length !== 1) throw new Error('COMPUTER_APP_INSTANCE_AMBIGUOUS');
    const pid = matches[0].pid;
    const processIdentity = await this.processIdentity(pid);
    let windows = await this.listWindows(pid, signal);
    // A hidden app can publish many proxy surfaces before its main window is restored.
    // Preparation authorizes app activation, but not a guessed window or screenshot.
    if (options.prepare && !options.windowRef && windows.length > 1 && windows.every(window => !window.isOnScreen)) {
      if (await this.processIdentity(pid) !== processIdentity) throw new Error('COMPUTER_PROCESS_CHANGED');
      await this.callUntyped('bring_to_front', { pid }, signal);
      windows = await this.listWindows(pid, signal);
    }
    const ref = (window: typeof windows[number]) => hash(`${this.referenceSalt}:${appId}:${processIdentity}:${window.windowId}`);
    const candidates = windows.slice(0, 100).map(window => ({ windowRef: ref(window), title: (window.title || 'Untitled window').slice(0, 300), visible: window.isOnScreen }));
    // WindowServer also lists menu/proxy surfaces. Prefer actual AXWindow roots,
    // without capturing pixels or reading child content during target selection.
    let selectable = windows;
    if (!options.windowRef && selectable.length > 1) {
      if (selectable.length > 12 && selectable.some(window => window.isOnScreen)) selectable = selectable.filter(window => window.isOnScreen);
      if (selectable.length > 12) throw new ComputerTargetError('COMPUTER_WINDOW_AMBIGUOUS', candidates);
      const checks = await Promise.all(selectable.map(async window => {
        try {
          const state = await this.getWindowState(pid, window.windowId, { includeScreenshot: false, maxElements: 1, maxDepth: 1 },
            AbortSignal.any([signal, AbortSignal.timeout(2000)]));
          if (state.pid !== pid || state.windowId !== window.windowId || !Array.isArray(state.elements)) return undefined;
          if (state.elements.some(element => element.role === 'AXWindow' && element.depth === 0)) return true;
          return state.degraded === true ? undefined : false;
        } catch { signal.throwIfAborted(); return undefined; }
      }));
      // Unknown is not a proxy: retain it for native stacking/ambiguity resolution.
      selectable = selectable.filter((_window, index) => checks[index] !== false);
    }
    const visible = selectable.filter(window => window.isOnScreen);
    let window = options.windowRef ? windows.find(item => ref(item) === options.windowRef) : undefined;
    if (options.windowRef && !window) throw new ComputerTargetError('COMPUTER_WINDOW_CHANGED', candidates);
    if (!options.windowRef) {
      if (visible.length === 1) window = visible[0];
      else if (!visible.length && selectable.length === 1) window = selectable[0];
      else {
        // Native stacking metadata is authoritative; never infer focus from size or array order.
        const ranked = visible.filter(item => item.zIndex != null).sort((a, b) => a.zIndex! === b.zIndex! ? 0 : a.zIndex! > b.zIndex! ? -1 : 1);
        if (ranked.length === visible.length && ranked.length > 1 && ranked[0].zIndex !== ranked[1].zIndex) window = ranked[0];
      }
    }
    if (!window && windows.length > 1) throw new ComputerTargetError('COMPUTER_WINDOW_AMBIGUOUS', candidates);
    if (window && options.prepare) {
      signal.throwIfAborted();
      if (await this.processIdentity(pid) !== processIdentity) throw new Error('COMPUTER_PROCESS_CHANGED');
      await this.callUntyped('bring_to_front', { pid, window_id: this.jsonWindowId(window.windowId) }, signal);
      const restored = await this.listWindows(pid, signal);
      window = restored.find(item => item.pid === pid && item.windowId === window!.windowId);
    }
    if (!window?.isOnScreen) throw new ComputerTargetError('COMPUTER_WINDOW_REQUIRED', candidates);
    if (await this.processIdentity(pid) !== processIdentity) throw new Error('COMPUTER_PROCESS_CHANGED');
    return { appId, pid, processIdentity, windowId: window.windowId.toString(), width: Math.round(window.bounds.width), height: Math.round(window.bounds.height), geometryRevision: hash(JSON.stringify(window.bounds)) };
  }
  async observe(target: ComputerTarget, signal: AbortSignal): Promise<DriverObservation> {
    if (await this.processIdentity(target.pid) !== target.processIdentity) throw new Error('COMPUTER_PROCESS_CHANGED');
    const windowId = BigInt(target.windowId);
    const state = await this.getWindowState(target.pid, windowId, { includeScreenshot: true, maxElements: 180, maxDepth: 12, maxDimension: 1600 }, signal);
    // Some platforms cannot produce an affirmative frame-validity bit. An explicit
    // negative is fatal; exact pid/window identity and the image envelope remain required.
    if (state.pid !== target.pid || state.windowId !== windowId || state.screenshotFrameValid === false) throw new Error('COMPUTER_CAPTURE_TARGET_MISMATCH');
    const bounds = Bounds.parse(state.windowBounds);
    const screenshot = state.images[0];
    if (!screenshot?.dataBase64 || !['image/png', 'image/jpeg'].includes(screenshot.mimeType) || screenshot.dataBase64.length > 7 * 1024 * 1024) throw new Error('COMPUTER_CAPTURE_REQUIRED');
    const image = Buffer.from(screenshot.dataBase64, 'base64');
    const width = z.number().int().positive().parse(state.screenshotWidth);
    const height = z.number().int().positive().parse(state.screenshotHeight);
    const normalizedElements = (state.elements ?? []).map(element => ({
      element_index: element.elementIndex.toString(),
      role: element.role,
      depth: element.depth,
      ...(element.elementToken == null ? {} : { element_token: element.elementToken }),
      ...(element.label == null ? {} : { label: element.label }),
      ...(element.value == null ? {} : { value: element.value }),
      ...(element.valueDescription == null ? {} : { value_description: element.valueDescription }),
      ...(element.enabled == null ? {} : { enabled: element.enabled }),
      ...(element.selected == null ? {} : { selected: element.selected }),
      ...(element.inWebContent == null ? {} : { in_web_content: element.inWebContent }),
      ...(element.actions == null ? {} : { actions: element.actions }),
      ...(element.parentIndex == null ? {} : { parent_index: element.parentIndex.toString() }),
      ...(element.frame == null ? {} : { frame: element.frame }),
      ...(element.min == null ? {} : { min: element.min }),
      ...(element.max == null ? {} : { max: element.max }),
    }));
    const scoped = scopeWindowAccessibility({ elements: normalizedElements, tree_markdown: state.treeMarkdown });
    const { elements, text } = scoped;
    this.elements = elements;
    this.frame = { bounds, width, height };
    const stableElements = elements.map(({ element_token: _token, ...item }) => item);
    return { target: { ...target, width: Math.round(bounds.width), height: Math.round(bounds.height), geometryRevision: hash(JSON.stringify(bounds)) },
      summary: summarizeWindowAccessibility(stableElements, text, scoped.truncated === true || state.truncated === true || state.elementsComplete === false),
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
    if (action.kind === 'drag' && action.from.x === action.to.x && action.from.y === action.to.y) throw new Error('COMPUTER_DRAG_REQUIRES_MOVEMENT');
  }
  async perform(target: ComputerTarget, action: ComputerAction, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (await this.processIdentity(target.pid) !== target.processIdentity) throw new Error('COMPUTER_PROCESS_CHANGED');
    signal.throwIfAborted();
    this.validateAction(action);
    const windowId = BigInt(target.windowId);
    if (!this.client || !this.sdk) throw new Error('COMPUTER_DRIVER_OFFLINE');
    const actionTarget = new this.sdk.ActionTarget.Window({ pid: target.pid, windowId });
    switch (action.kind) {
      case 'wait': await delay(action.durationMs, undefined, { signal }); return;
      case 'click': {
        const button = action.button === 'right' ? this.sdk.ClickButton.Right : this.sdk.ClickButton.Left;
        await this.client.click({ target: actionTarget, position: new this.sdk.ClickPosition.Coordinates(action.point),
          deliveryMode: this.sdk.InputDeliveryMode.Background, count: action.count, button }, { signal });
        return;
      }
      case 'drag':
        await this.callUntyped('drag', { pid: target.pid, window_id: this.jsonWindowId(windowId), delivery_mode: 'background',
          from_x: action.from.x, from_y: action.from.y, to_x: action.to.x, to_y: action.to.y,
          duration_ms: 500, steps: 20, button: 'left' }, signal); return;
      case 'typeText': {
        const field = this.editable(action);
        // Web renderers require real field focus. Never fall back after an unknown write.
        const editableTarget = field.in_web_content === true ? action.point! : { element_token: field.element_token };
        await this.callUntyped('type_text', { pid: target.pid, window_id: this.jsonWindowId(windowId), delivery_mode: 'background',
          ...editableTarget, text: action.text }, signal); return;
      }
      case 'setValue':
        await this.callUntyped('set_value', { pid: target.pid, window_id: this.jsonWindowId(windowId), element_token: this.editable(action).element_token, value: action.text }, signal); return;
      case 'pressKeys': {
        const keys = nativeKeys(action.keys);
        if (keys.length === 1) await this.client.pressKey({ key: keys[0], target: actionTarget }, { signal });
        else await this.client.hotkey({ keys, target: actionTarget }, { signal });
        return;
      }
      case 'scroll': {
        const delta = action.deltaY || action.deltaX;
        // Native wheel delivery is deliberately bounded, never advertised as exact pixel travel.
        const direction = action.deltaY
          ? (delta > 0 ? this.sdk.ScrollDirection.Down : this.sdk.ScrollDirection.Up)
          : (delta > 0 ? this.sdk.ScrollDirection.Right : this.sdk.ScrollDirection.Left);
        await this.client.scroll({ target: actionTarget, ...action.point, by: this.sdk.ScrollBy.Line,
          amount: BigInt(Math.min(5, Math.max(1, Math.ceil(Math.abs(delta) / 100)))), direction }, { signal });
        return;
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
    const client = this.client; this.client = undefined;
    this.sdk = undefined;
    const host = this.host; this.host = undefined;
    await client?.shutdown().catch(() => {});
    (client as { uniffiDestroy?: () => void } | undefined)?.uniffiDestroy?.();
    await host?.stop().catch(() => {});
    (host as { uniffiDestroy?: () => void } | undefined)?.uniffiDestroy?.();
  }
}
