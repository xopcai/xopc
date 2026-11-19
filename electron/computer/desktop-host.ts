import { hostname, release } from 'node:os';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdir, readFile, writeFile, stat, realpath } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, clipboard, dialog, safeStorage, shell, systemPreferences, type BrowserWindow } from 'electron';
import WebSocket from 'ws';
import { EndpointToolClientError, EndpointToolHostController, EndpointToolRegistry, type EndpointToolApprovalRequest } from '@xopcai/endpoint-tools-client';
import { createDesktopEndpointToolDefinitions } from '@xopcai/endpoint-tools-client/desktop-tools';
import { desktopCapabilitySigningPayload, desktopCapabilityTitles, desktopDeviceCapabilityGrantSchema, desktopDeviceChatToolSchema, deviceFolderChangeSchema, deviceFolderSigningPayload, endpointHelloSigningPayload, type DesktopCapabilitySnapshot, type DeviceFolderSnapshot, type EndpointHelloPayload, type EndpointTurnClaim } from '@xopcai/endpoint-tools-protocol';
import { RealtimeClient, RealtimeConnectionError, type RealtimeWebSocket } from '@xopcai/realtime-client';
import { REALTIME_PROTOCOL_VERSION } from '@xopcai/realtime-protocol';
import { COMPUTER_DESCRIPTOR, ComputerCommandSchema } from '@xopcai/computer-control-contract';
import { ComputerBroker, type ComputerApproval } from '../../src/computer/broker.js';
import { CuaComputerDriver } from './cua-driver.js';
import { getElectronShellLanguage, showEndpointNotification } from '../ipc/system-settings-ipc.js';
import { getComputerMessages } from './messages.js';
import { MIME_TYPE_BY_EXTENSION } from '../ipc/file-ipc.js';
import { normalizeExternalHttpUrl } from '../external-url.js';
import { assertGatewayCompatibility, GATEWAY_PROTOCOL_INCOMPATIBLE } from '../gateway-compatibility.js';
import { writeTextAtomic } from '../../src/infra/write-file-atomic.js';
import { createLogger } from '../../src/utils/logger.js';
import { uploadDesktopFrame } from './frame-upload.js';
import { executeComputerCommand } from './execute-command.js';
import { resolveLocalComputerDriver } from './local-driver.js';
import { ComputerWorkspaceVisibility } from './workspace-visibility.js';
import { ComputerAccessPolicy } from './access-policy.js';
import { ComputerPreviewManager } from './preview-manager.js';
import { startPreviewCapture } from './preview-capture.js';
import { DesktopFolderStore } from '../files/device-folders.js';
import { DesktopCapabilityStore } from './device-capability-store.js';
import { localGatewayOrigin } from '../gateway/local-connection.js';
import type { DesktopGatewayTarget } from '../gateway/desktop-transport.js';

type Identity = { principalId: string; publicKey: string; encryptedPrivateKey: string; displayName?: string };
const log = createLogger('DesktopEndpointHost');

export function resolveComputerDriverPath(options: { packaged: boolean; resourcesPath: string; mainDir: string; platform?: NodeJS.Platform; arch?: string; useLocalBuild?: boolean }): string {
  const platform = options.platform ?? process.platform;
  const name = platform === 'win32' ? 'cua-driver.exe' : 'cua-driver';
  if (!options.packaged && (options.useLocalBuild ?? process.env.XOPC_COMPUTER_DRIVER_BUILD === 'local')) {
    return resolveLocalComputerDriver(join(options.mainDir, '..', '..'), platform, options.arch ?? process.arch);
  }
  return options.packaged
    ? join(options.resourcesPath, 'bin', name)
    : join(options.mainDir, '..', '..', '.cache', 'computer-driver', '0.36.0', ...(platform === 'win32' ? [`win32-${options.arch ?? process.arch}`] : []), name);
}

