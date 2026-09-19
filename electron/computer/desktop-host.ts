import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { app, clipboard, dialog, safeStorage, shell, systemPreferences, type BrowserWindow } from 'electron';
import WebSocket from 'ws';
import { EndpointToolHostController, EndpointToolRegistry } from '@xopcai/endpoint-tools-client';
import { createDesktopEndpointToolDefinitions } from '@xopcai/endpoint-tools-client/desktop-tools';
import { endpointHelloSigningPayload, type EndpointHelloPayload, type EndpointTurnClaim } from '@xopcai/endpoint-tools-protocol';
import { RealtimeClient, RealtimeConnectionError, type RealtimeWebSocket } from '@xopcai/realtime-client';
import { REALTIME_PROTOCOL_VERSION } from '@xopcai/realtime-protocol';
import { COMPUTER_DESCRIPTOR, ComputerCommandSchema } from '@xopcai/computer-control-contract';
import { ComputerBroker, type ComputerApproval } from '../../src/computer/broker.js';
import { CuaComputerDriver } from './cua-driver.js';
import { readFullControl, writeFullControl } from './control-preferences.js';
import { getElectronShellLanguage, showEndpointNotification } from '../ipc/system-settings-ipc.js';
import { computerApprovalCopy, getComputerMessages } from './messages.js';
import { MIME_TYPE_BY_EXTENSION } from '../ipc/file-ipc.js';
import { normalizeExternalHttpUrl } from '../external-url.js';
import { assertGatewayCompatibility, GATEWAY_PROTOCOL_INCOMPATIBLE } from '../gateway-compatibility.js';
import { writeTextAtomic } from '../../src/infra/write-file-atomic.js';
import { uploadDesktopFrame } from './frame-upload.js';
import { executeComputerCommand } from './execute-command.js';

type Identity = { principalId: string; publicKey: string; encryptedPrivateKey: string };

export function resolveComputerDriverPath(options: { packaged: boolean; resourcesPath: string; mainDir: string }): string {
  return options.packaged
    ? join(options.resourcesPath, 'bin', 'cua-driver')
    : join(options.mainDir, '..', '..', '.cache', 'computer-driver', '0.28.2', 'cua-driver');
}

