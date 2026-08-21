import { ExtensionErrorCode, type ThemeInfo } from '@xopcai/extension-ui-sdk';

import { apiFetch } from '@/lib/fetch';
import { waitForEndpointTurnClaim } from '@/features/endpoint-tools/turn-claim';
import { apiUrl } from '@/lib/url';
import { showActivity } from '@/stores/activity-store';
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
  /** Incoming iframe → extensionId (handles contentWindow ready after first register; also disambiguates identity). */
  private byContentWindow = new WeakMap<
    Window,
    { extensionId: string; iframe: HTMLIFrameElement }
  >();
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
    const prev = this.iframes.get(extensionId);
    if (prev && prev !== iframe && prev.contentWindow) {
      this.byContentWindow.delete(prev.contentWindow);
    }
    this.iframes.set(extensionId, iframe);
    this.extensionPermissions.set(extensionId, new Set(permissions));
    this.rememberIframeWindow(extensionId, iframe);
  }

  unregisterIframe(extensionId: string): void {
    const iframe = this.iframes.get(extensionId);
    if (iframe?.contentWindow) {
      this.byContentWindow.delete(iframe.contentWindow);
    }
    this.iframes.delete(extensionId);
    this.extensionPermissions.delete(extensionId);
    this.agentStreamSubscriptions.delete(extensionId);
  }

  private rememberIframeWindow(extensionId: string, iframe: HTMLIFrameElement): void {
    const cw = iframe.contentWindow;
    if (cw) {
      this.byContentWindow.set(cw, { extensionId, iframe });
    }
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
    this.rememberIframeWindow(extensionId, iframe);
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

  /** Prefer `iframe.contentWindow`; if null (rare), fall back to the request's `event.source`. */
  private postResponse(
    iframe: HTMLIFrameElement,
    event: MessageEvent | undefined,
    requestId: string,
    result?: unknown,
    error?: { code: number; message: string },
  ): void {
    const target =
      iframe.contentWindow ??
      (event?.source instanceof Window ? event.source : null);
    const payload = {
      source: 'xopc-host' as const,
      type: 'response' as const,
      requestId,
      result,
      error,
    };
    if (!target) {
      return;
    }
    target.postMessage(payload, '*');
  }

  private isTrustedExtensionSource(iframe: HTMLIFrameElement, ev: MessageEvent): boolean {
    if (ev.source === null) {
      // Sandboxed iframes (no allow-same-origin) may report a null source.
      return true;
    }
    const cw = iframe.contentWindow;
    if (ev.source === cw) {
      return true;
    }
    // Some environments do not keep `===` identity between postMessage `source`
    // and `iframe.contentWindow`; `frameElement` still ties the window to this iframe.
    if (cw && typeof Window !== 'undefined' && ev.source instanceof Window) {
      try {
        return ev.source.frameElement === iframe;
      } catch {
        /* cross-origin access */
      }
    }
    return false;
  }

  private async onWindowMessage(event: MessageEvent) {
    const msg = event.data as ExtensionHostMessage | undefined;
    if (!msg || msg.source !== 'xopc-extension') return;

    let iframe: HTMLIFrameElement | undefined;
    let effectiveExtensionId = msg.extensionId;

    if (event.source instanceof Window) {
      const reg = this.byContentWindow.get(event.source);
      if (reg) {
        iframe = reg.iframe;
        effectiveExtensionId = reg.extensionId;
      }
    }

    if (!iframe) {
      iframe = this.iframes.get(msg.extensionId);
      effectiveExtensionId = msg.extensionId;
    }

    if (!iframe) {
      return;
    }

    const trustedByWindow =
      event.source instanceof Window && this.byContentWindow.has(event.source);

    if (!trustedByWindow && !this.isTrustedExtensionSource(iframe, event)) {
      return;
    }

    if (msg.type === 'event') {
      this.handleExtensionEvent(effectiveExtensionId, msg.event, msg.data);
      const subs = this.eventSubscribers.get(effectiveExtensionId);
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
      this.postResponse(iframe, event, requestId, undefined, {
        code: ExtensionErrorCode.MethodNotFound,
        message: `Unknown method: ${method}`,
      });
      return;
    }

    const required = METHOD_PERMISSION_MAP[method];
    const perms = this.extensionPermissions.get(effectiveExtensionId) ?? new Set<string>();
    if (required && !perms.has(required)) {
      this.postResponse(iframe, event, requestId, undefined, {
        code: ExtensionErrorCode.PermissionDenied,
        message: `Missing permission: ${required}`,
      });
      return;
    }

    try {
      const result = await handler(effectiveExtensionId, params);
      this.postResponse(iframe, event, requestId, result);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.postResponse(iframe, event, requestId, undefined, {
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

  router.registerMethod('ui.notification', async (extensionId, params) => {
    if (!params || typeof params !== 'object') return;
    const raw = params as Record<string, unknown>;
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    if (!title) return;
    const type =
      raw.type === 'success' || raw.type === 'warning' || raw.type === 'error' || raw.type === 'info'
        ? raw.type
        : 'info';
    showActivity({
      tone: type,
      title,
      message: typeof raw.message === 'string' ? raw.message : undefined,
      source: extensionId,
      dedupeKey: `extension:${extensionId}:${title}`,
    });
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
    let targetSessionKey = sessionKey?.trim() || '';
    if (newSession || !targetSessionKey) {
      const createResponse = await apiFetch(apiUrl('/api/sessions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'webchat' }),
      });
      if (!createResponse.ok) throw new Error(`Session create failed: ${createResponse.status}`);
      const created = (await createResponse.json()) as { session?: { key?: string } };
      targetSessionKey = created.session?.key ?? '';
      if (!targetSessionKey) throw new Error('Session create did not return a session key');
    }
    const origin = await waitForEndpointTurnClaim();
    const response = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(targetSessionKey)}/inputs`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientMessageId: crypto.randomUUID(),
        delivery: 'next',
        content: message,
        origin,
      }),
    });
    if (!response.ok) throw new Error(`Agent request failed: ${response.status}`);
    return { sessionKey: targetSessionKey };
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
