import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { app, clipboard, dialog, safeStorage, shell, systemPreferences, type BrowserWindow } from 'electron';
import WebSocket from 'ws';
import { EndpointToolHostController, EndpointToolRegistry } from '@xopcai/endpoint-tools-client';
import { createDesktopEndpointToolDefinitions } from '@xopcai/endpoint-tools-client/desktop-tools';
import { endpointHelloSigningPayload, type EndpointHelloPayload, type EndpointTurnClaim } from '@xopcai/endpoint-tools-protocol';
import { RealtimeClient, type RealtimeWebSocket } from '@xopcai/realtime-client';
import { COMPUTER_DESCRIPTOR, ComputerCommandSchema } from '@xopcai/computer-control-contract';
import { ComputerBroker, type ComputerApproval } from '../../src/computer/broker.js';
import { CuaComputerDriver } from './cua-driver.js';
import { showEndpointNotification } from '../ipc/system-settings-ipc.js';
import { MIME_TYPE_BY_EXTENSION } from '../ipc/file-ipc.js';
import { normalizeExternalHttpUrl } from '../external-url.js';
import { writeTextAtomic } from '../../src/infra/write-file-atomic.js';

type Identity = { principalId: string; publicKey: string; encryptedPrivateKey: string };
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
  private readonly lifetime = new AbortController();
  constructor(private readonly options: { connection(): { port: number; token: string } | undefined; window(): BrowserWindow | null }) {
    const binary = app.isPackaged ? join(process.resourcesPath, 'bin', 'cua-driver') : join(app.getAppPath(), '.cache', 'computer-driver', '0.28.2', 'cua-driver');
    this.broker = new ComputerBroker(new CuaComputerDriver(binary, app.isPackaged ? 'ai.xopc.xopc' : 'com.github.Electron'), {
      isVisible: () => this.visible(), requestApproval: (request, signal) => this.approve(request, signal),
    }, { enabled: true });
  }
  private visible(): boolean { const w = this.options.window(); return !!w && !w.isDestroyed() && w.isVisible() && !w.isMinimized(); }
  snapshot() { return { connected: !!this.claim, claim: this.claim, error: this.error, reenrollmentRequired: this.reenrollmentRequired, session: this.broker.snapshot(),
    permissions: { accessibility: process.platform === 'darwin' && systemPreferences.isTrustedAccessibilityClient(false),
      screenRecording: process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'unknown' } }; }
  private async approve(request: ComputerApproval, signal: AbortSignal): Promise<boolean> {
    if (!this.visible() || signal.aborted) return false;
    const detail = request.kind === 'session'
      ? `应用：${request.appId}\n模型：${request.model.modelRef}\n截图接收方：${request.model.origin}\n${request.model.upstreamOrigin ? `平台上游：${request.model.upstreamOrigin}\n` : ''}截图还会经过当前 Gateway。窗口内容可能包含敏感数据。\n有效期最多 15 分钟；关闭窗口即停止。\n随时使用托盘菜单或设置页停止。快捷停止键若注册成功为 Ctrl+Alt+Esc。`
      : `应用：${request.target.appId}\n操作：${JSON.stringify(request.action)}\n只批准本次操作。涉及支付、密码、验证码或安全设置时请取消并手动处理。`;
    const response = await dialog.showMessageBox(this.options.window()!, { type: 'warning', title: 'xopc Computer Use',
      message: request.kind === 'session' ? '允许此任务观察和操作这个应用？' : '确认下一步电脑操作',
      detail, buttons: ['取消', '允许这一次'], defaultId: 0, cancelId: 0, noLink: true, signal });
    return !signal.aborted && this.visible() && response.response === 1;
  }
  async start(): Promise<void> {
    if (this.stopped || this.connecting || this.client || this.reenrollmentRequired) return;
    clearTimeout(this.retry);
    this.connecting = true;
    try { await this.connect(); this.error = undefined; }
    catch {
      if (!this.reenrollmentRequired) this.error = 'Desktop endpoint is not ready. Check the local Gateway and keychain.';
      if (!this.stopped && !this.reenrollmentRequired) this.retry = setTimeout(() => { void this.start(); }, 2000); }
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
      const answer = await dialog.showMessageBox(this.options.window()!, {
        type: 'warning', title: 'xopc Desktop', message: '重新注册此桌面设备？',
        detail: '此设备身份已被撤销。确认后将替换本机设备密钥并重新连接 Gateway，恢复聊天和桌面工具。此操作不会授予应用观察或操作权限；Computer Use 仍需单独授权。',
        buttons: ['取消', '重新注册'], defaultId: 0, cancelId: 0, noLink: true, signal: this.lifetime.signal,
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
    const registerIdentity = () => request('/api/endpoint-tools/principals', { principalId: identity.data.principalId, publicKey: identity.data.publicKey, kind: 'desktop', platform: process.platform, displayName: 'xopc Desktop' });
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
        const abort = () => { void this.broker.stop(); };
        context.signal.addEventListener('abort', abort, { once: true });
        try {
          const result = await this.broker.command(ComputerCommandSchema.parse(args));
          const { frame, ...metadata } = result;
          const content: import('@xopcai/endpoint-tools-protocol').EndpointToolContent[] = [{ type: 'json', value: metadata }];
          if (frame) {
            try { content.push(await context.uploadFile({ name: 'observation.png', mimeType: frame.mimeType, bytes: frame.bytes })); }
            finally { frame.bytes.fill(0); }
          }
          return { content };
        } finally { context.signal.removeEventListener('abort', abort); }
      } },
    ]);
    const controller = new EndpointToolHostController({ registry,
      getAvailability: () => this.options.window()?.isFocused() ? 'foreground' : 'background', createMessageId: randomUUID,
      confirm: async (request) => {
        if (!this.visible() || request.signal.aborted) return false;
        const answer = await dialog.showMessageBox(this.options.window()!, { type: 'question', message: request.descriptor.title,
          detail: JSON.stringify(request.arguments).slice(0, 4000), buttons: ['Cancel', 'Allow once'], defaultId: 0, cancelId: 0, signal: request.signal });
        return !request.signal.aborted && answer.response === 1;
      },
      uploadFile: async (grant, file) => {
        if (!grant || !/^\/api\/endpoint-tools\/invocations\/[^/]+\/files$/.test(grant.path) || file.bytes.length > grant.maxBytes) throw new Error('Invalid upload grant');
        const response = await fetch(`${base}${grant.path}?name=${encodeURIComponent(file.name)}`, { method: 'POST', redirect: 'error',
          headers: { Authorization: headers.Authorization, 'Content-Type': file.mimeType, 'x-endpoint-id': endpointId, 'x-endpoint-upload-token': grant.token },
          body: Buffer.from(file.bytes), signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error('Computer frame upload failed');
        return (await response.json()).payload;
      },
    });
    const clientId = randomUUID();
    const realtime = new RealtimeClient({ clientId, clientKind: 'desktop', createMessageId: randomUUID,
      onStateChange: (state, error) => {
        if (!this.reenrollmentRequired) this.error = state === 'connected' ? undefined : error;
      },
      issueTicket: async (signal) => (await request('/api/realtime/tickets', { clientId, clientKind: 'desktop' }, signal)).payload.ticket,
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
