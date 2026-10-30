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
import { computerActionInputs, type ComputerAction, type ComputerPrimitiveAction, type ComputerTarget, type ComputerInputTiming } from '@xopcai/computer-control-contract';
import type { ComputerDriver, DriverObservation } from '../../src/computer/broker.js';
import { ComputerInputTimer } from '../../src/computer/native-timing.js';
import { ComputerTargetError } from '../../src/computer/errors.js';
import { normalizeComputerKeys as nativeKeys } from '../../src/computer/keyboard.js';
import { createLogger } from '../../src/utils/logger.js';
import { windowsAppIdentity, windowsAppMatches, assertWindowsAppAllowed } from './windows-apps.js';
import { readWindowsComputerIdentity, type WindowsInputState } from './windows-native.js';
import { normalizeWindowsAccessibility } from './windows-accessibility.js';
import { enrichWindowsInput, windowsInputAllowed } from './windows-input.js';
import { decodeNativeBatchResult, supportsExactNativeBatch, supportsNativeCapability, type NativeBatchProgress } from './native-batch.js';
import { ReadinessPulse, withWindowReadiness } from './window-readiness.js';
import { decodeNativeWindowCandidates, type NativeWindowCandidate } from './native-windows.js';
import { decodeNativeProcessIdentity } from './native-process-identity.js';
import { computerNativeInputError } from '../../src/computer/native-errors.js';

const exec = promisify(execFile);
const log = createLogger('ComputerDriver');
type CuaSdkModule = typeof import('@trycua/cua-driver');
type CuaSdkLoader = () => Promise<CuaSdkModule>;
type PreparationStage = 'appCatalog' | 'processIdentity' | 'windowMetadata' | 'windowProbe' | 'capture' | 'pollWait';
interface PreparationTiming {
  wallMs: number; hostFocusMs: number; systemOpenMs: number; reusedPreparedFrame: boolean; reusedPendingCapture: boolean; otherMs: number;
  stagesMs: Record<PreparationStage, number>; calls: Record<PreparationStage, number>;
  coveredWorkspaceHints: number; observerCleanupMs: number; observerCleanupComplete?: boolean;
  metadataSamples: Array<{ atMs: number; native: Record<string, unknown> }>;
  readinessSamples: Array<{ atMs: number; reason: string }>;
  captureAttempts: Array<{ atMs: number; durationMs: number; reason: string; expectedBounds: z.infer<typeof Bounds>; capturedBounds?: z.infer<typeof Bounds>; width?: number; height?: number; frameValid?: boolean; imageCount: number }>;
}
const Bounds = z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() });
const hash = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
function hasWindowFrame(state: WindowStateOutput): boolean {
  const image = state.images[0];
  return state.screenshotFrameValid !== false && Number.isSafeInteger(state.screenshotWidth) && state.screenshotWidth! > 0
    && Number.isSafeInteger(state.screenshotHeight) && state.screenshotHeight! > 0 && Bounds.safeParse(state.windowBounds).success
    && !!image && ['image/png', 'image/jpeg'].includes(image.mimeType) && image.dataBase64.length > 0
    && image.dataBase64.length <= 7 * 1024 * 1024;
}
const DENIED_APPS = /(^com\.apple\.(Terminal|systempreferences|KeychainAccess)$|password|1password|bitwarden|iterm)/i;

