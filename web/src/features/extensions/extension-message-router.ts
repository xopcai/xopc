import { ExtensionErrorCode, type ThemeInfo } from '@xopcai/extension-ui-sdk';

export type MethodHandler = (extensionId: string, params: unknown) => Promise<unknown>;

const METHOD_PERMISSION_MAP: Record<string, string | undefined> = {
  'agent.sendMessage': 'agent.send',
  'agent.subscribe': 'agent.subscribe',
  'session.list': 'session.read',
  'session.navigate': 'session.read',
  'config.get': 'config.read',
  'config.set': 'config.write',
  'storage.get': 'storage',
  'storage.set': 'storage',
  'storage.remove': 'storage',
  'storage.keys': 'storage',
  'ui.notification': 'notification',
  'ui.navigate': 'theme',
  'theme.get': 'theme',
};

type ExtensionHostMessage =
  | {
      source: 'xopc-extension';
      extensionId: string;
      type: 'request';
      requestId: string;
      method: string;
      params?: unknown;
    }
  | {
      source: 'xopc-extension';
      extensionId: string;
      type: 'event';
      event: string;
      data?: unknown;
    };

export class ExtensionMessageRouter {
  private iframes = new Map<string, HTMLIFrameElement>();
  private handlers = new Map<string, MethodHandler>();
  private extensionPermissions = new Map<string, Set<string>>();
  private eventSubscribers = new Map<string, Set<(e: { event: string; data?: unknown }) => void>>();
  private boundListener = (ev: MessageEvent) => {
    void this.onWindowMessage(ev);
  };

  constructor() {
    window.addEventListener('message', this.boundListener);
  }

  dispose(): void {
    window.removeEventListener('message', this.boundListener);
    this.iframes.clear();
    this.handlers.clear();
    this.extensionPermissions.clear();
    this.eventSubscribers.clear();
  }

  registerIframe(extensionId: string, iframe: HTMLIFrameElement, permissions: string[]): void {
    this.iframes.set(extensionId, iframe);
    this.extensionPermissions.set(extensionId, new Set(permissions));
  }

  unregisterIframe(extensionId: string): void {
    this.iframes.delete(extensionId);
    this.extensionPermissions.delete(extensionId);
  }

  registerMethod(method: string, handler: MethodHandler): void {
    this.handlers.set(method, handler);
  }

  subscribeExtensionEvents(
    extensionId: string,
    fn: (e: { event: string; data?: unknown }) => void,
  ): () => void {
    let subscribers = this.eventSubscribers.get(extensionId);
    if (!subscribers) {
      subscribers = new Set();
      this.eventSubscribers.set(extensionId, subscribers);
    }
    subscribers.add(fn);
    return () => {
      subscribers.delete(fn);
      if (subscribers.size === 0) {
        this.eventSubscribers.delete(extensionId);
      }
    };
  }

  sendInit(extensionId: string, theme: ThemeInfo, locale: string): void {
    const iframe = this.iframes.get(extensionId);
    if (!iframe?.contentWindow) return;
    const permissions = [...(this.extensionPermissions.get(extensionId) ?? [])];
    iframe.contentWindow.postMessage(
      {
        source: 'xopc-host',
        type: 'init',
        extensionId,
        permissions,
        theme,
        locale,
      },
      '*',
    );
  }

  sendEvent(extensionId: string, event: string, data?: unknown): void {
    const iframe = this.iframes.get(extensionId);
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage(
      {
        source: 'xopc-host',
        type: 'event',
        event,
        data,
      },
      '*',
    );
  }

  broadcastEvent(event: string, data?: unknown): void {
    for (const [, iframe] of this.iframes) {
      iframe.contentWindow?.postMessage(
        {
          source: 'xopc-host',
          type: 'event',
          event,
          data,
        },
        '*',
      );
    }
  }

  private postResponse(
    iframe: HTMLIFrameElement,
    requestId: string,
    result?: unknown,
    error?: { code: number; message: string },
  ): void {
    iframe.contentWindow?.postMessage(
      {
        source: 'xopc-host',
        type: 'response',
        requestId,
        result,
        error,
      },
      '*',
    );
  }

  private async onWindowMessage(event: MessageEvent) {
    const msg = event.data as ExtensionHostMessage | undefined;
    if (!msg || msg.source !== 'xopc-extension') return;

    const iframe = this.iframes.get(msg.extensionId);
    if (!iframe || event.source !== iframe.contentWindow) {
      return;
    }

    if (msg.type === 'event') {
      const subs = this.eventSubscribers.get(msg.extensionId);
      if (subs) {
        const payload = { event: msg.event, data: msg.data };
        for (const fn of subs) {
          try {
            fn(payload);
          } catch {
            /* ignore */
          }
        }
      }
      return;
    }

    if (msg.type !== 'request') return;

    const { requestId, method, params } = msg;
    const handler = this.handlers.get(method);
    if (!handler) {
      this.postResponse(iframe, requestId, undefined, {
        code: ExtensionErrorCode.MethodNotFound,
        message: `Unknown method: ${method}`,
      });
      return;
    }

    const required = METHOD_PERMISSION_MAP[method];
    const perms = this.extensionPermissions.get(msg.extensionId) ?? new Set<string>();
    if (required && !perms.has(required)) {
      this.postResponse(iframe, requestId, undefined, {
        code: ExtensionErrorCode.PermissionDenied,
        message: `Missing permission: ${required}`,
      });
      return;
    }

    try {
      const result = await handler(msg.extensionId, params);
      this.postResponse(iframe, requestId, result);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.postResponse(iframe, requestId, undefined, {
        code: ExtensionErrorCode.InternalError,
        message,
      });
    }
  }
}

export function registerBuiltinMethods(
  router: ExtensionMessageRouter,
  getThemeInfo: () => ThemeInfo,
): void {
  router.registerMethod('theme.get', async () => getThemeInfo());

  router.registerMethod('ui.navigate', async (_extensionId, params) => {
    const path =
      params && typeof params === 'object' && params !== null && 'path' in params
        ? String((params as { path?: string }).path ?? '')
        : '';
    if (path) {
      window.dispatchEvent(new CustomEvent('extension-navigate', { detail: { path } }));
    }
  });

  router.registerMethod('session.navigate', async (_extensionId, params) => {
    const sessionKey =
      params && typeof params === 'object' && params !== null && 'sessionKey' in params
        ? String((params as { sessionKey?: string }).sessionKey ?? '')
        : '';
    if (sessionKey) {
      window.dispatchEvent(
        new CustomEvent('navigate-to-chat', { detail: { sessionKey }, bubbles: true }),
      );
    }
  });
}
