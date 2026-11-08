import { ExtensionErrorCode, type ThemeInfo } from '@xopcai/extension-ui-sdk';
import { CapabilityCallSchema, ExtensionCapabilityBindingSchema, type CapabilityDescriptor } from '@xopcai/gateway-contract';
import { z } from 'zod';

import { apiFetch, fetchJson } from '@/lib/fetch';
import { SessionManager } from '@/features/chat/session/session-manager';
import { sendSessionInput } from '@/features/chat/session/send-session-input';
import { apiUrl } from '@/lib/url';
import { showActivity } from '@/stores/activity-store';
import { useThemeStore } from '@/stores/theme-store';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

import { buildThemeInfo } from './theme-bridge';
import { watchLocalAppRun } from './local-app-run-subscription';
import type { AttachmentPrompt, AttachmentSelection } from './attachment-picker';

export type MethodHandler = (extensionId: string, params: unknown) => Promise<unknown>;

const METHOD_PERMISSION_MAP: Record<string, string | null> = {
  'apps.reviewRequest': null,
  'files.pickAttachment': 'capability:xopc.files.read',
  'automation.watchRun': 'capability:xopc.automations.get_run',
  'automation.unwatchRun': null,
  'automation.reviewProposal': 'capability:xopc.automations.propose',
  'ui.navigate': null,
  'ui.reviewPermissions': null,
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
  private releaseBindings = new Map<string, { digest: string; grantRevision?: string; previewSessionId?: string; localApp: boolean; baseUrl: string; namespace: string | undefined }>();
  private requestBudgets = new Map<string, { start: number; count: number; pending: number }>();
  private delegationControllers = new Map<string, AbortController>();
  private runSubscriptions = new Map<string, Map<string, AbortController>>();
  private attachmentRequests = new Set<string>();
  private unsubscribeGateway: () => void;
  private eventSubscribers = new Map<string, Set<(e: { event: string; data?: unknown }) => void>>();
  /** extensionId → conversationIds subscribed for agent stream forwarding */
  private agentStreamSubscriptions = new Map<string, Set<string>>();
  private boundListener = (ev: MessageEvent) => {
    void this.onWindowMessage(ev);
  };

  constructor() {
    window.addEventListener('message', this.boundListener);
    this.unsubscribeGateway = useGatewayStore.subscribe((state, previous) => {
      if (state.baseUrl !== previous.baseUrl || state.conversationId !== previous.conversationId) {
        for (const controller of this.delegationControllers.values()) controller.abort();
        for (const group of this.runSubscriptions.values()) for (const controller of group.values()) controller.abort();
        this.runSubscriptions.clear();
      }
    });
  }

  dispose(): void {
    for (const group of this.runSubscriptions.values()) for (const controller of group.values()) controller.abort();
    this.runSubscriptions.clear();
    this.unsubscribeGateway();
    for (const controller of this.delegationControllers.values()) controller.abort();
    this.delegationControllers.clear();
    window.removeEventListener('message', this.boundListener);
    this.iframes.clear();
    this.handlers.clear();
    this.extensionPermissions.clear();
    this.releaseBindings.clear();
    this.requestBudgets.clear();
    this.eventSubscribers.clear();
    this.agentStreamSubscriptions.clear();
  }

  registerIframe(extensionId: string, iframe: HTMLIFrameElement, permissions: string[], manifestDigest?: string, grantRevision?: string, localApp = false, previewSessionId?: string): void {
    this.delegationControllers.get(extensionId)?.abort();
    this.delegationControllers.set(extensionId, new AbortController());
    const prev = this.iframes.get(extensionId);
    if (prev && prev !== iframe && prev.contentWindow) {
      this.byContentWindow.delete(prev.contentWindow);
    }
    this.iframes.set(extensionId, iframe);
    this.extensionPermissions.set(extensionId, new Set(permissions));
    this.releaseBindings.delete(extensionId);
    if (manifestDigest) {
      const gateway = useGatewayStore.getState();
      this.releaseBindings.set(extensionId, { digest: manifestDigest, grantRevision, previewSessionId, localApp, baseUrl: gateway.baseUrl, namespace: gateway.conversationId });
    }
    this.rememberIframeWindow(extensionId, iframe);
  }

  unregisterIframe(extensionId: string): void {
    for (const subscription of this.runSubscriptions.get(extensionId)?.values() ?? []) subscription.abort();
    this.runSubscriptions.delete(extensionId);
    this.delegationControllers.get(extensionId)?.abort();
    this.delegationControllers.delete(extensionId);
    const iframe = this.iframes.get(extensionId);
    this.sendEvent(extensionId, 'panel.dispose');
    if (iframe?.contentWindow) {
      this.byContentWindow.delete(iframe.contentWindow);
    }
    this.iframes.delete(extensionId);
    this.extensionPermissions.delete(extensionId);
    this.releaseBindings.delete(extensionId);
    this.agentStreamSubscriptions.delete(extensionId);
    this.requestBudgets.delete(extensionId);
  }

  private rememberIframeWindow(extensionId: string, iframe: HTMLIFrameElement): void {
    const cw = iframe.contentWindow;
    if (cw) {
      this.byContentWindow.set(cw, { extensionId, iframe });
    }
  }

  subscribeAgentStream(extensionId: string, conversationId: string): void {
    let sessions = this.agentStreamSubscriptions.get(extensionId);
    if (!sessions) {
      sessions = new Set();
      this.agentStreamSubscriptions.set(extensionId, sessions);
    }
    sessions.add(conversationId);
  }

  unsubscribeAgentStream(extensionId: string, conversationId: string): void {
    this.agentStreamSubscriptions.get(extensionId)?.delete(conversationId);
  }

  forwardAgentStreamEvent(conversationId: string, event: unknown): void {
    for (const [extensionId, sessions] of this.agentStreamSubscriptions) {
      if (sessions.has(conversationId)) {
        this.sendEvent(extensionId, `agent.stream.${conversationId}`, event);
      }
    }
  }

  /**
   * Broadcast a fire-and-forget event from one extension to all others (`ext.{name}` on the wire).
   */
  broadcastExtensionEvent(sourceExtensionId: string, bareName: string, data?: unknown): void {
    if (this.releaseBindings.get(sourceExtensionId)?.localApp) return;
    const outbound = bareName.startsWith('ext.') ? bareName : `ext.${bareName}`;
    for (const [extensionId] of this.iframes) {
      if (extensionId !== sourceExtensionId && !this.releaseBindings.get(extensionId)?.localApp) {
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
      const { conversationId } = (data ?? {}) as { conversationId?: string };
      if (typeof conversationId !== 'string' || !conversationId.trim()) return;
      const sk = conversationId.trim();
      if (event === 'agent.subscribe') this.subscribeAgentStream(extensionId, sk);
      else this.unsubscribeAgentStream(extensionId, sk);
    }
  }

  registerMethod(method: string, handler: MethodHandler): void {
    this.handlers.set(method, handler);
  }

  getReleaseDigest(extensionId: string): string {
    const binding = this.releaseBindings.get(extensionId);
    const gateway = useGatewayStore.getState();
    if (!binding || binding.baseUrl !== gateway.baseUrl || binding.namespace !== gateway.conversationId) {
      throw new Error('Extension release authorization is unavailable');
    }
    return binding.digest;
  }

  getGrantRevision(extensionId: string): string | undefined {
    this.getReleaseDigest(extensionId);
    return this.releaseBindings.get(extensionId)?.grantRevision;
  }

  delegationSignal(extensionId: string): AbortSignal {
    this.getReleaseDigest(extensionId);
    const controller = this.delegationControllers.get(extensionId);
    if (!controller) throw new Error('Delegation frame unavailable');
    return controller.signal;
  }

  watchRun(extensionId: string, runId: string): void {
    if (this.isPreview(extensionId)) throw new Error('Run subscriptions are unavailable in previews');
    const manifestDigest = this.getReleaseDigest(extensionId), grantRevision = this.getGrantRevision(extensionId);
    const subscriptions = this.runSubscriptions.get(extensionId) ?? new Map<string, AbortController>();
    if (subscriptions.has(runId)) return;
    if (subscriptions.size >= 4) throw new Error('Close another run subscription first');
    const controller = new AbortController(); subscriptions.set(runId, controller); this.runSubscriptions.set(extensionId, subscriptions);
    const url = apiUrl(`/api/local-app-capabilities/${encodeURIComponent(extensionId)}/runs/${encodeURIComponent(runId)}/events?manifestDigest=${manifestDigest}&grantRevision=${grantRevision ?? ''}`);
    void watchLocalAppRun(url, controller.signal, data => {
      if (!controller.signal.aborted) this.sendEvent(extensionId, `automation.run.${runId}`, data);
    }).finally(() => { if (subscriptions.get(runId) === controller) subscriptions.delete(runId); });
  }

  unwatchRun(extensionId: string, runId: string): void {
    this.runSubscriptions.get(extensionId)?.get(runId)?.abort();
    this.runSubscriptions.get(extensionId)?.delete(runId);
  }

  async pickAttachment(extensionId: string): Promise<AttachmentSelection> {
    if (this.isPreview(extensionId)) throw new Error('Attachment selection is unavailable in previews');
    const manifestDigest = this.getReleaseDigest(extensionId), grantRevision = this.getGrantRevision(extensionId);
    const signal = this.delegationSignal(extensionId);
    const verify = async () => {
      signal.throwIfAborted();
      const [access, review] = await Promise.all([
        fetchJson<{ capabilities: Array<{ id: string }> }>(apiUrl(`/api/local-app-capabilities/${encodeURIComponent(extensionId)}?manifestDigest=${manifestDigest}&grantRevision=${grantRevision ?? ''}`), { signal, cache: 'no-store' }),
        fetchJson<{ grant: { granted: boolean; grantRevision?: string; resourceScopes?: { filesImport?: boolean } } }>(apiUrl(`/api/extensions/${encodeURIComponent(extensionId)}/ui-grant`), { signal, cache: 'no-store' }),
      ]);
      signal.throwIfAborted();
      if (!review.grant.granted || review.grant.grantRevision !== grantRevision || !review.grant.resourceScopes?.filesImport
        || !access.capabilities.some(item => item.id === 'xopc.files.read') || this.getReleaseDigest(extensionId) !== manifestDigest) throw new Error('Attachment import has not been approved');
    };
    await verify();
    if (this.attachmentRequests.has(extensionId)) throw new Error('Close the existing attachment chooser first');
    this.attachmentRequests.add(extensionId);
    return new Promise<AttachmentSelection>((resolve, reject) => {
      let done = false;
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', aborted); this.attachmentRequests.delete(extensionId); };
      const fail = (error: unknown) => { if (done) return; done = true; cleanup(); reject(error); };
      const aborted = () => fail(new Error('Attachment selection authorization ended'));
      const timer = setTimeout(() => fail(new Error('Attachment selection expired')), 120000);
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) { aborted(); return; }
      const prompt: AttachmentPrompt = { extensionId, finish: async selection => {
        if (done) throw new Error('Attachment chooser ended');
        if (!selection) { fail(new Error('Attachment selection canceled')); return; }
        try {
          const file = z.strictObject({ name: z.string().min(1).max(255).regex(/^[^/\\]+$/), mimeType: z.string().max(200),
            size: z.number().int().min(0).max(512 * 1024), encoding: z.literal('base64'), content: z.string().max(750000) }).parse(selection);
          if (atob(file.content).length !== file.size) throw new Error('Attachment size changed');
          await verify(); if (done) throw new Error('Attachment chooser ended');
          done = true; cleanup(); resolve(file);
        } catch (error) { fail(error); throw error; }
      } };
      window.dispatchEvent(new CustomEvent('extension-pick-attachment', { detail: prompt }));
    });
  }

  storageHeaders(extensionId: string): Record<string, string> {
    const revision = this.getGrantRevision(extensionId);
    return { 'X-Xopc-Extension-Manifest': this.getReleaseDigest(extensionId), ...(revision ? { 'X-Xopc-Extension-Grant': revision } : {}) };
  }

  isPreview(extensionId: string): boolean { return Boolean(this.releaseBindings.get(extensionId)?.previewSessionId); }

  async previewRequest(extensionId: string, method: string, params?: unknown): Promise<unknown> {
    this.getReleaseDigest(extensionId);
    const id = this.releaseBindings.get(extensionId)?.previewSessionId;
    if (!id) throw new Error('Preview session unavailable');
    const result = await fetchJson<{ value: unknown }>(apiUrl(`/api/local-app-previews/sessions/${encodeURIComponent(id)}/requests`), {
      method: 'POST', body: JSON.stringify({ method, params }),
    });
    return result.value;
  }

  async whenIdle(extensionId: string): Promise<void> {
    const deadline = Date.now() + 8000;
    do {
      if (!this.iframes.has(extensionId)) throw new Error('Preview frame was replaced');
      if (!this.requestBudgets.get(extensionId)?.pending) {
        await new Promise(resolve => setTimeout(resolve, 0));
        if (!this.requestBudgets.get(extensionId)?.pending) return;
      }
      await new Promise(resolve => setTimeout(resolve, 20));
    } while (Date.now() < deadline);
    throw new Error('Preview initialization did not settle');
  }

  private async assertGrantCurrent(extensionId: string): Promise<void> {
    const binding = this.releaseBindings.get(extensionId);
    if (!binding?.localApp) return;
    if (binding.previewSessionId) {
      const { session } = await fetchJson<{ session: { id: string; sourceHash: string } }>(apiUrl(`/api/local-app-previews/sessions/${encodeURIComponent(binding.previewSessionId)}`));
      if (session.id !== binding.previewSessionId || session.sourceHash !== binding.digest) throw new Error('Preview authorization changed');
      return;
    }
    const { grant } = await fetchJson<{ grant: { granted: boolean; manifestDigest: string; grantRevision: string } }>(apiUrl(`/api/extensions/${encodeURIComponent(extensionId)}/ui-grant`));
    if (!grant.granted || grant.manifestDigest !== binding.digest || grant.grantRevision !== binding.grantRevision) {
      throw new Error('Local app authorization changed; review permissions again');
    }
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

  private postResponse(
    iframe: HTMLIFrameElement,
    event: MessageEvent | undefined,
    requestId: string,
    result?: unknown,
    error?: { code: number; message: string },
  ): void {
    const target = iframe.contentWindow;
    const payload = {
      source: 'xopc-host' as const,
      type: 'response' as const,
      requestId,
      result,
      error,
    };
    if (!target || target !== event?.source) {
      return;
    }
    target.postMessage(payload, '*');
  }

  private async onWindowMessage(event: MessageEvent) {
    const msg = event.data as ExtensionHostMessage | undefined;
    if (!msg || msg.source !== 'xopc-extension') return;

    // Opaque origin does not establish identity. Never trust an iframe-supplied ID.
    if (!event.source) return;
    const registration = this.byContentWindow.get(event.source as Window);
    if (!registration) return;
    const { iframe, extensionId: effectiveExtensionId } = registration;
    if (this.iframes.get(effectiveExtensionId) !== iframe || iframe.contentWindow !== event.source) return;
    try { if (JSON.stringify(msg).length > 2_100_000) return; } catch { return; }
    const budget = this.requestBudgets.get(effectiveExtensionId) ?? { start: Date.now(), count: 0, pending: 0 };
    this.requestBudgets.set(effectiveExtensionId, budget);
    if (Date.now() - budget.start > 60_000) { budget.start = Date.now(); budget.count = 0; }
    if (++budget.count > 120 || budget.pending >= 8) return;

    if (msg.type === 'event') {
      if (typeof msg.event !== 'string' || msg.event.length > 200) return;
      if (msg.event === 'ui.connect') {
        this.sendInit(effectiveExtensionId, buildThemeInfo(useThemeStore.getState().resolved), useLocaleStore.getState().language);
        return;
      }
      if (this.releaseBindings.get(effectiveExtensionId)?.localApp && msg.event !== 'ui.resize') return;
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
    if (typeof requestId !== 'string' || requestId.length > 200 || typeof method !== 'string' || method.length > 200) return;

    const handler = this.handlers.get(method);
    if (!handler) {
      this.postResponse(iframe, event, requestId, undefined, {
        code: ExtensionErrorCode.MethodNotFound,
        message: `Unknown method: ${method}`,
      });
      return;
    }

    const capabilityId = params && typeof params === 'object' && 'id' in params ? params.id : undefined;
    const required = method === 'capability.describe' || method === 'capability.call'
      ? `capability:${typeof capabilityId === 'string' ? capabilityId : ''}` : METHOD_PERMISSION_MAP[method];
    const perms = this.extensionPermissions.get(effectiveExtensionId) ?? new Set<string>();
    if (required === undefined || required && !perms.has(required)) {
      this.postResponse(iframe, event, requestId, undefined, {
        code: ExtensionErrorCode.PermissionDenied,
        message: `Missing permission: ${required}`,
      });
      return;
    }

    const gateway = useGatewayStore.getState();
    const isCurrent = () => this.iframes.get(effectiveExtensionId) === iframe
      && iframe.contentWindow === event.source && this.extensionPermissions.get(effectiveExtensionId) === perms
      && useGatewayStore.getState().baseUrl === gateway.baseUrl
      && useGatewayStore.getState().conversationId === gateway.conversationId;
    try {
      budget.pending++;
      if (msg.method !== 'ui.reviewPermissions') await this.assertGrantCurrent(effectiveExtensionId);
      if (!isCurrent()) return;
      const result = await handler(effectiveExtensionId, params);
      if (msg.method !== 'ui.reviewPermissions') await this.assertGrantCurrent(effectiveExtensionId);
      if (!isCurrent()) return;
      this.postResponse(iframe, event, requestId, result);
    } catch (e) {
      if (!isCurrent()) return;
      const message = e instanceof Error ? e.message : String(e);
      this.postResponse(iframe, event, requestId, undefined, {
        code: ExtensionErrorCode.InternalError,
        message,
      });
    } finally {
      budget.pending--;
    }
  }
}

export function registerBuiltinMethods(router: ExtensionMessageRouter): void {
  router.registerMethod('apps.reviewRequest', async (extensionId, params) => {
    if (router.isPreview(extensionId)) throw new Error('Resource review is unavailable in previews');
    router.getReleaseDigest(extensionId);
    const { requestId } = z.strictObject({ requestId: z.uuid() }).parse(params);
    window.dispatchEvent(new CustomEvent('extension-review-resource-request', { detail: { extensionId, requestId } }));
    return { opened: true };
  });
  router.registerMethod('files.pickAttachment', async (extensionId, params) => {
    z.strictObject({}).parse(params ?? {}); return router.pickAttachment(extensionId);
  });
  router.registerMethod('automation.watchRun', async (extensionId, params) => {
    const { runId } = z.strictObject({ runId: z.uuid() }).parse(params); router.watchRun(extensionId, runId); return { subscribed: true };
  });
  router.registerMethod('automation.unwatchRun', async (extensionId, params) => {
    const { runId } = z.strictObject({ runId: z.uuid() }).parse(params); router.unwatchRun(extensionId, runId); return { unsubscribed: true };
  });
  router.registerMethod('automation.reviewProposal', async (extensionId, params) => {
    if (router.isPreview(extensionId)) throw new Error('Proposal review is unavailable in previews');
    router.getReleaseDigest(extensionId);
    const { proposalId } = z.strictObject({ proposalId: z.uuid() }).parse(params);
    window.dispatchEvent(new CustomEvent('extension-review-automation-proposal', { detail: { extensionId, proposalId } }));
    return { opened: true };
  });
  const describeInput = z.strictObject({ id: ExtensionCapabilityBindingSchema.shape.id });
  const callInput = describeInput.extend({ call: CapabilityCallSchema });
  router.registerMethod('capability.describe', async (extensionId, params) => {
    const { id } = describeInput.parse(params);
    if (router.isPreview(extensionId)) return router.previewRequest(extensionId, 'capability.describe', { id });
    const manifestDigest = router.getReleaseDigest(extensionId);
    const grantRevision = router.getGrantRevision(extensionId);
    const result = await fetchJson<{ capabilities: CapabilityDescriptor[] }>(apiUrl(
      `/api/local-app-capabilities/${encodeURIComponent(extensionId)}?manifestDigest=${encodeURIComponent(manifestDigest)}&grantRevision=${encodeURIComponent(grantRevision ?? '')}`));
    const descriptor = result.capabilities.find(item => item.id === id);
    if (!descriptor) throw new Error('Capability is unavailable for this release');
    return descriptor;
  });
  router.registerMethod('capability.call', async (extensionId, params) => {
    const { id, call } = callInput.parse(params);
    if (router.isPreview(extensionId)) return router.previewRequest(extensionId, 'capability.call', { id, call });
    const manifestDigest = router.getReleaseDigest(extensionId);
    const grantRevision = router.getGrantRevision(extensionId);
    return fetchJson(apiUrl(`/api/local-app-capabilities/${encodeURIComponent(extensionId)}/${encodeURIComponent(id)}/invocations`), {
      method: 'POST', body: JSON.stringify({ manifestDigest, grantRevision, call }),
      ...(id === 'xopc.agent.delegate' || id.startsWith('xopc.connectors.') || id.startsWith('xopc.files.') ? { signal: router.delegationSignal(extensionId) } : {}),
    });
  });
  router.registerMethod('theme.get', async () =>
    buildThemeInfo(useThemeStore.getState().resolved),
  );

  router.registerMethod('ui.navigate', async (extensionId, params) => {
    if (router.isPreview(extensionId)) throw new Error('Host navigation is disabled in preview');
    const path =
      params && typeof params === 'object' && params !== null && 'path' in params
        ? String((params as { path?: string }).path ?? '')
        : '';
    if (path) {
      const normalized = path.startsWith('/') ? path : `/${path}`;
      window.location.hash = `#${normalized}`;
    }
  });
  router.registerMethod('ui.reviewPermissions', async extensionId => {
    if (router.isPreview(extensionId)) throw new Error('Permission review is unavailable in previews');
    router.getReleaseDigest(extensionId);
    window.dispatchEvent(new CustomEvent('extension-review-permissions', { detail: { extensionId } }));
    return { opened: true };
  });

  router.registerMethod('ui.notification', async (extensionId, params) => {
    if (router.isPreview(extensionId)) return;
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
    const conversationId =
      params && typeof params === 'object' && params !== null && 'conversationId' in params
        ? String((params as { conversationId?: string }).conversationId ?? '')
        : '';
    if (conversationId) {
      window.dispatchEvent(
        new CustomEvent('navigate-to-chat', { detail: { conversationId }, bubbles: true }),
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
      conversationId: s.key,
      title: s.name,
      lastMessageAt: s.updatedAt ?? s.lastAccessedAt,
      messageCount: s.messageCount,
    }));
  });

  router.registerMethod('agent.sendMessage', async (_extensionId, params) => {
    const { message, conversationId, newSession } = params as {
      message: string;
      conversationId?: string;
      newSession?: boolean;
    };
    let targetConversationId = conversationId?.trim() || '';
    if (newSession || !targetConversationId) {
      targetConversationId = (await new SessionManager().createSession()).key;
    }
    await sendSessionInput(targetConversationId, message);
    return { conversationId: targetConversationId };
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
    if (router.isPreview(extensionId)) return router.previewRequest(extensionId, 'storage.get', params);
    const key =
      params && typeof params === 'object' && params !== null && 'key' in params
        ? String((params as { key?: string }).key ?? '')
        : '';
    const response = await apiFetch(
      apiUrl(`/api/extensions/${encodeURIComponent(extensionId)}/storage/${encodeURIComponent(key)}`),
      { headers: router.storageHeaders(extensionId) },
    );
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`Failed to get storage key: ${response.status}`);
    const data = (await response.json()) as { value: unknown };
    return data.value;
  });

  router.registerMethod('storage.set', async (extensionId, params) => {
    if (router.isPreview(extensionId)) return router.previewRequest(extensionId, 'storage.set', params);
    const raw = params as { key?: string; value?: unknown } | undefined;
    const key = raw && typeof raw.key === 'string' ? raw.key : '';
    const response = await apiFetch(
      apiUrl(`/api/extensions/${encodeURIComponent(extensionId)}/storage/${encodeURIComponent(key)}`),
      { method: 'PUT', headers: router.storageHeaders(extensionId), body: JSON.stringify({ value: raw?.value }) },
    );
    if (!response.ok) throw new Error(`Failed to set storage key: ${response.status}`);
  });

  router.registerMethod('storage.remove', async (extensionId, params) => {
    if (router.isPreview(extensionId)) return router.previewRequest(extensionId, 'storage.remove', params);
    const key =
      params && typeof params === 'object' && params !== null && 'key' in params
        ? String((params as { key?: string }).key ?? '')
        : '';
    const response = await apiFetch(
      apiUrl(`/api/extensions/${encodeURIComponent(extensionId)}/storage/${encodeURIComponent(key)}`),
      { method: 'DELETE', headers: router.storageHeaders(extensionId) },
    );
    if (response.status === 404) return;
    if (!response.ok) throw new Error(`Failed to remove storage key: ${response.status}`);
  });

  router.registerMethod('storage.keys', async (extensionId) => {
    if (router.isPreview(extensionId)) return router.previewRequest(extensionId, 'storage.keys');
    const response = await apiFetch(apiUrl(`/api/extensions/${encodeURIComponent(extensionId)}/storage`), { headers: router.storageHeaders(extensionId) });
    if (!response.ok) throw new Error(`Failed to list storage keys: ${response.status}`);
    const data = (await response.json()) as { keys?: string[] };
    return data.keys ?? [];
  });
}