export function resolveComputerDriverSdkUrl(options: { packaged: boolean; resourcesPath: string }): string | undefined {
  if (!options.packaged) return undefined;
  // The SDK resolves and opens its sibling dylib from import.meta.url. Loading its
  // virtual app.asar path makes dlopen fail even though electron-builder unpacked it.
  return pathToFileURL(join(options.resourcesPath, 'app.asar.unpacked', 'node_modules', '@trycua', 'cua-driver', 'dist', 'index.js')).href;
}

export class DesktopEndpointHost {
  readonly broker: ComputerBroker;
  readonly preview: ComputerPreviewManager;
  private client?: RealtimeClient;
  private controller?: EndpointToolHostController;
  private claim?: EndpointTurnClaim;
  private retry?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private connecting = false;
  private error?: string;
  private reenrollmentRequired = false;
  private reenrolling = false;
  private readonly lifetime = new AbortController();
  private folders?: DesktopFolderStore;
  private publishFolders?: (snapshot: DeviceFolderSnapshot) => Promise<void>;
  private folderGatewayAccess = false;
  private capabilityStore?: DesktopCapabilityStore;
  private changeCapability?: (value: unknown) => Promise<DesktopCapabilitySnapshot | undefined>;
  private screenLocked = false;
  private readonly accessPolicy = new ComputerAccessPolicy();
  private readonly workspaceVisibility = new ComputerWorkspaceVisibility();
  private stopBrokerInBackground(errorCode?: 'COMPUTER_LOCAL_UI_REQUIRED'): void {
    void this.broker.stop(errorCode).catch(() => {
      if (!this.reenrollmentRequired) this.error = 'COMPUTER_DRIVER_CLEANUP_UNCONFIRMED';
      log.warn({ phase: 'cleanup' }, 'Computer driver stop could not be confirmed');
    });
  }
  constructor(private readonly options: { connection(): (DesktopGatewayTarget | { port: number; token: string }) | undefined; window(): BrowserWindow | null }) {
    // Dev launches out/main/index.js directly, so app.getAppPath() is not the repository root.
    const binary = resolveComputerDriverPath({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, mainDir: import.meta.dirname });
    const sdkUrl = resolveComputerDriverSdkUrl({ packaged: app.isPackaged, resourcesPath: process.resourcesPath });
    const loadSdk = sdkUrl ? () => import(/* @vite-ignore */ sdkUrl) : undefined;
    this.broker = new ComputerBroker(new CuaComputerDriver(binary, app.isPackaged ? 'ai.xopc.xopc' : 'com.github.Electron', loadSdk, process.platform,
      () => this.workspaceVisibility.active), {
      isVisible: () => this.visible(),
      requestApproval: (request, signal) => this.approve(request, signal),
      onStateChange: () => this.preview?.sync(),
    }, { enabled: true });
    this.preview = new ComputerPreviewManager({
      authority: () => this.broker.previewAuthority(),
      validate: authority => this.broker.validatePreview(authority),
      capture: (authority, preset, frame, failed) => startPreviewCapture(authority, preset, frame, failed, () => this.broker.validatePreview(authority)),
      changed: state => {
        const window = this.options.window();
        if (window && !window.isDestroyed()) window.webContents?.send('computer-preview:state', state);
      },
    });
  }
  private visible(): boolean {
    const w = this.options.window();
    // Electron can briefly hide the host while changing its macOS workspace
    // policy. Only session preparation is allowed through that transition;
    // approval checks actual visibility again before any desktop work begins.
    const preparing = this.workspaceVisibility.transitioning && this.broker.snapshot().status === 'pending_authorization';
    return !!w && !w.isDestroyed() && !w.isMinimized() && (w.isVisible() || preparing);
  }
  snapshot() { return { connected: !!this.claim, claim: this.claim, error: this.error, reenrollmentRequired: this.reenrollmentRequired,
    session: this.broker.snapshot(),
    platform: process.platform,
    capabilities: { supported: process.platform === 'darwin' || (process.platform === 'win32' && process.arch === 'x64'), delivery: 'background',
      textInput: process.platform === 'darwin' || (process.platform === 'win32' && process.arch === 'x64') },
    permissions: { accessibility: process.platform === 'darwin' && systemPreferences.isTrustedAccessibilityClient(false),
      screenRecording: process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'unknown' } }; }
  async focusComputer(conversationId: string, previewId: string): Promise<void> {
    if (this.preview.current(conversationId)?.previewId !== previewId) throw new Error('COMPUTER_PREVIEW_REVOKED');
    await this.broker.focusConversation(conversationId);
  }
  async stopControl(): Promise<void> {
    await this.broker.stop();
  }
  async stopPreviewControl(subscriptionId: string): Promise<void> {
    const sessionId = this.preview.controlSession(subscriptionId);
    if (this.broker.previewAuthority()?.computerSessionId !== sessionId) throw new Error('COMPUTER_PREVIEW_REVOKED');
    await this.broker.stop();
    this.preview.sync();
  }
  private async approve(request: ComputerApproval, signal: AbortSignal): Promise<boolean> {
    if (!this.visible() || signal.aborted) return false;
    const appId = request.kind === 'session' ? request.appId : request.target.appId;
    if (!await this.accessPolicy.allows(appId)) throw new Error('COMPUTER_APP_NOT_AUTHORIZED');
    if (request.kind === 'session' && !signal.aborted) {
      const window = this.options.window();
      if (window && !window.isDestroyed()) await this.workspaceVisibility.begin(window, signal);
    }
    return !signal.aborted && this.visible();
  }
  async computerAccess() {
    const authorizedAppIds = await this.accessPolicy.list();
    const allowAllApps = await this.accessPolicy.allAllowed();
    let appsBusy = false;
    let appsUnavailable = false;
    const discovered = await this.broker.listAppsForSettings().catch(error => {
      if (error instanceof Error && error.message === 'COMPUTER_BUSY') { appsBusy = true; return []; }
      appsUnavailable = true;
      return [];
    });
    const apps = [...discovered];
    for (const appId of authorizedAppIds) if (!apps.some(item => item.appId === appId)) apps.push({ appId, name: appId, running: false });
    return { authorizedAppIds, allowAllApps, appsBusy, appsUnavailable, apps };
  }
  async setComputerAllAppAccess(allowed: boolean) {
    await this.accessPolicy.setAll(allowed);
    if (!allowed) {
      const appId = this.broker.snapshot().appId;
      if (appId && !await this.accessPolicy.allows(appId)) await this.broker.stop();
    }
    return this.computerAccess();
  }
  async setComputerAppAccess(appId: string, allowed: boolean) {
    const apps = allowed ? await this.broker.listAppsForSettings() : [];
    if (allowed && !apps.some(item => item.appId === appId)) throw new Error('COMPUTER_APP_NOT_FOUND');
    const authorizedAppIds = await this.accessPolicy.set(appId, allowed);
    if (!allowed && this.broker.snapshot().appId === appId) await this.broker.stop();
    return { authorizedAppIds, apps };
  }
  async deviceFolders() {
    if (!this.folders) return;
    return { endpointId: this.claim?.endpointId, ready: !!this.publishFolders && !!this.claim,
      gatewayAccess: this.folderGatewayAccess, ...await this.folders.snapshot() };
  }

