/**
 * Extension browser provider — connects to the xopc Chrome Extension via WebSocket.
 *
 * The xopc process starts a WebSocket server; the Chrome Extension connects as a client.
 * Commands are sent over the WS connection and results are returned asynchronously.
 */

import { createLogger } from '../../utils/logger.js';

const log = createLogger('ExtensionProvider');

// ── Protocol types (mirrored from packages/browser-ext/src/protocol.ts) ──

export type ExtensionAction =
  | 'open' | 'navigate' | 'reload' | 'back' | 'forward' | 'get_url' | 'get_title'
  | 'state' | 'snapshot' | 'screenshot' | 'content'
  | 'evaluate'
  | 'click' | 'type' | 'scroll' | 'wait'
  | 'query_selector' | 'query_selector_all' | 'wait_for_selector'
  | 'mouse_move' | 'mouse_click' | 'mouse_down' | 'mouse_up' | 'mouse_wheel'
  | 'keys' | 'keyboard_type' | 'keyboard_down' | 'keyboard_up' | 'keyboard_insert_text'
  | 'get_bounding_box' | 'get_element_text' | 'get_element_attribute'
  | 'get_elements_count' | 'set_input_files' | 'scroll_into_view'
  | 'set_viewport_size' | 'get_viewport_size'
  | 'network_start' | 'network_events' | 'network_stop'
  | 'dialog'
  | 'get_cookies' | 'set_cookies' | 'clear_cookies'
  | 'close' | 'new_tab' | 'list_tabs'
  | 'cdp'
  | 'ping';

export interface ExtensionCommand {
  id: string;
  action: ExtensionAction;
  tabId?: number;
  args?: Record<string, unknown>;
  timeout?: number;
}

export interface ExtensionResult {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
  durationMs?: number;
}

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
  resolve: (result: ExtensionResult) => void;
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
  private connected = false;
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
      res.end(JSON.stringify({ ok: true, connected: this.connected }));
    });

    this.wss = new WebSocketServer({ server: this.server, path: '/browser-ext' });

    (this.wss as { on: Function }).on('connection', (ws: unknown) => {
      log.info('Chrome Extension connected');
      this.clientWs = ws;
      this.connected = true;

      // Resolve any pending connection waiters
      for (const waiter of this.connectionWaiters) {
        waiter.resolve();
      }
      this.connectionWaiters = [];

      (ws as { on: Function }).on('message', (data: Buffer | string) => {
        this._handleMessage(data.toString());
      });

      (ws as { on: Function }).on('close', () => {
        log.warn('Chrome Extension disconnected');
        this.clientWs = null;
        this.connected = false;
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

  /** Send a command to the extension and wait for the result. */
  async sendCommand(action: ExtensionAction, args?: Record<string, unknown>, options?: { tabId?: number; timeout?: number }): Promise<ExtensionResult> {
    if (!this.connected || !this.clientWs) {
      throw new Error('Extension not connected. Ensure the Chrome Extension is installed and connected.');
    }

    const id = `cmd_${++this.commandCounter}_${Date.now()}`;
    const cmd: ExtensionCommand = {
      id,
      action,
      args,
      tabId: options?.tabId,
      timeout: options?.timeout ?? this.config.commandTimeout,
    };

    return new Promise<ExtensionResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Command timeout: ${action} (${cmd.timeout}ms)`));
      }, cmd.timeout!);

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

  /** Close the Chrome Extension client without stopping the WebSocket server. */
  disconnectClient(): void {
    if (!this.clientWs) return;
    try {
      (this.clientWs as { close: () => void }).close();
    } catch {
      /* */
    }
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
    log.info('Extension provider shut down');
  }

  private _handleMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw);

      // Status events from extension (fire-and-forget, no pending match)
      if (msg.type === 'status') {
        log.debug(msg, 'Extension status');
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
        pending.resolve(msg as ExtensionResult);
      }
    } catch (e) {
      log.error({ err: e }, 'Failed to parse extension message');
    }
  }
}
