/**
 * Extension browser provider — connects to the xopc Chrome Extension via WebSocket.
 *
 * The xopc process starts a WebSocket server; the Chrome Extension connects as a client.
 * Commands are sent over the WS connection and results are returned asynchronously.
 */

import {
  BROWSER_EXTENSION_PROTOCOL_VERSION,
  type BrowserActionInput,
  type BrowserExtensionStatus,
  type BrowserWireCommand,
  type BrowserWireResult,
} from '@xopcai/browser-control-contract';

import { createLogger } from '../../utils/logger.js';

const log = createLogger('ExtensionProvider');

// ── Configuration ────────────────────────────────────────────────────

export interface ExtensionProviderConfig {
  /** WebSocket server port. Default: 19820. */
  port?: number;
  /** Host to bind. Default: 127.0.0.1. */
  host?: string;
  /** Timeout waiting for extension connection (ms). Default: 30000. */
  connectionTimeout?: number;
  /** Default command timeout (ms). Default: 30000. */
  commandTimeout?: number;
}

const DEFAULT_PORT = 19820;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_CONNECTION_TIMEOUT = 30_000;
const DEFAULT_COMMAND_TIMEOUT = 30_000;

// ── Provider ─────────────────────────────────────────────────────────

interface PendingRequest {
  resolve: (result: BrowserWireResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Manages a WebSocket server that the Chrome Extension connects to.
 * Sends commands and receives results over the connection.
 */
export class ExtensionBrowserProvider {
  readonly name = 'extension';

  private server: import('http').Server | null = null;
  private wss: unknown = null; // WebSocketServer instance
  private clientWs: unknown = null; // connected client WebSocket
  private pending = new Map<string, PendingRequest>();
  private commandCounter = 0;
  private socketConnected = false;
  private handshakeReceived = false;
  private connected = false;
  private extensionProtocolVersion: number | null = null;
  private extensionVersion: string | null = null;
  private readonly config: Required<ExtensionProviderConfig>;
  private connectionWaiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];

  constructor(config?: ExtensionProviderConfig) {
    this.config = {
      port: config?.port ?? DEFAULT_PORT,
      host: config?.host ?? DEFAULT_HOST,
      connectionTimeout: config?.connectionTimeout ?? DEFAULT_CONNECTION_TIMEOUT,
      commandTimeout: config?.commandTimeout ?? DEFAULT_COMMAND_TIMEOUT,
    };
  }

  /** Start the WebSocket server and wait for the extension to connect. */
  async start(): Promise<void> {
    if (this.server) return;

    // Handle CJS/ESM interop: tsx wraps CJS modules so WebSocketServer may need `.default`
    const wsModule: Record<string, unknown> = await import('ws') as never;
    let WssClass = wsModule.WebSocketServer;
    if (typeof WssClass !== 'function') {
      const def = wsModule.default as Record<string, unknown> | undefined;
      WssClass = def?.WebSocketServer ?? def;
    }
    if (typeof WssClass !== 'function') {
      throw new Error('Failed to resolve WebSocketServer from "ws" package');
    }
    const WebSocketServer = WssClass as unknown as new (opts: Record<string, unknown>) => unknown;
    const http = await import('node:http');

    this.server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...this.getConnectionStatus() }));
    });

    this.wss = new WebSocketServer({ server: this.server, path: '/browser-ext' });

    (this.wss as { on: Function }).on('connection', (ws: unknown) => {
      log.info('Chrome Extension connected');
      const previousClient = this.clientWs;
      this.clientWs = ws;
      this.socketConnected = true;
      this.handshakeReceived = false;
      this.connected = false;
      this.extensionProtocolVersion = null;
      this.extensionVersion = null;

      if (previousClient && previousClient !== ws) {
        try { (previousClient as { close: Function }).close(); } catch { /* */ }
      }

      (ws as { on: Function }).on('message', (data: Buffer | string) => {
        this._handleMessage(data.toString(), ws);
      });

      (ws as { on: Function }).on('close', () => {
        if (this.clientWs !== ws) return;
        log.warn('Chrome Extension disconnected');
        this.clientWs = null;
        this.socketConnected = false;
        this.handshakeReceived = false;
        this.connected = false;
        this.extensionProtocolVersion = null;
        this.extensionVersion = null;
        // Reject all pending requests
        for (const [id, req] of this.pending) {
          clearTimeout(req.timer);
          req.reject(new Error('Extension disconnected'));
          this.pending.delete(id);
        }
      });
    });

    const wssEmitter = this.wss as import('node:events').EventEmitter;

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const disposeFailedStart = async () => {
        if (this.wss) {
          try {
            (this.wss as { close: (cb?: () => void) => void }).close();
          } catch {
            /* */
          }
          this.wss = null;
        }
        if (this.server) {
          await new Promise<void>((r) => {
            this.server!.close(() => r());
          });
          this.server = null;
        }
      };

      const onStartError = (err: Error) => {
        if (settled) return;
        settled = true;
        this.server!.removeListener('error', onStartError);
        wssEmitter.removeListener('error', onStartError);
        void disposeFailedStart().then(() => reject(err));
      };

      const onListening = () => {
        if (settled) return;
        settled = true;
        this.server!.removeListener('error', onStartError);
        wssEmitter.removeListener('error', onStartError);

        log.info({ port: this.config.port, host: this.config.host }, 'Extension WS server started');

        const onRuntimeError = (err: Error) => {
          log.error({ err }, 'Extension WS bridge runtime error');
        };
        this.server!.on('error', onRuntimeError);
        wssEmitter.on('error', onRuntimeError);

        resolve();
      };

      // `listen` failures may surface on `http.Server` or on `ws` WebSocketServer; only
      // attaching `server.on('error')` leaves `error` on `wss` unhandled (process crash).
      this.server!.on('error', onStartError);
      wssEmitter.on('error', onStartError);
      this.server!.listen(this.config.port, this.config.host, onListening);
    });
  }

  /** Wait for the Chrome Extension to connect. */
  async waitForConnection(timeoutMs?: number): Promise<void> {
    if (this.connected) return;
    if (this.socketConnected && this.handshakeReceived
      && this.extensionProtocolVersion !== BROWSER_EXTENSION_PROTOCOL_VERSION) {
      throw new Error(this.protocolMismatchMessage());
    }

    const timeout = timeoutMs ?? this.config.connectionTimeout;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.connectionWaiters.findIndex(w => w.resolve === resolve);
        if (idx >= 0) this.connectionWaiters.splice(idx, 1);
        reject(new Error(`Extension connection timeout after ${timeout}ms. Is the Chrome Extension installed and enabled?`));
      }, timeout);

      this.connectionWaiters.push({
        resolve: () => { clearTimeout(timer); resolve(); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
    });
  }

  /** Send one Browser Control v2 action to the extension. */
  async send(input: BrowserActionInput, timeoutMs?: number, visualFallback = true): Promise<BrowserWireResult> {
    if (!this.connected || !this.clientWs) {
      const detail = this.socketConnected
        ? this.protocolMismatchMessage()
        : 'Extension not connected. Ensure the Chrome Extension is installed and connected.';
      throw new Error(detail);
    }

    const id = `cmd_${++this.commandCounter}_${Date.now()}`;
    const cmd: BrowserWireCommand = {
      id,
      protocolVersion: BROWSER_EXTENSION_PROTOCOL_VERSION,
      input,
      timeoutMs: timeoutMs ?? this.config.commandTimeout,
      visualFallback,
    };

    return new Promise<BrowserWireResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Browser action timed out: ${input.action} (${cmd.timeoutMs}ms)`));
      }, cmd.timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      try {
        (this.clientWs as { send: Function }).send(JSON.stringify(cmd));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  /** Whether the extension is currently connected. */
  isConnected(): boolean {
    return this.connected;
  }

  getConnectionStatus(): {
    socketConnected: boolean;
    connected: boolean;
    protocolVersion: number | null;
    expectedProtocolVersion: number;
    extensionVersion: string | null;
  } {
    return {
      socketConnected: this.socketConnected,
      connected: this.connected,
      protocolVersion: this.extensionProtocolVersion,
      expectedProtocolVersion: BROWSER_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: this.extensionVersion,
    };
  }

  private protocolMismatchMessage(): string {
    return `Browser extension protocol mismatch (expected ${BROWSER_EXTENSION_PROTOCOL_VERSION}, received ${this.extensionProtocolVersion ?? 'unknown'}). Reload the extension in Chrome.`;
  }

  /** Shutdown the WebSocket server. */
  async shutdown(): Promise<void> {
    // Reject pending waiters
    for (const waiter of this.connectionWaiters) {
      waiter.reject(new Error('Provider shutting down'));
    }
    this.connectionWaiters = [];

    // Reject pending requests
    for (const [id, req] of this.pending) {
      clearTimeout(req.timer);
      req.reject(new Error('Provider shutting down'));
      this.pending.delete(id);
    }

    if (this.clientWs) {
      try { (this.clientWs as { close: Function }).close(); } catch { /* */ }
      this.clientWs = null;
    }

    if (this.wss) {
      try { (this.wss as { close: Function }).close(); } catch { /* */ }
      this.wss = null;
    }

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }

    this.connected = false;
    this.socketConnected = false;
    this.handshakeReceived = false;
    this.extensionProtocolVersion = null;
    this.extensionVersion = null;
    log.info('Extension provider shut down');
  }

  private _handleMessage(raw: string, sourceWs: unknown): void {
    if (sourceWs !== this.clientWs) return;
    try {
      const msg = JSON.parse(raw);

      // Status events from extension (fire-and-forget, no pending match)
      if (msg.type === 'status') {
        const status = msg as Partial<BrowserExtensionStatus>;
        this.handshakeReceived = true;
        this.extensionProtocolVersion = typeof status.protocolVersion === 'number'
          ? status.protocolVersion
          : null;
        this.extensionVersion = typeof status.extensionVersion === 'string'
          ? status.extensionVersion
          : null;
        this.connected = status.protocolVersion === BROWSER_EXTENSION_PROTOCOL_VERSION;
        if (this.connected) {
          for (const waiter of this.connectionWaiters) waiter.resolve();
          this.connectionWaiters = [];
          log.debug(msg, 'Compatible browser extension connected');
        } else {
          const error = new Error(this.protocolMismatchMessage());
          for (const waiter of this.connectionWaiters) waiter.reject(error);
          this.connectionWaiters = [];
          log.warn(
            {
              expectedProtocolVersion: BROWSER_EXTENSION_PROTOCOL_VERSION,
              extensionProtocolVersion: this.extensionProtocolVersion,
              extensionVersion: this.extensionVersion,
            },
            'Browser extension protocol mismatch; reload the extension',
          );
        }
        return;
      }

      // Network events
      if (msg.type === 'network_event') {
        log.debug({ listenerId: msg.listenerId, eventType: msg.eventType }, 'Network event');
        return;
      }

      // Command result
      const id = msg.id as string;
      const pending = this.pending.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
        if (!isBrowserWireResult(msg)) {
          pending.reject(new Error('Browser extension returned an incompatible response. Reload the extension in Chrome.'));
          return;
        }
        pending.resolve(msg);
      }
    } catch (e) {
      log.error({ err: e }, 'Failed to parse extension message');
    }
  }
}

export function isBrowserWireResult(value: unknown): value is BrowserWireResult {
  if (!value || typeof value !== 'object') return false;
  const result = (value as { result?: unknown }).result;
  return typeof (value as { id?: unknown }).id === 'string'
    && Boolean(result)
    && typeof result === 'object'
    && typeof (result as { ok?: unknown }).ok === 'boolean';
}
