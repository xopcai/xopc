import type {
  ExtensionEventMessage,
  ExtensionRequest,
  HostInit,
  HostResponse,
  HostToExtensionMessage,
} from './types.js';

type PendingRequest = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type TransportOptions = {
  timeout?: number;
};

export class Transport {
  private extensionId = '';
  private pending = new Map<string, PendingRequest>();
  private eventHandlers = new Map<string, Set<(data: unknown) => void>>();
  private initResolve: ((init: HostInit) => void) | null = null;
  private initPromise: Promise<HostInit>;
  private disposed = false;
  private readonly timeout: number;
  private requestCounter = 0;

  constructor(options?: TransportOptions) {
    this.timeout = options?.timeout ?? 10_000;
    this.initPromise = new Promise<HostInit>((resolve) => {
      this.initResolve = resolve;
    });
    window.addEventListener('message', this.handleMessage);
  }

  get ready(): Promise<HostInit> {
    return this.initPromise;
  }

  get id(): string {
    return this.extensionId;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('message', this.handleMessage);
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('Transport disposed'));
    }
    this.pending.clear();
    this.eventHandlers.clear();
  }

  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    await this.initPromise;
    if (this.disposed) {
      throw new Error('Transport disposed');
    }
    const requestId = this.nextRequestId();
    const message: ExtensionRequest = {
      source: 'xopc-extension',
      extensionId: this.extensionId,
      type: 'request',
      requestId,
      method,
      params,
    };
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Request '${method}' timed out after ${this.timeout}ms`));
      }, this.timeout);
      this.pending.set(requestId, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });
      window.parent.postMessage(message, '*');
    });
  }

  emit(event: string, data?: unknown): void {
    if (!this.extensionId || this.disposed) return;
    const message: ExtensionEventMessage = {
      source: 'xopc-extension',
      extensionId: this.extensionId,
      type: 'event',
      event,
      data,
    };
    window.parent.postMessage(message, '*');
  }

  on(event: string, handler: (data: unknown) => void): () => void {
    let set = this.eventHandlers.get(event);
    if (!set) {
      set = new Set();
      this.eventHandlers.set(event, set);
    }
    set.add(handler);
    return () => {
      set!.delete(handler);
      if (set!.size === 0) {
        this.eventHandlers.delete(event);
      }
    };
  }

  private nextRequestId(): string {
    this.requestCounter += 1;
    return `req_${Date.now()}_${this.requestCounter}`;
  }

  private handleMessage = (event: MessageEvent): void => {
    if (this.disposed) return;
    const msg = event.data as HostToExtensionMessage | undefined;
    if (!msg || msg.source !== 'xopc-host') return;

    switch (msg.type) {
      case 'init': {
        this.extensionId = msg.extensionId;
        this.initResolve?.(msg);
        this.initResolve = null;
        return;
      }
      case 'response': {
        const r = msg as HostResponse;
        const pending = this.pending.get(r.requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(r.requestId);
        if (r.error) {
          pending.reject(new Error(r.error.message || `Error ${r.error.code}`));
        } else {
          pending.resolve(r.result);
        }
        return;
      }
      case 'event': {
        const ev = msg as { event: string; data?: unknown };
        const handlers = this.eventHandlers.get(ev.event);
        if (handlers) {
          for (const h of handlers) {
            try {
              h(ev.data);
            } catch {
              /* ignore handler errors */
            }
          }
        }
        return;
      }
      default:
        return;
    }
  };
}