  async deviceCapabilities() {
    if (!this.capabilityStore) return;
    return { endpointId: this.claim?.endpointId, ready: Boolean(this.changeCapability), ...await this.capabilityStore.snapshot() };
  }

  async changeDeviceCapability(value: unknown) {
    if (!this.changeCapability) throw new Error('DESKTOP_CAPABILITY_CONNECTION_REQUIRED');
    return this.changeCapability(value);
  }

  setScreenLocked(locked: boolean): void {
    this.screenLocked = locked;
    this.controller?.publishAvailability();
    if (locked) this.stopBrokerInBackground();
  }

  async changeDeviceFolder(value: unknown): Promise<DeviceFolderSnapshot | undefined> {
    const input = deviceFolderChangeSchema.parse(value);
    const publish = this.publishFolders;
    const origin = this.claim;
    const folders = this.folders;
    const window = this.options.window();
    const connection = this.options.connection();
    if (!publish || !origin || !folders || !window || !this.visible() || !connection) throw new Error('DESKTOP_FOLDER_CONNECTION_REQUIRED');
    if (!('revoke' in input) && !this.folderGatewayAccess) throw new Error('DESKTOP_FOLDER_GATEWAY_ACCESS_REQUIRED');
    if ('revoke' in input) return folders.change(input, publish);
    const zh = getElectronShellLanguage().startsWith('zh');
    if ('id' in input) {
      const previous = (await folders.snapshot()).folders.find(folder => folder.id === input.id);
      if (!previous) throw new Error('FOLDER_AUTHORIZATION_CHANGED');
      if (previous.access === 'gateway') return folders.snapshot();
      const confirmation = await dialog.showMessageBox(window, {
        type: 'question', title: zh ? '文件夹授权' : 'Folder access',
        message: zh ? `允许当前 Gateway 只读访问「${previous.label}」？` : `Give the current Gateway read-only access to “${previous.label}”?`,
        buttons: zh ? ['取消', '允许'] : ['Cancel', 'Allow'], defaultId: 0, cancelId: 0, noLink: true, signal: this.lifetime.signal,
      });
      if (confirmation.response !== 1 || this.claim !== origin || this.stopped) return;
      return folders.change(input, publish);
    }
    const defaultPath = input.kind === 'custom' ? undefined : app.getPath(input.kind);
    const selection = await dialog.showOpenDialog(window, {
      title: zh ? '选择要向当前 Gateway 开放的只读文件夹' : 'Choose a folder for read-only Gateway access',
      buttonLabel: zh ? '允许访问' : 'Allow access',
      properties: ['openDirectory'], defaultPath,
    });
    if (selection.canceled || !selection.filePaths[0] || this.claim !== origin || this.stopped) return;
    const path = await realpath(selection.filePaths[0]);
    const preset = defaultPath ? await realpath(defaultPath).catch(() => undefined) : undefined;
    if (this.claim !== origin || this.stopped) return;
    return folders.change({ kind: path === preset ? input.kind : 'custom', path }, publish);
  }