export class DesktopEndpointHost {
  readonly broker: ComputerBroker;
  private client?: RealtimeClient;
  private controller?: EndpointToolHostController;
  private claim?: EndpointTurnClaim;
  private retry?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private connecting = false;
  private error?: string;
  private reenrollmentRequired = false;
  private reenrolling = false;
  private readonly controlPreferencesPath = join(app.getPath('userData'), 'computer-control-consent');
  private fullControl = readFullControl(this.controlPreferencesPath);
  private controlPaused = false;
  private modeChange?: AbortController;
  private readonly lifetime = new AbortController();
  constructor(private readonly options: { connection(): { port: number; token: string } | undefined; window(): BrowserWindow | null }) {
    // Dev launches out/main/index.js directly, so app.getAppPath() is not the repository root.
    const binary = resolveComputerDriverPath({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, mainDir: import.meta.dirname });
    this.broker = new ComputerBroker(new CuaComputerDriver(binary, app.isPackaged ? 'ai.xopc.xopc' : 'com.github.Electron'), {
      isVisible: () => this.visible() && !this.controlPaused && !this.modeChange,
      hasFullControl: () => this.fullControl,
      requestApproval: (request, signal) => this.approve(request, signal),
    }, { enabled: true });
  }
  private visible(): boolean { const w = this.options.window(); return !!w && !w.isDestroyed() && w.isVisible() && !w.isMinimized(); }
  snapshot() { return { connected: !!this.claim, claim: this.claim, error: this.error, reenrollmentRequired: this.reenrollmentRequired,
    fullControl: this.fullControl, controlPaused: this.controlPaused, session: this.broker.snapshot(),
    permissions: { accessibility: process.platform === 'darwin' && systemPreferences.isTrustedAccessibilityClient(false),
      screenRecording: process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'unknown' } }; }
  async setFullControl(enabled: unknown): Promise<void> {
    if (typeof enabled !== 'boolean') throw new Error('Invalid computer control mode');
    if (this.modeChange) throw new Error('Computer control settings are busy');
    if (this.stopped || !this.visible()) throw new Error('Computer control settings require the local window');
    if (enabled === this.fullControl) return;
    const change = new AbortController();
    this.modeChange = change;
    try {
      if (!enabled) {
        this.fullControl = false;
        // Persist revocation before yielding, so Stop cannot leave old consent on disk.
        try { writeFullControl(this.controlPreferencesPath, false); }
        finally { await this.broker.stop(); }
        return;
      }
      if (enabled) {
        const t = getComputerMessages(getElectronShellLanguage());
        const answer = await dialog.showMessageBox(this.options.window()!, {
          type: 'warning', title: t.title, message: t.fullControl.message, detail: t.fullControl.detail,
          buttons: [t.cancel, t.fullControl.confirm], defaultId: 0, cancelId: 0, noLink: true,
          signal: AbortSignal.any([change.signal, this.lifetime.signal]),
        });
        if (answer.response !== 1 || change.signal.aborted || this.stopped || !this.visible()) return;
      }
      // Revoke existing grants before changing the policy, even if persistence fails.
      this.fullControl = false;
      await this.broker.stop();
      if (change.signal.aborted || this.stopped) return;
      writeFullControl(this.controlPreferencesPath, enabled);
      this.fullControl = enabled;
    } finally { this.modeChange = undefined; }
  }
  async stopControl(): Promise<void> {
    this.controlPaused = true;
    this.modeChange?.abort();
    await this.broker.stop();
  }
  resumeControl(): void {
    if (this.stopped || this.modeChange || !this.visible()) throw new Error('Computer control cannot resume now');
    this.controlPaused = false;
  }
  private async approve(request: ComputerApproval, signal: AbortSignal): Promise<boolean> {
    if (!this.visible() || signal.aborted) return false;
    const language = getElectronShellLanguage();
    const t = getComputerMessages(language);
    const response = await dialog.showMessageBox(this.options.window()!, { type: 'warning', title: t.title,
      ...computerApprovalCopy(language, request),
      buttons: [t.cancel, t.allow], defaultId: 0, cancelId: 0, noLink: true, signal });
    return !signal.aborted && this.visible() && response.response === 1;
  }
  async start(): Promise<void> {
    if (this.stopped || this.connecting || this.client || this.reenrollmentRequired) return;
    clearTimeout(this.retry);
    this.connecting = true;
    try { await this.connect(); this.error = undefined; }
    catch (error) {
      if (!this.reenrollmentRequired) this.error = error instanceof Error && error.message === GATEWAY_PROTOCOL_INCOMPATIBLE
        ? getComputerMessages(getElectronShellLanguage()).protocolIncompatible
        : 'Desktop endpoint is not ready. Check the local Gateway and keychain.';
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
    const data: Identity = { principalId: randomUUID(), publicKey: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'), encryptedPrivateKey: safeStorage.encryptString(privateKey).toString('base64') };
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
      await writeTextAtomic(join(app.getPath('userData'), 'desktop-endpoint-identity.json'), JSON.stringify(identity.data), { mode: 0o600 });
      if (this.stopped) return;
      this.reenrollmentRequired = false;
      await this.start();
    } finally { this.reenrolling = false; }
  }
  private principalRevoked(): void {
    this.reenrollmentRequired = true;
    clearTimeout(this.retry);
    this.claim = undefined;
    this.client?.disconnect(); this.client = undefined;
    this.controller?.disconnect(); this.controller = undefined;
    void this.broker.stop();
    this.error = 'Desktop identity was revoked. Re-register this device in Computer Use settings.';
  }
  private async identity(): Promise<{ data: Identity; privateKey: string }> {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Desktop identity requires the OS keychain');
    const path = join(app.getPath('userData'), 'desktop-endpoint-identity.json');
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
    const base = `http://127.0.0.1:${connection.port}`;
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
    const registerIdentity = async () => {
      await assertGatewayCompatibility(connection, this.lifetime.signal);
      return request('/api/endpoint-tools/principals', { principalId: identity.data.principalId, publicKey: identity.data.publicKey, kind: 'desktop', platform: process.platform, displayName: 'xopc Desktop' });
    };
    await registerIdentity();
    if (this.stopped) return;
    const endpointId = `${identity.data.principalId}:${randomUUID()}`;
    const registry = new EndpointToolRegistry([
      ...createDesktopEndpointToolDefinitions(() => ({
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
        clipboard: { readText: async () => clipboard.readText(), writeText: async (text) => { clipboard.writeText(text); return true; } },
        shell: { openExternalUrl: async (url) => { const normalized = normalizeExternalHttpUrl(url); if (!normalized) return { ok: false, error: 'Invalid URL' }; await shell.openExternal(normalized); return { ok: true }; } },
        system: { showEndpointNotification: async (input) => showEndpointNotification(input) },
      })),
      { descriptor: structuredClone(COMPUTER_DESCRIPTOR) as any, execute: async (args, context) => {
        const command = ComputerCommandSchema.parse(args);
        if (this.controlPaused && command.op !== 'status' && command.op !== 'release') throw new Error('COMPUTER_CONTROL_PAUSED');
        return executeComputerCommand(this.broker, command, context);
      } },
    ]);
    const controller = new EndpointToolHostController({ registry,
      getAvailability: () => this.options.window()?.isFocused() ? 'foreground' : 'background', createMessageId: randomUUID,
      confirm: async (request) => {
        if (!this.visible() || request.signal.aborted) return false;
        const t = getComputerMessages(getElectronShellLanguage());
        const answer = await dialog.showMessageBox(this.options.window()!, { type: 'question', message: request.descriptor.title,
          detail: JSON.stringify(request.arguments).slice(0, 4000), buttons: [t.cancel, t.allow], defaultId: 0, cancelId: 0, signal: request.signal });
        return !request.signal.aborted && answer.response === 1;
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
      getWebSocketUrl: () => base.replace('http:', 'ws:') + '/api/realtime/v1/ws',
      createWebSocket: (url) => new WebSocket(url) as unknown as RealtimeWebSocket,
    });
    realtime.setEndpoint({ createHello: async () => {
      // Recheck on reconnect too: an established principal can be revoked while running.
      await registerIdentity();
      if (this.stopped || this.reenrollmentRequired) throw new Error('Desktop endpoint is unavailable');
      const hello: EndpointHelloPayload = { principalId: identity.data.principalId, endpointId, connectionInstanceId: randomUUID(),
        kind: 'desktop', platform: process.platform, displayName: 'xopc Desktop', appVersion: app.getVersion(),
        availability: this.options.window()?.isFocused() ? 'foreground' : 'background', nonce: randomUUID(), signedAt: Date.now(), signature: 'pending', tools: registry.descriptors() };
      hello.signature = sign('sha256', Buffer.from(endpointHelloSigningPayload(hello)), { key: identity.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
      return hello;
    }, onReady: ({ endpointId, turnToken }) => {
      if (this.stopped || this.reenrollmentRequired || this.client !== realtime) return;
      this.claim = { type: 'endpoint', endpointId, token: turnToken }; controller.connect(message => realtime.sendEndpointMessage(message)); },
      onMessage: message => { void controller.handleMessage(message); },
      onDisconnected: () => { this.claim = undefined; controller.disconnect(); void this.broker.stop(); },
    });
    this.client = realtime; this.controller = controller; realtime.connect();
  }
  visibilityChanged(): void { this.controller?.publishAvailability(); if (!this.visible()) void this.broker.stop(); }
  async close(): Promise<void> { this.stopped = true; this.lifetime.abort(); clearTimeout(this.retry); this.client?.disconnect(); this.controller?.disconnect(); await this.broker.dispose(); }
}
