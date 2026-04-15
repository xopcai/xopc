import { ExtensionErrorCode, type ThemeInfo } from '@xopcai/extension-ui-sdk';

import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useThemeStore } from '@/stores/theme-store';

import { buildThemeInfo } from './theme-bridge';

export type MethodHandler = (extensionId: string, params: unknown) => Promise<unknown>;

const METHOD_PERMISSION_MAP: Record<string, string | undefined> = {
  'agent.sendMessage': 'agent.send',
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
  /** extensionId → sessionKeys subscribed for agent stream forwarding */
  private agentStreamSubscriptions = new Map<string, Set<string>>();
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
    this.agentStreamSubscriptions.clear();
  }

  registerIframe(extensionId: string, iframe: HTMLIFrameElement, permissions: string[]): void {
    this.iframes.set(extensionId, iframe);
    this.extensionPermissions.set(extensionId, new Set(permissions));
  }

  unregisterIframe(extensionId: string): void {
    this.iframes.delete(extensionId);
    this.extensionPermissions.delete(extensionId);
    this.agentStreamSubscriptions.delete(extensionId);
  }

  subscribeAgentStream(extensionId: string, sessionKey: string): void {
    let sessions = this.agentStreamSubscriptions.get(extensionId);
    if (!sessions) {
      sessions = new Set();
      this.agentStreamSubscriptions.set(extensionId, sessions);
    }
    sessions.add(sessionKey);
  }

  unsubscribeAgentStream(extensionId: string, sessionKey: string): void {
    this.agentStreamSubscriptions.get(extensionId)?.delete(sessionKey);
  }

  forwardAgentStreamEvent(sessionKey: string, event: unknown): void {
    for (const [extensionId, sessions] of this.agentStreamSubscriptions) {
      if (sessions.has(sessionKey)) {
        this.sendEvent(extensionId, `agent.stream.${sessionKey}`, event);
      }
    }
  }

  /**
   * Broadcast a fire-and-forget event from one extension to all others (`ext.{name}` on the wire).
   */
  broadcastExtensionEvent(sourceExtensionId: string, bareName: string, data?: unknown): void {
    const outbound = bareName.startsWith('ext.') ? bareName : `ext.${bareName}`;
    for (const [extensionId] of this.iframes) {
      if (extensionId !== sourceExtensionId) {
        this.sendEvent(extensionId, outbound, data);
      }
    }
  }

  private handleExtensionEvent(extensionId: string, event: string, data: unknown): void {
    if (event.startsWith('ext.')) {
      const rest = event.slice(4);
      this.broadcastExtensionEvent(extensionId, rest, data);
      return;
    }
    if (event === 'agent.subscribe' || event === 'agent.unsubscribe') {
      const perms = this.extensionPermissions.get(extensionId) ?? new Set<string>();
      if (!perms.has('agent.subscribe')) return;
      const { sessionKey } = (data ?? {}) as { sessionKey?: string };
      if (typeof sessionKey !== 'string' || !sessionKey.trim()) return;
      const sk = sessionKey.trim();
      if (event === 'agent.subscribe') this.subscribeAgentStream(extensionId, sk);
      else this.unsubscribeAgentStream(extensionId, sk);
    }
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
      this.handleExtensionEvent(msg.extensionId, msg.event, msg.data);
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

export function registerBuiltinMethods(router: ExtensionMessageRouter): void {
  router.registerMethod('theme.get', async () =>
    buildThemeInfo(useThemeStore.getState().resolved),
  );

  router.registerMethod('ui.navigate', async (_extensionId, params) => {
    const path =
      params && typeof params === 'object' && params !== null && 'path' in params
        ? String((params as { path?: string }).path ?? '')
        : '';
    if (path) {
      window.dispatchEvent(new CustomEvent('extension-navigate', { detail: { path } }));
    }
  });

  router.registerMethod('ui.notification', async (_extensionId, params) => {
    window.dispatchEvent(new CustomEvent('extension-notification', { detail: params }));
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

  router.registerMethod('session.list', async () => {
    const response = await apiFetch(apiUrl('/api/sessions'));
    if (!response.ok) throw new Error(`Failed to list sessions: ${response.status}`);
    const data = (await response.json()) as {
      items?: Array<{
        key: string;
        name?: string;
        updatedAt?: string;
        lastAccessedAt?: string;
        messageCount?: number;
      }>;
    };
    return (data.items ?? []).map((s) => ({
      sessionKey: s.key,
      title: s.name,
      lastMessageAt: s.updatedAt ?? s.lastAccessedAt,
      messageCount: s.messageCount,
    }));
  });

  router.registerMethod('agent.sendMessage', async (_extensionId, params) => {
    const { message, sessionKey, newSession } = params as {
      message: string;
      sessionKey?: string;
      newSession?: boolean;
    };
    const response = await apiFetch(apiUrl('/api/agent'), {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: JSON.stringify({
        message,
        channel: 'webchat',
        sessionKey: newSession ? undefined : sessionKey,
        newSession: Boolean(newSession),
      }),
    });
    if (!response.ok) throw new Error(`Agent request failed: ${response.status}`);
    const data = (await response.json()) as {
      payload?: { sessionKey?: string; key?: string };
      sessionKey?: string;
    };
    const fromPayload = data.payload?.sessionKey ?? data.payload?.key;
    return { sessionKey: fromPayload ?? data.sessionKey ?? sessionKey ?? '' };
  });

  router.registerMethod('config.get', async (extensionId) => {
    const response = await apiFetch(apiUrl(`/api/extensions/${encodeURIComponent(extensionId)}/config`));
    if (!response.ok) throw new Error(`Failed to get config: ${response.status}`);
    return response.json();
  });

  router.registerMethod('config.set', async (extensionId, params) => {
    const patch =
      params && typeof params === 'object' && params !== null && !Array.isArray(params)
        ? (params as Record<string, unknown>)
        : {};
    const response = await apiFetch(apiUrl(`/api/extensions/${encodeURIComponent(extensionId)}/config`), {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    if (!response.ok) throw new Error(`Failed to set config: ${response.status}`);
  });

  router.registerMethod('storage.get', async (extensionId, params) => {
    const key =
      params && typeof params === 'object' && params !== null && 'key' in params
        ? String((params as { key?: string }).key ?? '')
        : '';
    const response = await apiFetch(
      apiUrl(`/api/extensions/${encodeURIComponent(extensionId)}/storage/${encodeURIComponent(key)}`),
    );
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`Failed to get storage key: ${response.status}`);
    const data = (await response.json()) as { value: unknown };
    return data.value;
  });

  router.registerMethod('storage.set', async (extensionId, params) => {
    const raw = params as { key?: string; value?: unknown } | undefined;
    const key = raw && typeof raw.key === 'string' ? raw.key : '';
    const response = await apiFetch(
      apiUrl(`/api/extensions/${encodeURIComponent(extensionId)}/storage/${encodeURIComponent(key)}`),
      { method: 'PUT', body: JSON.stringify({ value: raw?.value }) },
    );
    if (!response.ok) throw new Error(`Failed to set storage key: ${response.status}`);
  });

  router.registerMethod('storage.remove', async (extensionId, params) => {
    const key =
      params && typeof params === 'object' && params !== null && 'key' in params
        ? String((params as { key?: string }).key ?? '')
        : '';
    const response = await apiFetch(
      apiUrl(`/api/extensions/${encodeURIComponent(extensionId)}/storage/${encodeURIComponent(key)}`),
      { method: 'DELETE' },
    );
    if (response.status === 404) return;
    if (!response.ok) throw new Error(`Failed to remove storage key: ${response.status}`);
  });

  router.registerMethod('storage.keys', async (extensionId) => {
    const response = await apiFetch(apiUrl(`/api/extensions/${encodeURIComponent(extensionId)}/storage`));
    if (!response.ok) throw new Error(`Failed to list storage keys: ${response.status}`);
    const data = (await response.json()) as { keys?: string[] };
    return data.keys ?? [];
  });
}