  async start(): Promise<void> {
    if (this.stopped || this.connecting || this.client || this.reenrollmentRequired) return;
    clearTimeout(this.retry);
    this.connecting = true;
    try { await this.connect(); this.error = undefined; }
    catch (error) {
      if (!this.reenrollmentRequired) this.error = error instanceof Error && error.message === GATEWAY_PROTOCOL_INCOMPATIBLE
        ? getComputerMessages(getElectronShellLanguage()).protocolIncompatible
        : 'Desktop endpoint is not ready. Check the selected Gateway and keychain.';
      if (!this.stopped && !this.reenrollmentRequired && !(error instanceof RealtimeConnectionError && !error.retryable)) {
        this.retry = setTimeout(() => { void this.start(); }, 2000);
      }
    }
    finally { this.connecting = false; }
  }
  private createIdentity(): { data: Identity; privateKey: string } {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Desktop identity requires the OS keychain');
    const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const data: Identity = { principalId: randomUUID(), displayName: hostname().replace(/\.local$/i, '').slice(0, 120) || 'xopc Desktop', publicKey: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'), encryptedPrivateKey: safeStorage.encryptString(privateKey).toString('base64') };
    return { data, privateKey };
  }
  /** Identity rotation never grants permission to observe or operate applications. */
  async reenroll(): Promise<void> {
    if (!this.reenrollmentRequired || this.reenrolling || this.connecting || this.stopped || !this.visible()) return;
    this.reenrolling = true;
    try {
      const t = getComputerMessages(getElectronShellLanguage());
      const answer = await dialog.showMessageBox(this.options.window()!, {
        type: 'warning', title: t.title, message: t.reenroll.message, detail: t.reenroll.detail,
        buttons: [t.cancel, t.reenroll.confirm], defaultId: 0, cancelId: 0, noLink: true, signal: this.lifetime.signal,
      });
      if (answer.response !== 1 || this.stopped || !this.visible()) return;
      const identity = this.createIdentity();
      await writeTextAtomic(this.identityPath(), JSON.stringify(identity.data), { mode: 0o600 });
      if (this.stopped) return;
      this.reenrollmentRequired = false;
      await this.start();
    } finally { this.reenrolling = false; }
  }
  private principalRevoked(): void {
    this.reenrollmentRequired = true;
    clearTimeout(this.retry);
    this.claim = undefined;
    this.changeCapability = undefined;
    this.client?.disconnect(); this.client = undefined;
    this.controller?.disconnect(); this.controller = undefined;
    this.stopBrokerInBackground();
    this.error = 'Desktop identity was revoked. Re-register this device in Computer Use settings.';
  }
  private identityPath(): string {
    const connection = this.options.connection();
    if (!connection || !('scope' in connection) || connection.scope === 'local') return join(app.getPath('userData'), 'desktop-endpoint-identity.json');
    return join(app.getPath('userData'), 'desktop-endpoint-identities', createHash('sha256').update(connection.origin).digest('hex') + '.json');
  }
  private async identity(): Promise<{ data: Identity; privateKey: string }> {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Desktop identity requires the OS keychain');
    const path = this.identityPath();
    await mkdir(dirname(path), { recursive: true });
    try {
      const data = JSON.parse(await readFile(path, 'utf8')) as Identity;
      return { data, privateKey: safeStorage.decryptString(Buffer.from(data.encryptedPrivateKey, 'base64')) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const identity = this.createIdentity();
      await writeFile(path, JSON.stringify(identity.data), { mode: 0o600, flag: 'wx' });
      return identity;
    }
  }
  private async connect(): Promise<void> {
    const connection = this.options.connection(); if (!connection) throw new Error('Gateway unavailable');
    const base = 'origin' in connection ? connection.origin : localGatewayOrigin(connection);
    const headers = { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' };
    const request = async (path: string, body: unknown, signal?: AbortSignal) => {
      const result = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error',
        signal: AbortSignal.any([this.lifetime.signal, signal ?? AbortSignal.timeout(10_000)]) });
      if (!result.ok) {
        const error = await result.json().catch(() => null);
        if (!this.stopped && path === '/api/endpoint-tools/principals' && result.status === 403 && error?.error?.code === 'PRINCIPAL_REVOKED') {
          this.principalRevoked();
        }
        throw new Error(`Desktop connection HTTP ${result.status}`);
      }
      return result.json();
    };
    const identity = await this.identity();
    const identityDirectory = dirname(this.identityPath());
    const displayName = identity.data.displayName ?? 'xopc Desktop';
    const registerIdentity = async () => {
      await assertGatewayCompatibility(connection, this.lifetime.signal);
      return request('/api/endpoint-tools/principals', { principalId: identity.data.principalId, publicKey: identity.data.publicKey, kind: 'desktop', platform: process.platform, displayName });
    };
    await registerIdentity();
    if (this.stopped) return;
    const compatibilityResponse = await fetch(base + '/api/endpoint-tools/compatibility', { headers, redirect: 'error', signal: this.lifetime.signal });
    if (!compatibilityResponse.ok) throw new Error('Gateway compatibility is unavailable');
    const compatibility = await compatibilityResponse.json() as { payload?: {
      gatewayId?: string; deviceStateToolsV1?: boolean; deviceFolderConnectionsV1?: boolean; deviceFolderGatewayAccessV1?: boolean;
      desktopCapabilityAccessV1?: boolean;
    } };
    const endpointId = `${identity.data.principalId}:${randomUUID()}`;
    const foldersSupported = compatibility.payload?.deviceFolderConnectionsV1 === true;
    const gatewayId = compatibility.payload?.gatewayId;
    const gatewayScope = gatewayId && createHash('sha256').update(gatewayId).digest('hex');
    const capabilityStore = gatewayScope && compatibility.payload?.desktopCapabilityAccessV1 === true
      ? new DesktopCapabilityStore(join(identityDirectory, 'desktop-capability-grants', identity.data.principalId, gatewayScope + '.json'))
      : undefined;
    this.capabilityStore = capabilityStore;
    const getAvailability = () => !this.screenLocked && (capabilityStore ? this.visible() : this.options.window()?.isFocused())
      ? 'foreground' as const : 'background' as const;
    this.folderGatewayAccess = Boolean(gatewayScope) && compatibility.payload?.deviceFolderGatewayAccessV1 === true;
    const folderDirectory = join(identityDirectory, 'desktop-folder-grants');
    const previousFolderPath = join(folderDirectory, identity.data.principalId + '.json');
    const folderPath = this.folderGatewayAccess && gatewayScope
      ? join(folderDirectory, identity.data.principalId + '.' + gatewayScope + '.json') : previousFolderPath;
    const folders = new DesktopFolderStore(() => folderPath,
      extension => MIME_TYPE_BY_EXTENSION[extension] ?? 'application/octet-stream',
      folderPath !== previousFolderPath ? previousFolderPath : undefined);
    this.folders = foldersSupported ? folders : undefined;
    const registry = new EndpointToolRegistry([
      ...(foldersSupported ? folders.definitions() : []),
      ...createDesktopEndpointToolDefinitions(() => ({
        device: { readState: async () => ({ platform: process.platform, systemVersion: release(), locale: app.getLocale(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }) },
        file: {
          pickEndpointFile: async () => {
            const result = await dialog.showOpenDialog({ properties: ['openFile'] });
            if (result.canceled || !result.filePaths[0]) return null;
            const path = result.filePaths[0]; const metadata = await stat(path);
            if (!metadata.isFile() || metadata.size > 25 * 1024 * 1024) throw new Error('Invalid file or file too large');
            const bytes = await readFile(path); if (bytes.length > 25 * 1024 * 1024) throw new Error('File too large');
            return { name: basename(path), mimeType: MIME_TYPE_BY_EXTENSION[extname(path).toLowerCase()] ?? 'application/octet-stream', size: bytes.length, dataBase64: bytes.toString('base64') };
          },
          saveEndpointText: async ({ suggestedName, content }) => {
            if (basename(suggestedName) !== suggestedName || ['.', '..'].includes(suggestedName) || Buffer.byteLength(content) > 200 * 1024) throw new Error('Invalid save request');
            const result = await dialog.showSaveDialog({ defaultPath: suggestedName });
            if (result.canceled || !result.filePath) return { saved: false };
            await writeFile(result.filePath, content, 'utf8'); return { saved: true, name: basename(result.filePath) };
          },
        },
        clipboard: { readText: async () => clipboard.readText(), writeText: async (text) => { await clipboard.writeText(text); return true; } },
        shell: { openExternalUrl: async (url) => { const normalized = normalizeExternalHttpUrl(url); if (!normalized) return { ok: false, error: 'Invalid URL' }; await shell.openExternal(normalized); return { ok: true }; } },
        system: { showEndpointNotification: async (input) => showEndpointNotification(input) },
      })).filter(definition => compatibility.payload?.deviceStateToolsV1 === true || !definition.descriptor.name.includes('.device.get_')),
      ...(process.platform === 'darwin' || process.platform === 'win32' && process.arch === 'x64' ? [{
        descriptor: structuredClone(COMPUTER_DESCRIPTOR) as any, execute: async (args, context) => {
          const command = ComputerCommandSchema.parse(args);
          return executeComputerCommand(this.broker, command, context);
        },
      }] satisfies import('@xopcai/endpoint-tools-client').EndpointToolDefinition[] : []),
    ]);
    const capabilityGrantPath = ({ descriptor: { name, effect, requiredPermissions } }: EndpointToolApprovalRequest) => {
      if (!gatewayScope) return;
      const permission = createHash('sha256').update(JSON.stringify([name, effect, [...requiredPermissions].sort()])).digest('hex');
      return join(identityDirectory, 'device-capability-grants', identity.data.principalId, gatewayScope, permission);
    };
    const controller = new EndpointToolHostController({ registry,
      getAvailability, createMessageId: randomUUID,
      authorize: async request => {
        if (request.gatewayCapabilityAuthorized && !await capabilityStore?.allows(request.descriptor.name)) {
          throw new EndpointToolClientError('PERMISSION_DENIED', 'This computer did not grant the capability to Gateway');
        }
      },
      hasCapabilityGrant: async (request) => {
        if (request.gatewayCapabilityAuthorized) return true;
        const path = capabilityGrantPath(request);
        if (!path) return false;
        try { return await readFile(path, 'utf8') === 'allowed'; }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          return false;
        }
      },
      confirm: async (request) => {
        if (!this.visible() || request.signal.aborted) return false;
        const grantPath = capabilityGrantPath(request);
        const language = getElectronShellLanguage();
        const { cancel, capabilityAccess } = getComputerMessages(language);
        const tool = desktopDeviceChatToolSchema.safeParse(request.descriptor.name);
        const message = tool.success ? desktopCapabilityTitles[tool.data][language === 'zh' ? 0 : 1] : request.descriptor.title;
        const answer = await dialog.showMessageBox(this.options.window()!, { type: 'question', title: capabilityAccess.title, message,
          detail: grantPath ? capabilityAccess.savedDetail : capabilityAccess.detail,
          buttons: [cancel, capabilityAccess.allow], defaultId: 0, cancelId: 0, signal: request.signal });
        if (request.signal.aborted || answer.response !== 1) return false;
        if (grantPath) await writeTextAtomic(grantPath, 'allowed', { mode: 0o600, ensureDirMode: 0o700 });
        return !request.signal.aborted;
      },
      uploadFile: (grant, file, context) => uploadDesktopFrame({ base, token: connection.token, endpointId, grant, file,
        invocationId: context.invocationId, signal: AbortSignal.any([context.signal, this.lifetime.signal]) }),
    });
    const clientId = randomUUID();
    const realtime = new RealtimeClient({ clientId, clientKind: 'desktop', createMessageId: randomUUID,
      onStateChange: (state, error) => {
        if (!this.reenrollmentRequired) this.error = state === 'connected' ? undefined
          : error === GATEWAY_PROTOCOL_INCOMPATIBLE ? getComputerMessages(getElectronShellLanguage()).protocolIncompatible : error;
      },
      issueTicket: async (signal) => (await request('/api/realtime/tickets', {
        clientId,
        clientKind: 'desktop',
        protocolVersion: REALTIME_PROTOCOL_VERSION,
      }, signal)).payload,
      getWebSocketUrl: () => base.replace(/^http/, 'ws') + '/api/realtime/v1/ws',
      createWebSocket: (url) => new WebSocket(url) as unknown as RealtimeWebSocket,
    });
    realtime.setEndpoint({ createHello: async () => {
      // Recheck on reconnect too: an established principal can be revoked while running.
      await registerIdentity();
      if (this.stopped || this.reenrollmentRequired) throw new Error('Desktop endpoint is unavailable');
      const hello: EndpointHelloPayload = { principalId: identity.data.principalId, endpointId, connectionInstanceId: randomUUID(),
        kind: 'desktop', platform: process.platform, displayName, appVersion: app.getVersion(),
        availability: getAvailability(), nonce: randomUUID(), signedAt: Date.now(), signature: 'pending', tools: registry.descriptors() };
      hello.signature = sign('sha256', Buffer.from(endpointHelloSigningPayload(hello)), { key: identity.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
      return hello;
    }, onReady: ({ endpointId, turnToken }) => {
      if (this.stopped || this.reenrollmentRequired || this.client !== realtime) return;
      const claim: EndpointTurnClaim = { type: 'endpoint', endpointId, token: turnToken };
      this.claim = claim;
      controller.connect(message => realtime.sendEndpointMessage(message));
      if (capabilityStore) {
        const publish = async (snapshot: DesktopCapabilitySnapshot) => {
          if (this.claim !== claim) throw new Error('DESKTOP_CAPABILITY_CONNECTION_CHANGED');
          const signature = sign('sha256', Buffer.from(desktopCapabilitySigningPayload(claim, snapshot)),
            { key: identity.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
          await request('/api/endpoint-tools/device-connections/capabilities', { origin: claim, snapshot, signature });
        };
        this.changeCapability = async value => {
          const { endpointId: expectedEndpointId, toolName, allowed } = desktopDeviceCapabilityGrantSchema.parse(value);
          if (expectedEndpointId !== endpointId) throw new Error('DESKTOP_CAPABILITY_CONNECTION_CHANGED');
          const tool = registry.get(toolName);
          const window = this.options.window();
          if (!window || !this.visible() || this.screenLocked || (allowed && !tool)) throw new Error('DESKTOP_CAPABILITY_UNAVAILABLE');
          if (allowed && tool && !await capabilityStore.allows(toolName)) {
            const language = getElectronShellLanguage();
            const { cancel, capabilityAccess } = getComputerMessages(language);
            const answer = await dialog.showMessageBox(window, { type: 'question', title: capabilityAccess.title,
              message: desktopCapabilityTitles[toolName][language === 'zh' ? 0 : 1], detail: capabilityAccess.detail,
              buttons: [cancel, capabilityAccess.allow], defaultId: 0, cancelId: 0, noLink: true, signal: this.lifetime.signal });
            if (answer.response !== 1) return;
          }
          if (this.claim !== claim || this.stopped || this.screenLocked) throw new Error('DESKTOP_CAPABILITY_CONNECTION_CHANGED');
          if (!allowed && toolName === COMPUTER_DESCRIPTOR.name) this.stopBrokerInBackground();
          return capabilityStore.update(names => allowed ? [...names, toolName] : names.filter(name => name !== toolName), publish);
        };
        void capabilityStore.update(names => names.filter(name => registry.get(name)), publish).catch(() => {
          if (this.claim === claim) log.warn('Desktop capability authorization sync failed');
        });
      }
      if (foldersSupported) {
        const publish = async (snapshot: DeviceFolderSnapshot) => {
          if (this.claim !== claim) throw new Error('DESKTOP_FOLDER_CONNECTION_CHANGED');
          const signature = sign('sha256', Buffer.from(deviceFolderSigningPayload(claim, snapshot)),
            { key: identity.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
          await request('/api/endpoint-tools/device-connections/folders', { origin: claim, snapshot, signature });
        };
        this.publishFolders = publish;
        void folders.snapshot().then(publish).catch(() => {
          if (this.claim === claim) log.warn('Desktop folder authorization sync failed');
        });
      }
    },
      onMessage: message => { void controller.handleMessage(message); },
      onDisconnected: () => { this.claim = undefined; this.publishFolders = undefined; this.changeCapability = undefined; controller.disconnect(); this.stopBrokerInBackground(); },
    });
    this.client = realtime; this.controller = controller; realtime.connect();
  }
  visibilityChanged(): void { this.controller?.publishAvailability(); if (!this.visible()) this.stopBrokerInBackground('COMPUTER_LOCAL_UI_REQUIRED'); }
  async close(): Promise<void> { this.stopped = true; this.lifetime.abort(); clearTimeout(this.retry); this.client?.disconnect(); this.controller?.disconnect(); this.preview.dispose(); try { await this.broker.dispose(); } finally { this.workspaceVisibility.close(); } }
}