async function cleanupDeadline(operation: () => Promise<unknown>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([Promise.resolve().then(operation), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('COMPUTER_DRIVER_CLEANUP_UNCONFIRMED')), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

function semanticActions(element: Record<string, unknown>): string[] {
  if (typeof element.element_token !== 'string' || !element.element_token || element.enabled === false
    || element.in_web_content === true || element.role === 'AXSecureTextField') return [];
  const actions = Array.isArray(element.actions) ? element.actions : [];
  return [
    ...(actions.includes('AXPress') ? ['activate'] : []),
    ...(actions.includes('AXShowMenu') ? ['showMenu'] : []),
    ...(element.inputAllowed === true ? ['setValue'] : []),
  ];
}

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
export function summarizeWindowAccessibility(elements: Array<Record<string, unknown>>, text: string, truncated = false, platform?: NodeJS.Platform): string {
  const summary = { ...(platform ? { platform } : {}), text, ...(!elements.length ? { notice: 'Accessibility content is unavailable, not an empty page. Use observe with a visual question. Do not guess controls or claim text was read.' } : {}),
    truncated, elements: [] as Array<Record<string, unknown>> };
  while (JSON.stringify(summary.text).length > 6000) { summary.text = summary.text.slice(0, Math.floor(summary.text.length / 2)); summary.truncated = true; }
  for (const { element_token: _token, ...item } of elements) {
    summary.elements.push({ ...item, ref: `e${item.element_index}` });
    if (JSON.stringify(summary).length > 12_000) { summary.elements.pop(); summary.truncated = true; }
  }
  return JSON.stringify(summary);
}

/** Private app-owned daemon. No shell, raw tool exposure, global daemon or foreground fallback. */
export class CuaComputerDriver implements ComputerDriver {
  private host?: EmbeddedCuaDriverHostLike;
  private client?: CuaDriverLike;
  private sdk?: CuaSdkModule;
  private starting?: Promise<void>;
  private stopping?: Promise<void>;
  private cleanupUnconfirmed = false;
  private generation = 0;
  private elements: Array<Record<string, unknown>> = [];
  private frame?: { bounds: z.infer<typeof Bounds>; width: number; height: number };
  private observedTarget?: ComputerTarget;
  private setupStage = 'START';
  private readonly referenceSalt = randomUUID();
  private readonly windowsApps = new Map<string, AppInfo>();
  private windowsInput?: WindowsInputState;
  private exactNativeBatch = false;
  private runningAppsOnly = false;
  private foregroundAppPreparation = false;
  private inputWindowCandidates = false;
  private windowLayoutBounds = false;
  private exactWindowMetadata = false;
  private kernelProcessIdentity = false;
  private readinessNotifications = false;
  private preparationPulse?: ReadinessPulse;
  private windowProcessIdentity = false;
  private preparationIdentity?: string;
  private readinessPid?: number;
  private readinessNewProcess = false;
  private readinessWindowKey?: string;
  private unavailableReadinessKey?: string;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private preparedFrame?: { appId: string; pid: number; windowId: bigint; processIdentity: string; capturedAt: number; state: WindowStateOutput };
  private preparationTiming?: PreparationTiming;
  private preparationClock = 0;
  getLastPreparationTiming() { return this.preparationTiming ? structuredClone(this.preparationTiming) : undefined; }
  private async measurePreparation<T>(stage: PreparationStage, work: () => Promise<T>): Promise<T> {
    const metrics = this.preparingSince === undefined ? undefined : this.preparationTiming;
    if (!metrics) return work();
    const started = performance.now(); metrics.calls[stage]++;
    try { return await work(); } finally { metrics.stagesMs[stage] += performance.now() - started; }
  }
  private preparationSample(reason: string): void {
    if (this.preparingSince !== undefined && this.preparationTiming && this.preparationTiming.readinessSamples.length < 256) {
      this.preparationTiming.readinessSamples.push({ atMs: performance.now() - this.preparationClock, reason });
    }
  }
  private captureStats = { attempts: 0, invalidFrames: 0, recovered: 0, exhausted: 0 };
  private preparingSince?: number;
  getPreparationState() { return this.preparingSince === undefined ? undefined : { startedAt: this.preparingSince }; }
  getCaptureStats() { return { ...this.captureStats }; }
  async validatePreviewTarget(target: ComputerTarget, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (!this.client || await this.processIdentity(target.pid) !== target.processIdentity) throw new Error('COMPUTER_PROCESS_CHANGED');
    await this.assertWindowApp(target, signal);
    const windows = await this.listWindows(target.pid, signal);
    const window = windows.find(item => item.windowId.toString() === target.windowId);
    if (!window || window.pid !== target.pid) throw new Error('COMPUTER_WINDOW_CHANGED');
    signal.throwIfAborted();
  }
  async focusTarget(target: ComputerTarget, signal: AbortSignal): Promise<void> {
    await this.validatePreviewTarget(target, signal);
    if (this.platform === 'darwin') await this.prepareApplication(target.appId, signal);
    signal.throwIfAborted();
    await this.validatePreviewTarget(target, signal);
    await this.callUntyped('bring_to_front', { pid: target.pid, window_id: this.jsonWindowId(BigInt(target.windowId)) }, signal);
  }
  constructor(
    private readonly binary: string,
    private readonly bundleId: string,
    private readonly loadSdk: CuaSdkLoader = () => import('@trycua/cua-driver'),
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly followsActiveSpace: () => boolean = () => false,
  ) {}

  /** Start only the private transport; does not select or authorize a target. */
  async warmup(): Promise<void> { await this.start(); }
  /** Broker calls this only after completed work, with no dispatch in flight. */
  async idle(): Promise<void> {
    if (this.starting || this.stopping || this.cleanupUnconfirmed) { await this.stop(); return; }
    this.preparedFrame = undefined; this.elements = []; this.frame = undefined;
    this.observedTarget = undefined; this.windowsInput = undefined;
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => { void this.stop().catch(error => log.warn({ err: error }, 'Idle driver cleanup failed')); }, 30_000);
    this.idleTimer.unref();
  }
  private async start(): Promise<void> {
    clearTimeout(this.idleTimer);
    if (this.cleanupUnconfirmed) throw new Error('COMPUTER_DRIVER_CLEANUP_UNCONFIRMED');
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
    if (this.platform !== 'darwin' && !(this.platform === 'win32' && process.arch === 'x64')) throw new Error('COMPUTER_PLATFORM_UNSUPPORTED');
    if ((process as NodeJS.Process & { type?: string }).type !== 'browser') throw new Error('COMPUTER_DRIVER_REQUIRES_ELECTRON_MAIN');
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
    const inventory = typeof client.listToolsJson === 'function' ? await client.listToolsJson() : '';
    this.exactNativeBatch = supportsExactNativeBatch(inventory);
    this.runningAppsOnly = this.platform === 'darwin' && supportsNativeCapability(inventory, 'list_apps', 'apps.running.v1');
    this.foregroundAppPreparation = this.platform === 'darwin';
    this.inputWindowCandidates = this.platform === 'darwin'
      && supportsNativeCapability(inventory, 'list_windows', 'window.candidates.positive.v1');
    this.windowLayoutBounds = this.platform === 'darwin'
      && supportsNativeCapability(inventory, 'list_windows', 'window.layout_bounds.v1');
    this.exactWindowMetadata = this.platform === 'darwin'
      && supportsNativeCapability(inventory, 'list_windows', 'window.metadata.exact.v1');
    this.windowProcessIdentity = this.platform === 'darwin'
      && supportsNativeCapability(inventory, 'list_windows', 'window.process_identity.v1');
    this.readinessNotifications = this.platform === 'darwin'
      && supportsNativeCapability(inventory, 'list_windows', 'window.readiness.notifications.v1');
    this.kernelProcessIdentity = this.platform === 'darwin'
      && supportsNativeCapability(inventory, 'list_apps', 'process.identity.kernel.v1');
    this.setupStage = 'PERMISSIONS';
    const permissions = await this.callUntyped('check_permissions', {});
    this.assertGeneration(generation);
    const source = permissions.data.source as Record<string, unknown> | undefined;
    if (this.platform === 'win32' ? permissions.data.uia !== true
      : !permissions.data.accessibility || !permissions.data.screen_recording || source?.attribution !== 'host') {
      throw new Error('COMPUTER_OS_PERMISSION_REQUIRED');
    }
  }
  private async callUntyped(name: string, args: Record<string, unknown>, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (!this.client) throw new Error('COMPUTER_DRIVER_OFFLINE');
    const result: ToolResult = await this.timedSdk(() => this.client!.callTool(name, JSON.stringify(args), signal ? { signal } : undefined));
    return this.validateInputResult(() => {
      signal?.throwIfAborted();
      if (result.isError) throw computerNativeInputError(result, `COMPUTER_DRIVER_${name.toUpperCase()}_REFUSED`);
      let data: Record<string, unknown>;
      try { data = JSON.parse(result.structuredJson ?? result.rawJson ?? '{}') as Record<string, unknown>; }
      catch { throw new Error('COMPUTER_DRIVER_INVALID_RESULT'); }
      const content = result.images.map(image => ({ type: 'image', data: image.dataBase64, mimeType: image.mimeType }));
      return { data, content };
    });
  }
  private async listApps(signal?: AbortSignal, query?: string, runningOnly = false): Promise<AppInfo[]> {
    signal?.throwIfAborted();
    if (!this.client) throw new Error('COMPUTER_DRIVER_OFFLINE');
    if (runningOnly && this.runningAppsOnly) {
      const result = await this.measurePreparation('appCatalog', () => this.callUntyped('list_apps', { running_only: true }, signal));
      const data = z.object({ apps: z.array(z.object({ pid: z.number().int().positive(), name: z.string(),
        running: z.literal(true), active: z.boolean(), bundle_id: z.string().optional(), launch_path: z.string().optional(),
        kind: z.string().optional(), last_used: z.string().optional() })) }).parse(result.data);
      return data.apps.map(item => ({ pid: item.pid, name: item.name, running: true, active: item.active,
        bundleId: item.bundle_id, launchPath: item.launch_path, kind: item.kind, lastUsed: item.last_used }));
    }
    const result = await this.measurePreparation('appCatalog', () => this.client!.listApps({}, signal ? { signal } : undefined));
    signal?.throwIfAborted();
    if (this.platform !== 'win32') return result.apps;
    const apps: AppInfo[] = [];
    for (let app of result.apps) {
      if (!app.bundleId && app.pid > 0 && !/^ApplicationFrameHost\.exe$/i.test(app.name)
        && (query != null && app.name.toLocaleLowerCase().includes(query.normalize('NFKC').toLocaleLowerCase())
          || [...this.windowsApps.values()].some(known => known.pid === app.pid))) {
        const native = await readWindowsComputerIdentity(app.pid, undefined, signal).catch(() => undefined);
        signal?.throwIfAborted();
        if (native) app = { ...app, bundleId: native.executable };
      }
      const identity = windowsAppIdentity(app);
      if (!identity) continue;
      try { assertWindowsAppAllowed(app); } catch { continue; }
      this.windowsApps.set(identity.appId, app);
      apps.push({ ...app, bundleId: identity.appId });
    }
    // Older UWP apps share ApplicationFrameHost. Never authorize all its windows
    // merely because one packaged application belongs to that process.
    const packaged = [...this.windowsApps.entries()].filter(([, app]) => windowsAppIdentity(app)?.packaged);
    for (const host of result.apps.filter(app => app.pid > 0 && /^ApplicationFrameHost\.exe$/i.test(app.name))) {
      for (const window of await this.listWindows(host.pid, signal)) {
        const identity = await readWindowsComputerIdentity(host.pid, window.windowId.toString(), signal).catch(() => undefined);
        signal?.throwIfAborted();
        if (!identity) continue;
        for (const [appId, app] of packaged) if (windowsAppMatches(app, identity)) {
          apps.push({ ...app, bundleId: appId, pid: host.pid, running: true, active: host.active });
        }
      }
    }
    return apps.filter((app, i) => !apps.slice(0, i).some(other => other.bundleId === app.bundleId && other.pid === app.pid));
  }
  private async listWindows(pid: number, signal?: AbortSignal, windowId?: bigint): Promise<NativeWindowCandidate[]> {
    signal?.throwIfAborted();
    if (!this.client) throw new Error('COMPUTER_DRIVER_OFFLINE');
    const pulse = this.preparationPulse; const notificationVersion = pulse?.version;
    const boundIdentity = this.preparingSince !== undefined && this.windowProcessIdentity ? this.preparationIdentity : undefined;
    if (boundIdentity || (this.inputWindowCandidates && this.preparingSince !== undefined) || (this.exactWindowMetadata && windowId !== undefined)) {
      const result = await this.measurePreparation('windowMetadata', () => this.callUntyped('list_windows', { pid, ...(boundIdentity ? { include_process_identity: true } : {}), ...(this.inputWindowCandidates ? { input_candidates: true } : {}), ...(this.windowLayoutBounds && this.preparingSince !== undefined ? { include_layout_bounds: true } : {}),
        ...(this.exactWindowMetadata && windowId !== undefined ? { window_id: this.jsonWindowId(windowId) } : {}) }, signal));
      signal?.throwIfAborted();
      if (notificationVersion !== undefined && pulse!.acknowledge(notificationVersion) && this.preparationTiming) this.preparationTiming.coveredWorkspaceHints++;
      if (boundIdentity && decodeNativeProcessIdentity(result.data.process_identity, pid) !== boundIdentity) throw new Error('COMPUTER_PROCESS_CHANGED');
      if (this.preparationTiming && this.preparingSince !== undefined && result.data.metadata_timing && this.preparationTiming.metadataSamples.length < 128) {
        this.preparationTiming.metadataSamples.push({ atMs: performance.now() - this.preparationClock, native: result.data.metadata_timing as Record<string, unknown> });
      }
      return this.noteReadinessWindows(decodeNativeWindowCandidates(result.data, pid), pid);
    }
    const result = await this.measurePreparation('windowMetadata', () => this.client!.listWindows({ pid }, signal ? { signal } : undefined));
    signal?.throwIfAborted();
    if (notificationVersion !== undefined && pulse!.acknowledge(notificationVersion) && this.preparationTiming) this.preparationTiming.coveredWorkspaceHints++;
    return this.noteReadinessWindows(result.windows.filter(window => window.pid === pid), pid);
  }
  private noteReadinessWindows<T extends NativeWindowCandidate>(windows: T[], pid: number): T[] {
    if (this.preparingSince !== undefined) this.readinessWindowKey = `${pid}:${windows.map(w => String(w.windowId)).sort().join(',')}`;
    return windows;
  }
  private async getWindowState(pid: number, windowId: bigint, options: {
    includeScreenshot?: boolean;
    maxElements?: number;
    maxDepth?: number;
    maxDimension?: number;
  }, signal?: AbortSignal): Promise<WindowStateOutput> {
    signal?.throwIfAborted();
    if (!this.client) throw new Error('COMPUTER_DRIVER_OFFLINE');
    const result = await this.measurePreparation(options.includeScreenshot ? 'capture' : 'windowProbe', () => this.client!.getWindowState({ pid, windowId, includeAccessibilityTree: true, treeFormat: 'both', ...options }, signal ? { signal } : undefined));
    signal?.throwIfAborted();
    return result;
  }
  private jsonWindowId(windowId: bigint): number {
    const value = Number(windowId);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('COMPUTER_WINDOW_ID_UNSUPPORTED');
    return value;
  }
  private async processIdentity(pid: number): Promise<string> {
    return this.measurePreparation('processIdentity', async () => {
      if (this.platform === 'win32') return (await readWindowsComputerIdentity(pid)).processIdentity;
      if (this.kernelProcessIdentity) {
        let result: Awaited<ReturnType<CuaComputerDriver['callUntyped']>>;
        try { result = await this.callUntyped('list_apps', { process_identity_pid: pid }); }
        catch { throw new Error('COMPUTER_PROCESS_CHANGED'); }
        return decodeNativeProcessIdentity(result.data.process_identity, pid);
      }
      const { stdout } = await exec('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { timeout: 2000 });
      if (!stdout.trim()) throw new Error('COMPUTER_PROCESS_EXITED');
      return `${pid}:${stdout.trim()}`;
    });
  }
  private async assertWindowApp(target: Pick<ComputerTarget, 'appId' | 'pid' | 'windowId'> & Partial<Pick<ComputerTarget, 'processIdentity'>>, signal: AbortSignal, includeInput = false) {
    if (this.platform !== 'win32') return;
    const app = this.windowsApps.get(target.appId);
    const native = await readWindowsComputerIdentity(target.pid, target.windowId, signal, includeInput).catch(async error => {
      signal.throwIfAborted();
      if (!includeInput) throw error;
      // Input metadata is optional for observation; identity is never optional.
      return readWindowsComputerIdentity(target.pid, target.windowId, signal);
    });
    if (!app || !windowsAppMatches(app, native)) throw new Error('COMPUTER_WINDOW_APP_CHANGED');
    if (target.processIdentity && native.processIdentity !== target.processIdentity) throw new Error('COMPUTER_PROCESS_CHANGED');
    return native;
  }
  private async appWindows(pid: number, appId: string, signal: AbortSignal, windowId?: bigint): Promise<NativeWindowCandidate[]> {
    const windows = await this.listWindows(pid, signal, windowId);
    if (this.platform !== 'win32') return windows;
    const allowed: WindowInfo[] = [];
    for (const window of windows) {
      try { await this.assertWindowApp({ pid, appId, windowId: window.windowId.toString() }, signal); allowed.push(window); }
      catch { signal.throwIfAborted(); }
    }
    return allowed;
  }
  private assertAppAllowed(appId: string): void {
    if (this.platform === 'win32') {
      const app = this.windowsApps.get(appId);
      if (!app) throw new Error('COMPUTER_APP_NOT_FOUND');
      assertWindowsAppAllowed(app);
      return;
    }
    if (appId === this.bundleId || appId === 'ai.xopc.xopc' || appId === 'com.github.Electron') throw new Error('COMPUTER_SELF_CONTROL_DENIED');
    if (DENIED_APPS.test(appId)) throw new Error('COMPUTER_SENSITIVE_APP_MANUAL_ONLY');
  }
  async discover(query: string, signal: AbortSignal) {
    await this.start(); signal.throwIfAborted();
    const rows = await this.listApps(signal, query);
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
    this.preparedFrame = undefined;
    this.assertAppAllowed(appId);
    await this.start(); signal.throwIfAborted();
    if (!options.prepare) return this.resolveWindow(appId, signal, options);
    this.preparingSince = Date.now();
    const preparationStarted = performance.now();
    this.preparationClock = preparationStarted;
    const stages = () => ({ appCatalog: 0, processIdentity: 0, windowMetadata: 0, windowProbe: 0, capture: 0, pollWait: 0 });
    this.preparationTiming = { wallMs: 0, hostFocusMs: 0, systemOpenMs: 0, reusedPreparedFrame: false, reusedPendingCapture: false, otherMs: 0,
      stagesMs: stages(), calls: stages(), coveredWorkspaceHints: 0, observerCleanupMs: 0, metadataSamples: [], readinessSamples: [], captureAttempts: [] };
    const pulse = new ReadinessPulse(); this.preparationPulse = pulse;
    const subscriptions: number[] = [];
    let workspace: typeof import('electron').systemPreferences | undefined;
    if (this.readinessNotifications) {
      workspace = (await import('electron')).systemPreferences;
      try {
        for (const event of ['NSWorkspaceDidLaunchApplicationNotification', 'NSWorkspaceDidActivateApplicationNotification', 'NSWorkspaceActiveSpaceDidChangeNotification']) {
          subscriptions.push(workspace.subscribeWorkspaceNotification(event, () => pulse.notify()));
        }
      } catch { for (const id of subscriptions.splice(0)) workspace.unsubscribeWorkspaceNotification(id); }
    }
    try {
      return await withWindowReadiness(signal, (readySignal, poll) => this.resolveWindow(appId, readySignal, options, poll), ms => {
        this.preparationTiming!.stagesMs.pollWait += ms; this.preparationTiming!.calls.pollWait++;
      }, this.readinessNotifications ? async (waitSignal, cadence) => {
        if (!this.readinessPid) { await pulse.wait(waitSignal, subscriptions.length ? 128 : cadence); return; }
        // A newly launched process may not have an AX service until it publishes
        // a window. Workspace notifications cover launch; bounded fallback covers
        // apps without a window-created notification, without premature AX probes.
        if (this.readinessNewProcess && this.readinessWindowKey === `${this.readinessPid}:`) {
          this.preparationSample('wake_waiting_window'); await pulse.wait(waitSignal, cadence); return;
        }
        if (this.unavailableReadinessKey && this.unavailableReadinessKey === this.readinessWindowKey) {
          this.preparationSample('wake_subscription_unavailable');
          await pulse.wait(waitSignal, cadence); return;
        }
        const result = await this.callUntyped('list_windows', { pid: this.readinessPid, readiness_wait_ms: cadence }, waitSignal);
        this.preparationSample(`wake_${result.data.readiness_wake}`);
        if (result.data.readiness_wake === 'unsupported') { this.unavailableReadinessKey = this.readinessWindowKey; await pulse.wait(waitSignal, cadence); }
        else if (!['notification', 'watchdog'].includes(String(result.data.readiness_wake))) throw new Error('COMPUTER_DRIVER_INVALID_RESULT');
      } : undefined);
    } finally {
      for (const id of subscriptions) workspace!.unsubscribeWorkspaceNotification(id);
      if (this.readinessNotifications && this.readinessPid && this.client) {
        const cleanupStarted = performance.now();
        await cleanupDeadline(() => this.callUntyped('list_windows', { pid: this.readinessPid, readiness_end: true }).then(result => {
          if (typeof result.data.readiness_cleanup_complete === 'boolean') this.preparationTiming!.observerCleanupComplete = result.data.readiness_cleanup_complete;
        }), 128).catch(() => {});
        this.preparationTiming!.observerCleanupMs = performance.now() - cleanupStarted;
      }
      this.preparationPulse = undefined;
      this.preparationIdentity = undefined;
      this.readinessNewProcess = false;
      this.readinessPid = undefined; this.readinessWindowKey = undefined; this.unavailableReadinessKey = undefined;
      this.preparingSince = undefined; const timing = this.preparationTiming;
      timing.wallMs = performance.now() - preparationStarted;
      timing.otherMs = Math.max(0, timing.wallMs - timing.hostFocusMs - timing.systemOpenMs - timing.observerCleanupMs
        - Object.values(timing.stagesMs).reduce((sum, value) => sum + value, 0));
    }
  }
  private async resolveWindow(appId: string, signal: AbortSignal, options: { prepare: boolean; windowRef?: string },
    poll?: <T>(sample: () => Promise<T | undefined>, options?: { intervalMs?: number }) => Promise<T>): Promise<ComputerTarget> {
    let prepared = false;
    let activated = false;
    let rows = await this.listApps(signal, undefined, true);
    const hostPreparation = options.prepare && this.foregroundAppPreparation;
    if (!rows.some(app => app.bundleId === appId) && this.runningAppsOnly && !hostPreparation) rows = await this.listApps(signal);
    if (!rows.some(app => app.bundleId === appId) && !hostPreparation) throw new Error('COMPUTER_APP_NOT_FOUND');
    if (options.prepare && !rows.some(app => app.bundleId === appId && app.pid > 0)) {
      this.readinessNewProcess = true;
      // Never accept URLs, argv, debug ports or a model-supplied launch path.
      const launch = this.platform === 'win32' ? windowsAppIdentity(this.windowsApps.get(appId)!)!.launch : { bundle_id: appId };
      if (hostPreparation) await this.prepareApplication(appId, signal);
      else await this.callUntyped('launch_app', launch, signal);
      prepared = true;
      activated = hostPreparation;
      rows = await poll!(async () => {
        const next = await this.listApps(signal, undefined, true);
        const found = next.some(app => app.bundleId === appId && app.pid > 0);
        this.preparationSample(found ? 'process_ready' : 'waiting_process');
        return found ? next : undefined;
      }, { intervalMs: 32 });
    }
    let matches = rows.filter(app => app.bundleId === appId && app.pid > 0);
    if (!matches.length) throw new Error('COMPUTER_APP_NOT_RUNNING');
    if (matches.length !== 1) throw new Error('COMPUTER_APP_INSTANCE_AMBIGUOUS');
    const pid = matches[0].pid;
    this.readinessPid = pid;
    const processIdentity = await this.processIdentity(pid);
    if (this.preparingSince !== undefined) this.preparationIdentity = processIdentity;
    let windows = await this.appWindows(pid, appId, signal);
    const checkProcess = async () => {
      signal.throwIfAborted();
      if (await this.processIdentity(pid) !== processIdentity) throw new Error('COMPUTER_PROCESS_CHANGED');
    };
    const checkedWindows = async (windowId?: bigint) => {
      if (!this.windowProcessIdentity || this.preparingSince === undefined) await checkProcess();
      return this.appWindows(pid, appId, signal, windowId);
    };
    if (options.prepare && !options.windowRef && !windows.length) {
      if (!prepared) {
        await checkProcess();
        if (hostPreparation) await this.prepareApplication(appId, signal);
        else await this.callUntyped('bring_to_front', { pid }, signal);
        activated = true;
        prepared = true;
      }
      windows = await poll!(async () => {
        const next = await checkedWindows();
        const found = next.some(window => Bounds.safeParse(window.bounds).success);
        this.preparationSample(found ? 'window_published' : 'waiting_window');
        return found ? next : undefined;
      }, { intervalMs: 32 });
    }
    if (hostPreparation && prepared && !windows.some(window => Bounds.safeParse(window.bounds).success)) {
      windows = await poll!(async () => {
        const next = await checkedWindows();
        return next.some(window => Bounds.safeParse(window.bounds).success) ? next : undefined;
      }, { intervalMs: 32 });
    }
    // A hidden app can publish many proxy surfaces before its main window is restored.
    // Preparation authorizes app activation, but not a guessed window or screenshot.
    if (options.prepare && !hostPreparation && !this.canFollowWorkspace() && !options.windowRef && windows.length > 1 && windows.every(window => !window.isOnScreen)) {
      if (windows.every(window => window.onCurrentSpace === false)) throw new Error('COMPUTER_WINDOW_OTHER_SPACE');
      if (await this.processIdentity(pid) !== processIdentity) throw new Error('COMPUTER_PROCESS_CHANGED');
      if (!activated) {
        await this.callUntyped('bring_to_front', { pid }, signal);
        activated = true;
      }
      prepared = true;
      matches = (await this.listApps(signal, undefined, true)).filter(app => app.bundleId === appId && app.pid > 0);
      if (matches.length !== 1 || matches[0].pid !== pid || await this.processIdentity(pid) !== processIdentity) throw new Error('COMPUTER_PROCESS_CHANGED');
      const originalIds = new Set(windows.map(window => window.windowId));
      windows = await poll!(async () => {
        const next = (await checkedWindows()).filter(window => originalIds.has(window.windowId));
        if (!next.length) throw new Error('COMPUTER_WINDOW_CHANGED');
        if (next.every(window => window.onCurrentSpace === false)) throw new Error('COMPUTER_WINDOW_OTHER_SPACE');
        return next.some(window => window.isOnScreen) ? next : undefined;
      });
    }
    const ref = (window: typeof windows[number]) => hash(`${this.referenceSalt}:${appId}:${processIdentity}:${window.windowId}`);
    const candidates = windows.slice(0, 100).map(window => ({ windowRef: ref(window), title: (window.title || 'Untitled window').slice(0, 300), visible: window.isOnScreen }));
    // Probe roots and the first control only to exclude system sharing
    // accessories on drivers without layer metadata. Never capture pixels or
    // expose child content from these selection probes.
    // WindowServer accessory surfaces (including sharing controls) can expose
    // AXWindow roots and rank above the document. Require an explicit choice
    // for nonstandard layers instead of silently steering input into them.
    let selectable = windows.filter(window => window.layer === undefined || window.layer === 0);
    if (this.platform !== 'win32' && !options.windowRef && selectable.length > 1) {
      if (selectable.length > 12 && selectable.some(window => window.isOnScreen)) selectable = selectable.filter(window => window.isOnScreen);
      if (selectable.length > 12) throw new ComputerTargetError('COMPUTER_WINDOW_AMBIGUOUS', candidates);
      const checks = await Promise.all(selectable.map(async window => {
        try {
          const state = await this.getWindowState(pid, window.windowId, { includeScreenshot: false, maxElements: 2, maxDepth: 2 },
            AbortSignal.any([signal, AbortSignal.timeout(2000)]));
          if (state.pid !== pid || state.windowId !== window.windowId || !Array.isArray(state.elements)) return undefined;
          if (state.elements.some(element => element.role === 'AXButton' && element.label === 'WindowSharingSessionButton')) return false;
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
      // Multiple documents require an explicit snapshot-scoped selection. Stacking
      // order cannot establish which document the user's task authorized.
    }
    if (!window && windows.length > 1) throw new ComputerTargetError('COMPUTER_WINDOW_AMBIGUOUS', candidates);
    if (window?.onCurrentSpace === false && this.canFollowWorkspace()) {
      window = await this.revealWorkspaceWindow({ appId, pid, processIdentity, windowId: window.windowId.toString(),
        width: Math.round(window.bounds.width), height: Math.round(window.bounds.height), geometryRevision: hash(JSON.stringify(window.bounds)) }, signal);
    }
    if (hostPreparation && window && (!window.isOnScreen || window.onCurrentSpace === false)) {
      // The application may have published an accessory before its document.
      // Select the exact window first; preparation never follows a replacement.
      if (!activated) {
        await checkProcess();
        await this.prepareApplication(appId, signal);
        await checkProcess();
      }
      activated = true;
      prepared = true;
    }
    if (window?.onCurrentSpace === false && !hostPreparation) throw new ComputerTargetError('COMPUTER_WINDOW_OTHER_SPACE', candidates);
    // Background delivery needs a visible window, not foreground focus. Avoid
    // unnecessary activation, which can steal focus or be refused by the OS.
    if (window && options.prepare && !window.isOnScreen && !activated) {
      signal.throwIfAborted();
      if (await this.processIdentity(pid) !== processIdentity) throw new Error('COMPUTER_PROCESS_CHANGED');
      await this.callUntyped('bring_to_front', { pid, window_id: this.jsonWindowId(window.windowId) }, signal);
      activated = true;
      prepared = true;
    }
    if (window && prepared) {
      const windowId = window.windowId;
      // Window publication/selection already sampled this exact surface once.
      // Count that sample instead of discarding it and waiting another interval.
      let previousBounds = window.isOnScreen && window.onCurrentSpace !== false && Bounds.safeParse(window.bounds).success
        ? JSON.stringify(window.bounds) : undefined;
      let pendingCapture: { state: WindowStateOutput; capturedAt: number } | undefined;
      window = await poll!(async () => {
        const current = (await checkedWindows(windowId)).find(item => item.windowId === windowId);
        if (!current) throw new Error('COMPUTER_WINDOW_CHANGED');
        if (current.onCurrentSpace === false) {
          if (hostPreparation) { previousBounds = undefined; this.preparationSample('other_space'); return; }
          throw new Error('COMPUTER_WINDOW_OTHER_SPACE');
        }
        const bounds = Bounds.safeParse(current.bounds);
        if (!current.isOnScreen || !bounds.success) { previousBounds = undefined; this.preparationSample('not_visible'); return; }
        const fingerprint = JSON.stringify(bounds.data);
        // Logical layout and composited geometry diverge during launch/restore
        // animation, even when consecutive compositor samples briefly match.
        if (current.layoutBounds && JSON.stringify(current.layoutBounds) !== fingerprint) {
          previousBounds = undefined; this.preparationSample('layout_pending'); return;
        }
        const stable = fingerprint === previousBounds;
        previousBounds = fingerprint;
        if (!stable) { this.preparationSample('geometry_changed'); return; }
        this.preparationSample('geometry_stable');
        const reusable = pendingCapture && performance.now() - pendingCapture.capturedAt < 250
          && JSON.stringify(pendingCapture.state.windowBounds) === fingerprint;
        const captureStarted = performance.now();
        let state: WindowStateOutput;
        let capturedAt: number;
        if (reusable) {
          state = pendingCapture!.state; capturedAt = pendingCapture!.capturedAt;
          this.preparationTiming!.reusedPendingCapture = true;
          this.preparationSample('capture_reused_after_bounds');
          this.captureStats.recovered++;
        } else {
          if (pendingCapture) pendingCapture.state.images.length = 0;
          pendingCapture = undefined;
          this.captureStats.attempts++;
          state = await this.getWindowState(pid, windowId, { includeScreenshot: true, maxElements: 180, maxDepth: 12, maxDimension: 1600 }, signal);
          capturedAt = performance.now();
        }
        if (state.pid !== pid || state.windowId !== windowId) throw new Error('COMPUTER_CAPTURE_TARGET_MISMATCH');
        if (state.elements?.some(element => element.role === 'AXButton' && element.label === 'WindowSharingSessionButton')) throw new Error('COMPUTER_WINDOW_CHANGED');
        const capturedBounds = Bounds.safeParse(state.windowBounds);
        const valid = hasWindowFrame(state) && capturedBounds.success && JSON.stringify(capturedBounds.data) === fingerprint;
        if (!reusable && this.preparationTiming && this.preparationTiming.captureAttempts.length < 32) this.preparationTiming.captureAttempts.push({
          atMs: performance.now() - this.preparationClock, durationMs: performance.now() - captureStarted,
          reason: !hasWindowFrame(state) ? 'frame_unavailable' : !capturedBounds.success ? 'bounds_unavailable' : !valid ? 'bounds_changed' : 'ready',
          expectedBounds: bounds.data, capturedBounds: capturedBounds.success ? capturedBounds.data : undefined,
          width: state.screenshotWidth, height: state.screenshotHeight, frameValid: state.screenshotFrameValid, imageCount: state.images.length,
        });
        this.preparationSample(valid ? 'ready' : 'capture_invalid');
        if (valid) this.preparedFrame = { appId, pid, windowId, processIdentity, capturedAt, state };
        else {
          this.captureStats.invalidFrames++;
          // A native-valid frame with different geometry may become the next
          // stable sample. Recheck metadata without repeating AX/pixel capture.
          if (hasWindowFrame(state)) pendingCapture = { state, capturedAt };
          else state.images.length = 0;
        }
        return valid ? current : undefined;
      }, { intervalMs: 16 });
    }
    if (!window?.isOnScreen) throw new ComputerTargetError(window ? 'COMPUTER_WINDOW_HIDDEN' : 'COMPUTER_WINDOW_REQUIRED', candidates);
    if (await this.processIdentity(pid) !== processIdentity) throw new Error('COMPUTER_PROCESS_CHANGED');
    return { appId, pid, processIdentity, windowId: window.windowId.toString(), width: Math.round(window.bounds.width), height: Math.round(window.bounds.height), geometryRevision: hash(JSON.stringify(window.bounds)) };
  }
  private canFollowWorkspace(): boolean { return this.platform === 'darwin' && this.followsActiveSpace(); }
  private async revealWorkspaceWindow(target: ComputerTarget, signal: AbortSignal) {
    signal.throwIfAborted();
    if (!this.canFollowWorkspace()) throw new Error('COMPUTER_WINDOW_OTHER_SPACE');
    await this.validatePreviewTarget(target, signal);
    // Space switching must be attributed to the visible Electron host. The
    // background actuator's strict foreground-focus request can be refused even
    // though host activation succeeds. Capture needs this exact window visible,
    // not foreground keyboard focus. Reject any process/window replacement.
    await this.prepareApplication(target.appId, signal);
    await this.validatePreviewTarget(target, signal);
    return withWindowReadiness(signal, (readySignal, poll) => poll(async () => {
      readySignal.throwIfAborted();
      if (!this.canFollowWorkspace()) throw new Error('COMPUTER_LOCAL_UI_REQUIRED');
      if (await this.processIdentity(target.pid) !== target.processIdentity) throw new Error('COMPUTER_PROCESS_CHANGED');
      const windows = await this.appWindows(target.pid, target.appId, readySignal, BigInt(target.windowId));
      const current = windows.find(window => window.windowId.toString() === target.windowId);
      if (!current || current.pid !== target.pid) throw new Error('COMPUTER_WINDOW_CHANGED');
      return current.onCurrentSpace !== false && current.isOnScreen ? current : undefined;
    }, { intervalMs: 100 }));
  }
  private async prepareApplication(appId: string, signal: AbortSignal): Promise<void> {
    if (!/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/.test(appId)) throw new Error('COMPUTER_APP_ID_INVALID');
    signal.throwIfAborted();
    // LaunchServices attributes activation to the visible host, not its
    // background actuator. Closed argv; no shell, path, URL or app arguments.
    try {
      const focusStarted = performance.now();
      const { app } = await import('electron');
      app.focus({ steal: true });
      if (this.preparingSince !== undefined && this.preparationTiming) this.preparationTiming.hostFocusMs += performance.now() - focusStarted;
      const openStarted = performance.now();
      await exec('/usr/bin/open', ['-b', appId], { signal, timeout: 5000 });
      if (this.preparingSince !== undefined && this.preparationTiming) this.preparationTiming.systemOpenMs += performance.now() - openStarted;
    }
    catch { signal.throwIfAborted(); throw new Error('COMPUTER_APP_PREPARATION_REFUSED'); }
    signal.throwIfAborted();
  }
  async observe(target: ComputerTarget, signal: AbortSignal): Promise<DriverObservation> {
    const prepared = this.preparedFrame; this.preparedFrame = undefined;
    this.elements = []; this.frame = undefined; this.observedTarget = undefined; this.windowsInput = undefined;
    if (this.platform === 'win32') await this.assertWindowApp(target, signal);
    const windowId = BigInt(target.windowId);
    let state: WindowStateOutput;
    const recoveryDelays = [100, 300, 900];
    let recoveryBounds: string | undefined;
    let workspaceRecovered = false;
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      if (this.platform === 'win32') {
        if (attempt > 0) await this.assertWindowApp(target, signal);
      } else if (await this.processIdentity(target.pid) !== target.processIdentity) throw new Error('COMPUTER_PROCESS_CHANGED');
      let reusable = attempt === 0 && prepared?.appId === target.appId && prepared.pid === target.pid && prepared.windowId === windowId
        && prepared.processIdentity === target.processIdentity && performance.now() - prepared.capturedAt < 250;
      if (reusable) {
        const current = (await this.appWindows(target.pid, target.appId, signal, windowId)).find(window => window.windowId === windowId);
        reusable = !!current?.isOnScreen && current.onCurrentSpace !== false
          && JSON.stringify(current.bounds) === JSON.stringify(prepared!.state.windowBounds)
          && performance.now() - prepared!.capturedAt < 250;
      }
      if (reusable) {
        state = prepared!.state;
        if (this.preparationTiming) this.preparationTiming.reusedPreparedFrame = true;
      } else {
        this.captureStats.attempts++;
        state = await this.getWindowState(target.pid, windowId, { includeScreenshot: true, maxElements: 180, maxDepth: 12, maxDimension: 1600 }, signal);
      }
      signal.throwIfAborted();
      // A resize/render transition can invalidate the optional pixel frame while
      // retaining the exact AX window. Re-capture only that window; never accept
      // invalid pixels, follow another window or replay the preceding input.
      if (state.pid !== target.pid || state.windowId !== windowId) break;
      if (state.elements?.some(element => element.role === 'AXButton' && element.label === 'WindowSharingSessionButton')) throw new Error('COMPUTER_WINDOW_CHANGED');
      const parsedBounds = Bounds.safeParse(state.windowBounds);
      const captureBounds = parsedBounds.success ? parsedBounds.data : undefined;
      if (recoveryBounds && captureBounds && JSON.stringify(captureBounds) !== recoveryBounds) throw new Error('COMPUTER_UI_UNSTABLE');
      if (hasWindowFrame(state)) {
        if (attempt) this.captureStats.recovered++;
        break;
      }
      this.captureStats.invalidFrames++;
      if (attempt >= recoveryDelays.length) { this.captureStats.exhausted++; break; }
      state.images.length = 0;
      // Only retry capture while the exact native window still exists and has
      // stable native geometry, matching AX bounds when available. Never recover a process/window/geometry change.
      const windows = await this.listWindows(target.pid, signal);
      const current = windows.find(window => window.windowId === windowId);
      if (!current) throw new Error('COMPUTER_WINDOW_CHANGED');
      if (current.onCurrentSpace === false) {
        if (!workspaceRecovered && this.canFollowWorkspace()) {
          await this.revealWorkspaceWindow(target, signal);
          workspaceRecovered = true; recoveryBounds = undefined;
          continue;
        }
        throw new Error('COMPUTER_WINDOW_OTHER_SPACE');
      }
      if (!current.isOnScreen) throw new Error('COMPUTER_WINDOW_HIDDEN');
      const nativeBounds = JSON.stringify(Bounds.parse(current.bounds));
      if ((captureBounds && nativeBounds !== JSON.stringify(captureBounds))
        || (recoveryBounds && nativeBounds !== recoveryBounds)) throw new Error('COMPUTER_UI_UNSTABLE');
      recoveryBounds = nativeBounds;
      await delay(recoveryDelays[attempt], undefined, { signal });
    }
    if (state.elements?.some(element => element.role === 'AXButton' && element.label === 'WindowSharingSessionButton')) throw new Error('COMPUTER_WINDOW_CHANGED');
    // Some platforms cannot produce an affirmative frame-validity bit. An explicit
    // negative is fatal; exact pid/window identity and the image envelope remain required.
    if (state.pid !== target.pid || state.windowId !== windowId) {
      log.warn({ phase: 'capture', expectedPid: target.pid, actualPid: state.pid, expectedWindowId: String(windowId),
        actualWindowId: String(state.windowId), frameValid: state.screenshotFrameValid, degraded: state.degraded,
        imageCount: state.images?.length, width: state.screenshotWidth, height: state.screenshotHeight }, 'Native window capture rejected');
      throw new Error('COMPUTER_CAPTURE_TARGET_MISMATCH');
    }
    if (!hasWindowFrame(state)) throw new Error('COMPUTER_CAPTURE_UNAVAILABLE');
    const inputIdentity = await this.assertWindowApp(target, signal, true);
    this.windowsInput = inputIdentity?.input;
    const bounds = Bounds.parse(state.windowBounds);
    const screenshot = state.images[0];
    if (!screenshot?.dataBase64 || !['image/png', 'image/jpeg'].includes(screenshot.mimeType) || screenshot.dataBase64.length > 7 * 1024 * 1024) throw new Error('COMPUTER_CAPTURE_UNAVAILABLE');
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
    const scoped = this.platform === 'win32' ? normalizeWindowsAccessibility(enrichWindowsInput(normalizedElements, this.windowsInput), state.treeMarkdown)
      : scopeWindowAccessibility({ elements: normalizedElements, tree_markdown: state.treeMarkdown });
    const { elements } = scoped;
    const text = this.platform === 'win32'
      ? `Windows x64. Native text insertion appends to a field with inputAllowed=true; explicit field-value replacement replaces it if your tool schema supports that action. Keyboard input requires keyboardFocused=true in this window. Use ctrl rather than cmd. Secure or unverified fields require manual input. Background delivery may refuse unsupported actions.\n${scoped.text}`
      : scoped.text;
    this.frame = { bounds, width, height };
    const stableElements = elements.map(({ element_token: _token, ...item }) => item);
    const publicElements = elements.map(element => {
      const { element_token: _token, windows_runtime_id: _runtimeId, windows_focus_id: _focusId, ...item } = element;
      const frame = item.frame as { x: number; y: number; w: number; h: number } | undefined;
      const validFrame = frame && [frame.x, frame.y, frame.w, frame.h].every(Number.isFinite) && frame.w > 0 && frame.h > 0;
      return { ...item, semanticActions: semanticActions(element), ...(validFrame ? { bounds: {
        x: (frame.x - bounds.x) * width / bounds.width,
        y: (frame.y - bounds.y) * height / bounds.height,
        width: frame.w * width / bounds.width, height: frame.h * height / bounds.height,
      } } : {}) };
    });
    const summary = summarizeWindowAccessibility(publicElements, text, scoped.truncated === true || state.truncated === true || state.elementsComplete === false, this.platform === 'win32' ? 'win32' : undefined);
    const exposed = new Set(JSON.parse(summary).elements.map((item: { ref: string }) => item.ref));
    this.elements = elements.filter(item => exposed.has(`e${item.element_index}`));
    this.observedTarget = { ...target };
    const focused = this.elements.filter(item => item.keyboardFocused === true && item.inputAllowed === true);
    return { target: { ...target, width: Math.round(bounds.width), height: Math.round(bounds.height), geometryRevision: hash(JSON.stringify(bounds)) },
      summary, ...(this.platform === 'win32' && focused.length === 1 ? { focusedEditableRef: `e${focused[0].element_index}` } : {}),
      // Do not include per-snapshot tokens in the digest; compare visible content + geometry.
      stateDigest: hash(JSON.stringify({ elements: stableElements, bounds, width, height }) + hash(image)),
      image, mimeType: screenshot.mimeType as 'image/png' | 'image/jpeg', imageWidth: width, imageHeight: height };
  }
  private semanticElement(action: Extract<ComputerAction, { kind: 'activate' | 'showMenu' }>) {
    const matches = this.elements.filter(item => action.ref === `e${item.element_index}`);
    if (matches.length !== 1 || typeof matches[0].element_token !== 'string' || !matches[0].element_token) throw new Error('COMPUTER_ELEMENT_REF_REQUIRED');
    if (!semanticActions(matches[0]).includes(action.kind)) throw new Error('COMPUTER_SEMANTIC_ACTION_UNSUPPORTED');
    return matches[0];
  }
  private editable(action: Extract<ComputerAction, { kind: 'typeText' | 'setValue' }>) {
    const frame = this.frame;
    const candidates = this.elements.filter(item => {
      if (!['AXTextField', 'AXTextArea'].includes(String(item.role)) || item.enabled === false) return false;
      if (this.platform === 'win32' && item.inputAllowed !== true) return false;
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
    if (action.kind === 'batch') {
      for (const input of action.actions) this.validateAction(input);
    }
    if (action.kind === 'activateSequence') {
      for (const ref of action.refs) {
        const element = this.semanticElement({ kind: 'activate', ref });
        if (element.role !== 'AXButton' || element.in_web_content === true) throw new Error('COMPUTER_SEMANTIC_ACTION_UNSUPPORTED');
      }
    }
    if (action.kind === 'activate' || action.kind === 'showMenu') this.semanticElement(action);
    if (action.kind === 'typeText' || action.kind === 'setValue') this.editable(action);
    if (action.kind === 'pressKeys') {
      const keys = nativeKeys(action.keys, this.platform);
      const main = keys.at(-1)!;
      if (this.platform === 'win32' && keys.includes('alt') && ['f4', 'delete'].includes(main)) throw new Error('COMPUTER_KEY_SCOPE_UNSAFE');
      // Global/app escape shortcuts are not scoped to the authorized window.
      if (keys.slice(0, -1).some(key => key !== 'shift') && ['q', 'w', 'h', 'm', 'space', 'tab', 'escape'].includes(main)) throw new Error('COMPUTER_KEY_SCOPE_UNSAFE');
      if (this.platform === 'win32') this.windowsKeyboardTarget(keys);
    }
    if (action.kind === 'scroll' && (!!action.deltaX === !!action.deltaY)) throw new Error('COMPUTER_SCROLL_REQUIRES_ONE_AXIS');
    if (action.kind === 'drag' && action.from.x === action.to.x && action.from.y === action.to.y) throw new Error('COMPUTER_DRAG_REQUIRES_MOVEMENT');
  }
  private windowsKeyboardTarget(keys: string[]) {
    const focused = this.windowsInput?.focused;
    const fields = this.elements.filter(item => typeof item.element_token === 'string' && item.keyboardFocused === true
      && item.windows_focus_id === focused?.runtimeId);
    const navigation = ['return', 'tab', 'escape', 'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown'];
    const requiresWritable = !!focused && (['ControlType.Edit', 'ControlType.Document'].includes(focused.role)
      || !navigation.includes(keys.at(-1)!) || keys.length > 1 && !(keys.length === 2 && keys[0] === 'shift' && keys[1] === 'tab'));
    if (!focused || focused.password !== false || !focused.enabled || focused.offscreen || fields.length !== 1 || fields[0].enabled === false
      || requiresWritable && (!windowsInputAllowed(focused) || fields[0].inputAllowed !== true)) {
      throw new Error('COMPUTER_WINDOWS_KEY_TARGET_REQUIRED');
    }
    return fields[0];
  }
  private async checkWindowsInput(target: ComputerTarget, action: ComputerAction, signal: AbortSignal): Promise<void> {
    if (this.platform !== 'win32' || !['typeText', 'setValue', 'pressKeys'].includes(action.kind)) return;
    const fresh = await this.assertWindowApp(target, signal, true);
    if (action.kind === 'pressKeys') {
      const expected = this.windowsKeyboardTarget(nativeKeys(action.keys, this.platform));
      const focused = fresh?.input?.focused;
      if (!focused || focused.runtimeId !== expected.windows_focus_id || focused.password !== false || !focused.enabled || focused.offscreen
        || (['ControlType.Edit', 'ControlType.Document'].includes(focused.role) && !windowsInputAllowed(focused))) throw new Error('COMPUTER_WINDOWS_KEY_TARGET_CHANGED');
    } else if (action.kind === 'typeText' || action.kind === 'setValue') {
      const expected = this.editable(action);
      const found = fresh?.input?.fields.filter(field => field.runtimeId === expected.windows_runtime_id);
      if (found?.length !== 1 || !windowsInputAllowed(found[0])) throw new Error('COMPUTER_WINDOWS_EDIT_TARGET_CHANGED');
    }
  }
  private inputTimer?: ComputerInputTimer;
  private lastInputTiming?: ComputerInputTiming;
  getLastInputTiming(): ComputerInputTiming | undefined { return this.lastInputTiming; }
  private validateInputResult<T>(operation: () => T): T {
    return this.inputTimer ? this.inputTimer.measureSync('resultValidationMs', operation) : operation();
  }
  private async timedSdk<T>(operation: () => Promise<T>): Promise<T> {
    try { return await (this.inputTimer ? this.inputTimer.measure('sdkCallMs', operation) : operation()); }
    catch (error) {
      if (computerNativeInputError(error, '').message === 'COMPUTER_BACKGROUND_INPUT_UNSUPPORTED') throw new Error('COMPUTER_BACKGROUND_INPUT_UNSUPPORTED');
      throw error;
    }
  }
  async perform(target: ComputerTarget, action: ComputerAction, signal: AbortSignal,
    onProgress?: (index: number, dispatch: 'notStarted' | 'started' | 'completed' | 'unknown') => void): Promise<void> {
    this.preparedFrame = undefined;
    const timer = new ComputerInputTimer(this.platform === 'win32');
    this.lastInputTiming = undefined;
    this.inputTimer = timer;
    let completed = false;
    try {
      if (action.kind === 'batch' || action.kind === 'activateSequence') timer.measureSync('actionValidationMs', () => this.validateAction(action));
      const inputs = computerActionInputs(action);
      if ((action.kind === 'batch' || action.kind === 'activateSequence') && this.platform === 'darwin'
        && this.exactNativeBatch && inputs.every(input => input.kind !== 'wait')) {
        await this.performNativeBatch(target, inputs, signal, onProgress);
        completed = true;
        return;
      }
      for (const [index, input] of inputs.entries()) {
        signal.throwIfAborted();
        // Coordinate inputs additionally require unchanged native window geometry.
        // This is metadata-only; observations belong at explicit checkpoints.
        if (action.kind === 'batch' && ('point' in input || input.kind === 'drag')) {
          const current = (await this.listWindows(target.pid, signal)).find(window => window.windowId.toString() === target.windowId);
          if (!current || !current.isOnScreen || current.onCurrentSpace === false
            || !this.frame || JSON.stringify(Bounds.parse(current.bounds)) !== JSON.stringify(this.frame.bounds)) throw new Error('COMPUTER_WINDOW_CHANGED');
        }
        onProgress?.(index, 'started');
        try {
          await this.performInput(target, input, signal);
          onProgress?.(index, 'completed');
        } catch (error) { onProgress?.(index, 'unknown'); throw error; }
      }
      completed = true;
    } finally {
      this.lastInputTiming = timer.finish(completed);
      this.inputTimer = undefined;
    }
  }
  private async performNativeBatch(target: ComputerTarget, inputs: ComputerPrimitiveAction[], signal: AbortSignal,
    onProgress?: (index: number, dispatch: NativeBatchProgress) => void): Promise<void> {
    if (!this.client || !this.frame || !this.observedTarget || this.observedTarget.appId !== target.appId
      || this.observedTarget.pid !== target.pid || this.observedTarget.processIdentity !== target.processIdentity
      || this.observedTarget.windowId !== target.windowId) throw new Error('COMPUTER_ELEMENT_TARGET_CHANGED');
    await this.inputTimer!.measure('identityCheckMs', async () => {
      if (await this.processIdentity(target.pid) !== target.processIdentity) throw new Error('COMPUTER_PROCESS_CHANGED');
    });
    const windowId = this.jsonWindowId(BigInt(target.windowId));
    const steps = inputs.map(input => {
      const args: Record<string, unknown> = { pid: target.pid, window_id: windowId };
      switch (input.kind) {
        case 'activate': case 'showMenu': return { tool: 'click', args: { ...args,
          element_token: this.semanticElement(input).element_token, button: input.kind === 'activate' ? 'left' : 'right', count: 1 } };
        case 'click': return { tool: 'click', args: { ...args, ...input.point, button: input.button, count: input.count } };
        case 'setValue': return { tool: 'set_value', args: { ...args, element_token: this.editable(input).element_token, value: input.text } };
        case 'typeText': {
          const field = this.editable(input);
          return { tool: 'type_text', args: { ...args, text: input.text,
            ...(field.in_web_content === true ? input.point! : { element_token: field.element_token }) } };
        }
        case 'pressKeys': {
          const keys = nativeKeys(input.keys, this.platform);
          return { tool: keys.length === 1 ? 'press_key' : 'hotkey', args: { ...args, ...(keys.length === 1 ? { key: keys[0] } : { keys }) } };
        }
        case 'drag': return { tool: 'drag', args: { ...args, from_x: input.from.x, from_y: input.from.y,
          to_x: input.to.x, to_y: input.to.y, duration_ms: 500, steps: 20, button: 'left' } };
        case 'scroll': {
          const delta = input.deltaY || input.deltaX;
          return { tool: 'scroll', args: { ...args, ...input.point, by: 'line', amount: Math.min(5, Math.max(1, Math.ceil(Math.abs(delta) / 100))),
            direction: input.deltaY ? delta > 0 ? 'down' : 'up' : delta > 0 ? 'right' : 'left' } };
        }
        default: throw new Error('COMPUTER_INVALID_INPUT');
      }
    });
    signal.throwIfAborted();
    for (const index of inputs.keys()) onProgress?.(index, 'started');
    let result: ToolResult;
    try {
      result = await this.timedSdk(() => this.client!.callTool('run_steps', JSON.stringify({ strict_targets: true,
        pid: target.pid, window_id: windowId, expected_bounds: this.frame!.bounds, delivery_mode: 'background',
        foreground_fallback: false, delay_ms: 0, timeout_ms: 25_000, steps }), { signal }));
    } catch (error) {
      for (const index of inputs.keys()) onProgress?.(index, 'unknown');
      // Dropping an RPC cannot prove the native loop stopped. Reap the private
      // daemon before returning cancellation; never replay through scalar calls.
      if (signal.aborted) await this.stop();
      throw error;
    }
    let decoded: ReturnType<typeof decodeNativeBatchResult>;
    try { decoded = this.validateInputResult(() => {
      if (result.images.length) throw new Error('COMPUTER_DRIVER_INVALID_BATCH_RESULT');
      return decodeNativeBatchResult(result.structuredJson ?? result.rawJson ?? '', inputs.length, result.isError);
    }); }
    catch (error) { for (const index of inputs.keys()) onProgress?.(index, 'unknown'); throw error; }
    for (const [index, dispatch] of decoded.progress.entries()) onProgress?.(index, dispatch);
    if (signal.aborted) { await this.stop(); signal.throwIfAborted(); }
    if (decoded.errorCode) throw new Error(decoded.errorCode);
  }
  private async performInput(target: ComputerTarget, action: ComputerAction, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    await this.inputTimer!.measure('identityCheckMs', async () => {
      if (this.platform === 'win32') {
        if (!['typeText', 'setValue', 'pressKeys'].includes(action.kind)) await this.assertWindowApp(target, signal);
      } else if (await this.processIdentity(target.pid) !== target.processIdentity) throw new Error('COMPUTER_PROCESS_CHANGED');
    });
    signal.throwIfAborted();
    await this.inputTimer!.measure('actionValidationMs', () => this.validateAction(action));
    if (this.platform === 'win32') await this.inputTimer!.measure('windowsInputGuardMs', () => this.checkWindowsInput(target, action, signal));
    signal.throwIfAborted();
    if ('ref' in action && (!this.observedTarget || this.observedTarget.appId !== target.appId
      || this.observedTarget.pid !== target.pid || this.observedTarget.processIdentity !== target.processIdentity
      || this.observedTarget.windowId !== target.windowId)) throw new Error('COMPUTER_ELEMENT_TARGET_CHANGED');
    const windowId = BigInt(target.windowId);
    if (!this.client || !this.sdk) throw new Error('COMPUTER_DRIVER_OFFLINE');
    const actionTarget = new this.sdk.ActionTarget.Window({ pid: target.pid, windowId });
    switch (action.kind) {
      case 'activate': case 'showMenu': {
        const result = await this.timedSdk(() => this.client!.click({ target: actionTarget,
          position: new this.sdk!.ClickPosition.Element({ elementToken: this.semanticElement(action).element_token as string }),
          deliveryMode: this.sdk!.InputDeliveryMode.Background, count: 1,
          button: action.kind === 'activate' ? this.sdk!.ClickButton.Left : this.sdk!.ClickButton.Right }, { signal }));
        this.validateInputResult(() => {
          if (result.effect === this.sdk!.ActionEffect.Refused) throw computerNativeInputError(result, 'COMPUTER_SEMANTIC_ACTION_UNCONFIRMED');
          if (result.route !== this.sdk!.ActionRoute.Accessibility || ![
            this.sdk!.ActionEffect.Confirmed, this.sdk!.ActionEffect.Unverifiable,
          ].includes(result.effect)) throw new Error('COMPUTER_SEMANTIC_ACTION_UNCONFIRMED');
        });
        return;
      }
      case 'wait': await delay(action.durationMs, undefined, { signal }); return;
      case 'click': {
        const button = action.button === 'right' ? this.sdk.ClickButton.Right : this.sdk.ClickButton.Left;
        const result = await this.timedSdk(() => this.client!.click({ target: actionTarget, position: new this.sdk!.ClickPosition.Coordinates(action.point),
          deliveryMode: this.sdk!.InputDeliveryMode.Background, count: action.count, button }, { signal }));
        this.validateInputResult(() => { if (result.effect === this.sdk!.ActionEffect.Refused) throw computerNativeInputError(result, 'COMPUTER_DRIVER_CLICK_REFUSED'); });
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
        await this.callUntyped('set_value', { pid: target.pid, window_id: this.jsonWindowId(windowId), element_token: this.editable(action).element_token,
          ...(this.platform === 'win32' ? { delivery_mode: 'background' } : {}), value: action.text }, signal); return;
      case 'pressKeys': {
        const keys = nativeKeys(action.keys, this.platform);
        if (this.platform === 'win32') {
          await this.callUntyped(keys.length === 1 ? 'press_key' : 'hotkey', { pid: target.pid,
            window_id: this.jsonWindowId(windowId), element_token: this.windowsKeyboardTarget(keys).element_token,
            delivery_mode: 'background', ...(keys.length === 1 ? { key: keys[0] } : { keys }) }, signal);
          return;
        }
        const result = await this.timedSdk(() => keys.length === 1 ? this.client!.pressKey({ key: keys[0], target: actionTarget }, { signal })
          : this.client!.hotkey({ keys, target: actionTarget }, { signal }));
        this.validateInputResult(() => {
          if (result.isError) {
            log.warn({ phase: 'key', nativeErrorCode: /^[a-z_0-9]{1,80}$/i.test(result.errorCode ?? '') ? result.errorCode : undefined }, 'Native window key refused');
            throw computerNativeInputError(result, 'COMPUTER_DRIVER_KEY_REFUSED');
          }
        });
        return;
      }
      case 'scroll': {
        const delta = action.deltaY || action.deltaX;
        // Native wheel delivery is deliberately bounded, never advertised as exact pixel travel.
        const direction = action.deltaY
          ? (delta > 0 ? this.sdk.ScrollDirection.Down : this.sdk.ScrollDirection.Up)
          : (delta > 0 ? this.sdk.ScrollDirection.Right : this.sdk.ScrollDirection.Left);
        const result = await this.timedSdk(() => this.client!.scroll({ target: actionTarget, ...action.point, by: this.sdk!.ScrollBy.Line,
          amount: BigInt(Math.min(5, Math.max(1, Math.ceil(Math.abs(delta) / 100)))), direction }, { signal }));
        this.validateInputResult(() => { if (result.isError) throw computerNativeInputError(result, 'COMPUTER_DRIVER_SCROLL_REFUSED'); });
        return;
      }
    }
  }
  stop(): Promise<void> {
    clearTimeout(this.idleTimer);
    this.generation++;
    if (!this.stopping) {
      const starting = this.starting;
      this.stopping = (async () => {
        await this.cleanup();
        if (starting) await cleanupDeadline(() => starting.catch(() => {}), 3000);
        await this.cleanup();
        this.cleanupUnconfirmed = false;
      })().catch(error => { this.cleanupUnconfirmed = true; throw error; })
        .finally(() => { this.stopping = undefined; });
    }
    return this.stopping;
  }
  private async cleanup(): Promise<void> {
    this.preparedFrame = undefined;
    this.elements = []; this.frame = undefined; this.observedTarget = undefined; this.windowsInput = undefined;
    const client = this.client; this.client = undefined;
    this.sdk = undefined;
    this.exactNativeBatch = false;
    this.runningAppsOnly = false;
    this.foregroundAppPreparation = false;
    this.inputWindowCandidates = false;
    this.windowLayoutBounds = false;
    this.exactWindowMetadata = false;
    this.kernelProcessIdentity = false; this.readinessNotifications = false; this.windowProcessIdentity = false; this.preparationIdentity = undefined; this.readinessPid = undefined;
    const host = this.host;
    // A broken RPC connection must not prevent the owned daemon from being stopped.
    if (client) await cleanupDeadline(() => client.shutdown(), 750).catch(() => {});
    try { (client as { uniffiDestroy?: () => void } | undefined)?.uniffiDestroy?.(); } catch { /* Daemon cleanup still runs. */ }
    if (host) {
      try { await cleanupDeadline(() => host.stop(), 3000); }
      catch (error) { this.cleanupUnconfirmed = true; throw new Error('COMPUTER_DRIVER_CLEANUP_UNCONFIRMED', { cause: error }); }
      if (this.host === host) this.host = undefined;
      try { (host as { uniffiDestroy?: () => void }).uniffiDestroy?.(); } catch { /* The daemon already acknowledged stop. */ }
    }
  }
}
