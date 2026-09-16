import {
  RealtimeClient,
  type RealtimeConnectionState,
  type RealtimeWebSocket,
} from '@xopcai/realtime-client';
import type { BrowserPageContextInput, BrowserTabBinding, BrowserTabBindingMode } from '@xopcai/gateway-contract';

import { t } from '../i18n';
import {
  gatewayFetch,
  getAccessProfile,
} from './auth';
import type { BrowserAttachment } from './attachments';
import { deleteBrowserOutbox, readBrowserOutbox, writeBrowserOutbox } from './chat-outbox';
import { activeTabId, currentTabDescriptor, TAB_BINDING_PREFIX } from './page-context';

const CLIENT_ID_KEY = 'xopc.browser.client-id';
const ACTIVE_CHAT_KEY = 'xopc.browser.active-chat';
const CURSOR_PREFIX = 'xopc.browser.cursor.';
const TAB_SESSION_PREFIX = 'xopc.browser.tab-session.';

export type BrowserChatSession = {
  key: string;
  transcriptId?: string;
  title: string;
  updatedAt: string;
};

export type BrowserChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp?: number;
  attachments?: BrowserChatAttachment[];
  sourceContexts?: Array<{ kind: 'note' | 'browser_page'; title: string; url?: string; truncated?: boolean }>;
};

export type BrowserChatAttachment = {
  type: 'image' | 'file';
  mimeType?: string;
  name: string;
  size?: number;
};

export type BrowserClarification = {
  id: string;
  kind: 'input' | 'approval';
  question: string;
  choices?: string[];
  suggestedAnswer?: string;
  version: number;
  expiresAt?: number;
};

export type BrowserApproval = {
  id: string;
  risk: 'external_effect' | 'destructive' | 'sensitive' | 'draft' | 'read';
  summary: string;
  status: string;
};

export type BrowserConfiguredModel = {
  id: string;
  name: string;
  thinking?: { mode: string; options?: string[]; default?: string };
};

export type BrowserSessionModelConfig = {
  model: string;
  thinkingLevel: string;
  configVersion?: number;
  fixedModel: boolean;
};

export type BrowserChatSnapshot = {
  connection: RealtimeConnectionState;
  endpointReady: boolean;
  sessionLoading: boolean;
  submitting: boolean;
  stopping: boolean;
  pendingDelivery: boolean;
  queuedInputs?: Array<{ id: string; version: number; content: string }>;
  sessions: BrowserChatSession[];
  conversationId?: string;
  transcriptId?: string;
  messages: BrowserChatMessage[];
  streamingText: string;
  runId?: string;
  clarification?: BrowserClarification;
  tabBinding?: BrowserTabBinding;
  browserApproval?: BrowserApproval;
  models: BrowserConfiguredModel[];
  modelConfig?: BrowserSessionModelConfig;
  error?: string;
};

class GatewayRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'GatewayRequestError';
  }
}

type TurnClaim = { endpointId: string; token: string };
type Listener = (snapshot: BrowserChatSnapshot) => void;
type BrowserOutboxRequest = {
  content: string;
  clientMessageId: string;
  delivery: 'next';
  expectedTranscriptId?: string;
  configVersion?: number;
  origin: { type: 'endpoint'; endpointId: string; token: string };
  browserContexts?: BrowserPageContextInput[];
  attachments?: BrowserAttachment[];
};

async function json<T>(response: Response): Promise<T> {
  const raw = await response.text();
  let body: T & { error?: { message?: string } | string };
  try {
    body = (raw ? JSON.parse(raw) : {}) as T & { error?: { message?: string } | string };
  } catch {
    throw new GatewayRequestError(
      response.ok ? t('errorInvalidGatewayResponse') : t('errorGatewayStatus', String(response.status)),
      response.status,
    );
  }
  if (!response.ok) {
    const error = body.error;
    throw new GatewayRequestError(
      typeof error === 'string' ? error : error?.message ?? t('errorGatewayStatus', String(response.status)),
      response.status,
    );
  }
  return body;
}

function isRetryableDeliveryError(cause: unknown): boolean {
  return !(cause instanceof GatewayRequestError)
    || cause.status === 408
    || cause.status === 429
    || cause.status >= 500;
}

function textContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.flatMap((block) => {
    if (!block || typeof block !== 'object') return [];
    const row = block as Record<string, unknown>;
    return row.type === 'text' && typeof row.text === 'string' ? [row.text] : [];
  }).join('');
}

function mapMessage(value: unknown, index: number): BrowserChatMessage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  if (row.role !== 'user' && row.role !== 'assistant' && row.role !== 'system') return undefined;
  const text = textContent(row.content);
  const attachments = Array.isArray(row.media)
    ? row.media.flatMap((value): BrowserChatAttachment[] => {
        if (!value || typeof value !== 'object') return [];
        const media = value as Record<string, unknown>;
        const mimeType = typeof media.mimeType === 'string' ? media.mimeType : undefined;
        const name = typeof media.name === 'string' && media.name.trim()
          ? media.name.trim()
          : t('attachment');
        return [{
          type: media.type === 'image' || media.type === 'photo' || mimeType?.startsWith('image/')
            ? 'image'
            : 'file',
          name,
          ...(mimeType ? { mimeType } : {}),
          ...(typeof media.size === 'number' && Number.isFinite(media.size) ? { size: media.size } : {}),
        }];
      })
    : [];
  if (!text && !attachments.length) return undefined;
  return {
    id: typeof row.id === 'string' ? row.id : `${row.role}-${index}`,
    role: row.role,
    text,
    ...(typeof row.timestamp === 'number' ? { timestamp: row.timestamp } : {}),
    ...(attachments.length ? { attachments } : {}),
    ...(row.metadata && typeof row.metadata === 'object'
      && Array.isArray((row.metadata as Record<string, unknown>).sourceContexts)
      ? {
          sourceContexts: ((row.metadata as Record<string, unknown>).sourceContexts as unknown[]).flatMap((value) => {
            if (!value || typeof value !== 'object') return [];
            const source = value as Record<string, unknown>;
            if ((source.kind !== 'note' && source.kind !== 'browser_page') || typeof source.title !== 'string') return [];
            return [{
              kind: source.kind,
              title: source.title,
              ...(typeof source.url === 'string' ? { url: source.url } : {}),
              ...(source.truncated === true ? { truncated: true } : {}),
            }];
          }),
        }
      : {}),
  };
}

function mapClarification(value: unknown, conversationId: string): BrowserClarification | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const envelope = value as Record<string, unknown>;
  const row = envelope.clarification && typeof envelope.clarification === 'object'
    ? envelope.clarification as Record<string, unknown>
    : envelope;
  if (row.status !== 'open' || row.conversationId !== conversationId
    || typeof row.id !== 'string' || typeof row.question !== 'string') return undefined;
  const choices = Array.isArray(row.choices)
    ? row.choices.filter((choice): choice is string => typeof choice === 'string' && Boolean(choice.trim()))
    : undefined;
  return {
    id: row.id,
    kind: row.kind === 'approval' ? 'approval' : 'input',
    question: row.question,
    ...(choices?.length ? { choices } : {}),
    ...(typeof row.suggestedAnswer === 'string' ? { suggestedAnswer: row.suggestedAnswer } : {}),
    version: typeof row.version === 'number' ? row.version : 1,
    ...(typeof row.expiresAt === 'number' ? { expiresAt: row.expiresAt } : {}),
  };
}

async function clientId(): Promise<string> {
  const stored = await chrome.storage.local.get(CLIENT_ID_KEY);
  if (typeof stored[CLIENT_ID_KEY] === 'string') return stored[CLIENT_ID_KEY];
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [CLIENT_ID_KEY]: id });
  return id;
}

export class BrowserChatClient {
  private readonly listeners = new Set<Listener>();
  private realtime?: RealtimeClient;
  private turnClaim?: TurnClaim;
  private runTopic?: string;
  private recoveringOutbox = false;
  private sendingInput = false;
  private lastOutboxRecoveryAt = 0;
  private sessionsRequest = 0;
  private inputsRequest = 0;
  private endpointBinding?: string;
  private endpointBindingTask?: Promise<void>;
  private endpointPoll?: ReturnType<typeof setInterval>;
  private readonly onRuntimeMessage = (message: { type?: string; claim?: TurnClaim }) => {
    if (message.type !== 'browser/endpoint-ready' || !message.claim) return;
    this.turnClaim = message.claim;
    this.update({ endpointReady: true, error: undefined });
    void this.bindSessionEndpoint()
      .then(() => this.recoverOutbox())
      .catch((cause) => this.update({ error: cause instanceof Error ? cause.message : String(cause) }));
  };
  private snapshot: BrowserChatSnapshot = {
    connection: 'idle',
    endpointReady: false,
    sessionLoading: false,
    submitting: false,
    stopping: false,
    pendingDelivery: false,
    sessions: [],
    messages: [],
    streamingText: '',
    models: [],
  };

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    await this.prepare();
    chrome.runtime.onMessage.addListener(this.onRuntimeMessage);
    const id = await clientId();
    this.realtime = new RealtimeClient({
      clientId: id,
      clientKind: 'browser_extension',
      getWebSocketUrl: () => {
        const url = new URL(this.requireProfileUrl());
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        url.pathname = '/api/realtime/v1/ws';
        url.search = '';
        url.hash = '';
        return url.toString();
      },
      issueTicket: async (signal) => {
        const response = await gatewayFetch('/api/realtime/tickets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId: id, clientKind: 'browser_extension' }),
          signal,
        });
        const body = await json<{ payload: { ticket: string } }>(response);
        return body.payload.ticket;
      },
      createWebSocket: (url) => new WebSocket(url) as unknown as RealtimeWebSocket,
      onStateChange: (connection, error) => this.update({
        connection,
        ...(connection !== 'connected' ? { endpointReady: false } : {}),
        ...(error ? { error } : connection === 'connected' ? { error: undefined } : {}),
      }),
      onEvent: (event) => { void this.onRealtimeEvent(event.topic, event.seq, event.event, event.data); },
      onGap: async ({ topic }) => {
        if (topic === this.runTopic) await this.reloadMessages();
      },
    });
    this.realtime.subscribe('gateway');
    this.realtime.subscribe('sessions');
    this.realtime.connect();
    await this.refreshEndpointClaim();
    this.endpointPoll = setInterval(() => { void this.refreshEndpointClaim(); }, 1_000);
    await Promise.all([this.loadSessions(), this.loadModels()]);
    const tabId = await activeTabId();
    const tabKey = tabId === undefined ? undefined : `${TAB_SESSION_PREFIX}${tabId}`;
    const stored = await chrome.storage.session.get([ACTIVE_CHAT_KEY, ...(tabKey ? [tabKey] : [])]);
    const restored = tabKey && typeof stored[tabKey] === 'string'
      ? stored[tabKey]
      : stored[ACTIVE_CHAT_KEY];
    if (typeof restored === 'string') {
      try {
        await this.openSession(restored);
      } catch (cause) {
        if (!(cause instanceof GatewayRequestError) || cause.status !== 404) throw cause;
        await chrome.storage.session.remove([ACTIVE_CHAT_KEY, ...(tabKey ? [tabKey] : [])]);
        this.update({
          conversationId: undefined,
          transcriptId: undefined,
          messages: [],
          sessionLoading: false,
          modelConfig: undefined,
          error: undefined,
        });
      }
    }
  }

  stop(): void {
    chrome.runtime.onMessage.removeListener(this.onRuntimeMessage);
    if (this.endpointPoll) clearInterval(this.endpointPoll);
    this.endpointPoll = undefined;
    this.realtime?.disconnect();
    this.realtime = undefined;
    this.turnClaim = undefined;
    this.endpointBinding = undefined;
    this.endpointBindingTask = undefined;
    this.update({ endpointReady: false });
  }

  async reconnect(): Promise<void> {
    this.turnClaim = undefined;
    this.update({ connection: 'reconnecting', endpointReady: false, error: undefined });
    this.realtime?.reconnect();
    const response = await chrome.runtime.sendMessage({ type: 'browser/reconnect' }).catch((cause) => ({
      ok: false,
      error: cause instanceof Error ? cause.message : String(cause),
    })) as { ok?: boolean; error?: string } | undefined;
    if (response?.ok === false) throw new Error(response.error ?? t('errorReconnectEndpoint'));
    await this.refreshEndpointClaim();
  }

  private async refreshEndpointClaim(): Promise<void> {
    const previousEndpointId = this.turnClaim?.endpointId;
    const response = await chrome.runtime.sendMessage({ type: 'browser/get-endpoint-claim' }).catch(() => undefined) as {
      claim?: TurnClaim;
      error?: string;
    } | undefined;
    this.turnClaim = response?.claim;
    this.update({
      endpointReady: Boolean(this.turnClaim),
      ...(response?.error ? { error: response.error } : this.turnClaim ? { error: undefined } : {}),
    });
    if (this.turnClaim?.endpointId !== previousEndpointId) {
      this.endpointBinding = undefined;
      if (this.turnClaim) {
        void this.bindSessionEndpoint()
          .catch((cause) => this.update({ error: cause instanceof Error ? cause.message : String(cause) }));
      }
    }
    if (this.turnClaim && this.snapshot.pendingDelivery) void this.recoverOutbox();
  }

  private async bindSessionEndpoint(): Promise<void> {
    const conversationId = this.snapshot.conversationId;
    const endpointId = this.turnClaim?.endpointId;
    if (!conversationId || !endpointId) return;
    const desired = `${conversationId}\n${endpointId}`;
    if (this.endpointBinding === desired) return;
    if (this.endpointBindingTask) {
      await this.endpointBindingTask;
      if (this.endpointBinding === desired) return;
    }
    const task = json(await gatewayFetch(
      `/api/endpoint-tools/bindings/${encodeURIComponent(conversationId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpointId }),
      },
    )).then(() => {
      if (this.snapshot.conversationId === conversationId && this.turnClaim?.endpointId === endpointId) {
        this.endpointBinding = desired;
      }
    });
    this.endpointBindingTask = task;
    try {
      await task;
    } finally {
      if (this.endpointBindingTask === task) this.endpointBindingTask = undefined;
    }
  }

  async loadSessions(search?: string): Promise<void> {
    const requestId = ++this.sessionsRequest;
    const params = new URLSearchParams({ channel: 'webchat', limit: '30' });
    if (search?.trim()) params.set('search', search.trim());
    const result = await json<{ items?: unknown[] }>(await gatewayFetch(`/api/sessions?${params}`));
    const sessions = (result.items ?? []).flatMap((value): BrowserChatSession[] => {
      if (!value || typeof value !== 'object') return [];
      const row = value as Record<string, unknown>;
      if (typeof row.key !== 'string') return [];
      return [{
        key: row.key,
        ...(typeof row.transcriptId === 'string' ? { transcriptId: row.transcriptId } : {}),
        title: [row.name, row.title, row.displayName].find((item) => typeof item === 'string' && item.trim()) as string || t('newChat'),
        updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : '',
      }];
    });
    if (requestId === this.sessionsRequest) this.update({ sessions });
  }

  async createSession(): Promise<void> {
    const response = await json<{ session: { key: string; transcriptId?: string } }>(await gatewayFetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'webchat', createdSurface: 'browser_extension' }),
    }));
    await this.loadSessions();
    await this.openSession(response.session.key);
  }

  async openSession(conversationId: string): Promise<void> {
    if (this.runTopic) this.realtime?.unsubscribe(this.runTopic);
    this.runTopic = undefined;
    this.update({
      conversationId,
      transcriptId: this.snapshot.sessions.find((candidate) => candidate.key === conversationId)?.transcriptId,
      messages: [],
      streamingText: '',
      runId: undefined,
      stopping: false,
      sessionLoading: true,
      pendingDelivery: false,
      queuedInputs: [],
      clarification: undefined,
      tabBinding: undefined,
      browserApproval: undefined,
      modelConfig: undefined,
      error: undefined,
    });
    await chrome.storage.session.set({ [ACTIVE_CHAT_KEY]: conversationId });
    const tabId = await activeTabId();
    if (tabId !== undefined) {
      await chrome.storage.session.set({ [`${TAB_SESSION_PREFIX}${tabId}`]: conversationId });
    }
    try {
      await Promise.all([
        this.reloadMessages(),
        this.reloadModelConfig(),
        this.reloadClarification(),
        this.reloadTabBinding(),
      ]);
      if (this.snapshot.conversationId !== conversationId) return;
      await this.bindSessionEndpoint();
      if (this.snapshot.conversationId !== conversationId) return;
      const run = await json<{ payload?: { active?: boolean; runId?: string } }>(await gatewayFetch(
        `/api/sessions/${encodeURIComponent(conversationId)}/run`,
      ));
      if (this.snapshot.conversationId !== conversationId) return;
      if (run.payload?.active && run.payload.runId) await this.followRun(run.payload.runId);
      await this.reloadBrowserApproval();
      if (this.snapshot.conversationId !== conversationId) return;
      this.update({ pendingDelivery: Boolean(await readBrowserOutbox<BrowserOutboxRequest>(conversationId)) });
      if (this.snapshot.endpointReady) await this.recoverOutbox();
    } catch (cause) {
      if (this.snapshot.conversationId !== conversationId) return;
      throw cause;
    } finally {
      if (this.snapshot.conversationId === conversationId) {
        await chrome.storage.session.set({ [ACTIVE_CHAT_KEY]: conversationId });
        this.update({ sessionLoading: false });
      }
    }
  }

  get currentConversationId(): string | undefined { return this.snapshot.conversationId; }

  async send(content: string, browserContexts: BrowserPageContextInput[] = [], attachments: BrowserAttachment[] = []): Promise<'sent' | 'queued'> {
    if (this.sendingInput) throw new Error(t('errorWaitQueuedMessage'));
    this.sendingInput = true;
    try { return await this.sendInput(content, browserContexts, attachments); }
    finally { this.sendingInput = false; }
  }

  private async sendInput(
    content: string,
    browserContexts: BrowserPageContextInput[] = [],
    attachments: BrowserAttachment[] = [],
  ): Promise<'sent' | 'queued'> {
    const text = content.trim();
    if (!text && attachments.length === 0) return 'sent';
    if (!this.snapshot.conversationId) throw new Error(t('errorOpenChatBeforeSending'));
    if (this.snapshot.submitting || this.snapshot.pendingDelivery || this.recoveringOutbox) {
      throw new Error(t('errorWaitQueuedMessage'));
    }
    if (!this.turnClaim) throw new Error(t('errorEndpointNotReady'));
    const conversationId = this.snapshot.conversationId;
    await this.bindSessionEndpoint();
    if (this.snapshot.conversationId !== conversationId) throw new Error(t('errorChatChanged'));
    const clientMessageId = crypto.randomUUID();
    const request: BrowserOutboxRequest = {
      content: text,
      clientMessageId,
      delivery: 'next',
      expectedTranscriptId: this.snapshot.transcriptId,
      ...(this.snapshot.modelConfig?.fixedModel ? { configVersion: this.snapshot.modelConfig.configVersion } : {}),
      origin: { type: 'endpoint', endpointId: this.turnClaim.endpointId, token: this.turnClaim.token },
      ...(browserContexts.length ? { browserContexts } : {}),
      ...(attachments.length ? { attachments } : {}),
    };
    const previousMessages = this.snapshot.messages;
    let outboxStored = false;
    let deliveryAccepted = false;
    this.update({ submitting: true, pendingDelivery: false });
    try {
      await writeBrowserOutbox(conversationId, request);
      outboxStored = true;
      this.update({
        messages: this.snapshot.runId ? this.snapshot.messages : [...this.snapshot.messages, {
          id: clientMessageId,
          role: 'user',
          text,
          ...(attachments.length ? {
            attachments: attachments.map((attachment) => ({
              type: attachment.type,
              mimeType: attachment.mimeType,
              name: attachment.name,
              size: attachment.size,
            })),
          } : {}),
        }],
        ...(this.snapshot.runId ? {} : { streamingText: '' }),
        error: undefined,
      });
      const response = await json<{ payload: { state: { activeRunId?: string; inputs?: Array<{ clientMessageId?: string; runId?: string }> } } }>(
        await gatewayFetch(`/api/sessions/${encodeURIComponent(conversationId)}/inputs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        }),
      );
      deliveryAccepted = true;
      await deleteBrowserOutbox(conversationId);
      outboxStored = false;
      if (this.snapshot.conversationId !== conversationId) return 'sent';
      const runId = response.payload.state.inputs?.find((input) => input.clientMessageId === clientMessageId)?.runId
        ?? response.payload.state.activeRunId
        ?? await this.waitForRun(conversationId, clientMessageId);
      if (this.snapshot.conversationId !== conversationId) return 'sent';
      if (runId) await this.followRun(runId);
      else await this.reloadMessages();
      return 'sent';
    } catch (cause) {
      if (deliveryAccepted) {
        if (this.snapshot.conversationId === conversationId) {
          this.update({
            pendingDelivery: false,
            error: t('errorSentStatusUnknown'),
          });
        }
        return 'sent';
      }
      if (outboxStored && isRetryableDeliveryError(cause)) {
        if (this.snapshot.conversationId === conversationId) {
          this.update({ pendingDelivery: true, error: undefined });
        }
        return 'queued';
      }
      if (outboxStored) await deleteBrowserOutbox(conversationId);
      if (this.snapshot.conversationId === conversationId) this.update({ messages: previousMessages });
      throw cause;
    } finally {
      if (this.snapshot.conversationId === conversationId) this.update({ submitting: false });
    }
  }

  private async recoverOutbox(): Promise<void> {
    const conversationId = this.snapshot.conversationId;
    if (!conversationId || !this.turnClaim || this.recoveringOutbox) return;
    if (Date.now() - this.lastOutboxRecoveryAt < 3_000) return;
    const pending = await readBrowserOutbox<BrowserOutboxRequest>(conversationId);
    if (!pending?.clientMessageId || typeof pending.content !== 'string') return;
    this.recoveringOutbox = true;
    this.lastOutboxRecoveryAt = Date.now();
    this.update({ pendingDelivery: true });
    let deliveryAccepted = false;
    try {
      const request: BrowserOutboxRequest = {
        ...pending,
        origin: { type: 'endpoint', endpointId: this.turnClaim.endpointId, token: this.turnClaim.token },
      };
      const response = await json<{
        payload: { state: { activeRunId?: string; inputs?: Array<{ clientMessageId?: string; runId?: string }> } };
      }>(await gatewayFetch(`/api/sessions/${encodeURIComponent(conversationId)}/inputs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      }));
      deliveryAccepted = true;
      await deleteBrowserOutbox(conversationId);
      if (this.snapshot.conversationId !== conversationId) return;
      this.update({ pendingDelivery: false, error: undefined });
      const runId = response.payload.state.inputs?.find((input) => input.clientMessageId === request.clientMessageId)?.runId
        ?? response.payload.state.activeRunId
        ?? await this.waitForRun(conversationId, request.clientMessageId);
      if (this.snapshot.conversationId !== conversationId) return;
      if (runId) await this.followRun(runId);
      else await this.reloadMessages();
    } catch (cause) {
      if (this.snapshot.conversationId === conversationId) {
        if (deliveryAccepted) {
          this.update({
            pendingDelivery: false,
            error: t('errorSentStatusUnknown'),
          });
        } else if (isRetryableDeliveryError(cause)) {
          this.update({ pendingDelivery: true, error: undefined });
        } else {
          await deleteBrowserOutbox(conversationId);
          this.update({
            pendingDelivery: false,
            messages: this.snapshot.messages.filter((message) => message.id !== pending.clientMessageId),
            error: cause instanceof Error ? cause.message : String(cause),
          });
        }
      }
    } finally {
      this.recoveringOutbox = false;
    }
  }

  async refreshInputs(): Promise<void> {
    const requestId = ++this.inputsRequest;
    const conversationId = this.snapshot.conversationId;
    if (!conversationId) return;
    const result = await json<{ payload: { activeRunId?: string; inputs?: Array<{ id: string; version: number; content: string; status: string }> } }>(
      await gatewayFetch(`/api/sessions/${encodeURIComponent(conversationId)}/input-state`),
    );
    if (this.snapshot.conversationId !== conversationId || requestId !== this.inputsRequest) return;
    this.update({ queuedInputs: (result.payload.inputs ?? []).filter(input => input.status === 'queued') });
    if (result.payload.activeRunId !== this.snapshot.runId) {
      await this.reloadMessages();
      if (this.snapshot.conversationId !== conversationId || requestId !== this.inputsRequest) return;
      if (result.payload.activeRunId) await this.followRun(result.payload.activeRunId);
      else {
        if (this.runTopic) this.realtime?.unsubscribe(this.runTopic);
        this.runTopic = undefined;
        this.update({ runId: undefined, streamingText: '', stopping: false });
      }
    }
  }

  async editInput(id: string, version: number, content: string): Promise<void> {
    const key = this.snapshot.conversationId;
    if (!key) return;
    try {
      await json(await gatewayFetch(`/api/sessions/${encodeURIComponent(key)}/inputs/${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version, content }),
      }));
    } finally { if (this.snapshot.conversationId === key) await this.refreshInputs(); }
  }

  async cancelInput(id: string, version: number): Promise<void> {
    const key = this.snapshot.conversationId;
    if (!key) return;
    try {
      await json(await gatewayFetch(`/api/sessions/${encodeURIComponent(key)}/inputs/${encodeURIComponent(id)}?version=${version}`, { method: 'DELETE' }));
      if (this.snapshot.conversationId === key) await this.reloadMessages();
    } finally {
      if (this.snapshot.conversationId === key) await this.refreshInputs();
    }
  }

  async abort(): Promise<void> {
    const runId = this.snapshot.runId;
    if (!runId || this.snapshot.stopping) return;
    this.update({ stopping: true, error: undefined });
    try {
      await json(await gatewayFetch('/api/agent/abort', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId }),
      }));
      await this.reconcileAbortedRun(runId);
    } catch (cause) {
      if (this.snapshot.runId === runId) this.update({ stopping: false });
      throw cause;
    }
  }

  async updateModel(model: string): Promise<void> {
    const conversationId = this.snapshot.conversationId;
    const current = this.snapshot.modelConfig;
    if (!conversationId || !current) return;
    const selected = this.snapshot.models.find((candidate) => candidate.id === model);
    const thinkingLevel = selected?.thinking?.options?.includes(current.thinkingLevel)
      ? current.thinkingLevel
      : selected?.thinking?.default;
    await this.patchModelConfig({ model, thinkingLevel });
  }

  async updateThinking(thinkingLevel: string): Promise<void> {
    if (!this.snapshot.modelConfig) return;
    await this.patchModelConfig({ thinkingLevel });
  }

  async respondToClarification(action: 'answer' | 'agent_decide' | 'cancel', answer?: string): Promise<void> {
    const clarification = this.snapshot.clarification;
    if (!clarification) return;
    await json(await gatewayFetch(`/api/clarifications/${encodeURIComponent(clarification.id)}/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        answer,
        expectedVersion: clarification.version,
        idempotencyKey: crypto.randomUUID(),
      }),
    }));
    await this.reloadClarification();
  }

  async bindActiveTab(mode: BrowserTabBindingMode): Promise<void> {
    const conversationId = this.snapshot.conversationId;
    if (!conversationId || !this.turnClaim) throw new Error(t('errorOpenChatForEndpoint'));
    const descriptor = await currentTabDescriptor();
    const result = await json<{ payload: BrowserTabBinding }>(await gatewayFetch(
      `/api/browser/tab-bindings/${encodeURIComponent(conversationId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpointId: this.turnClaim.endpointId,
          turnToken: this.turnClaim.token,
          ...descriptor,
          mode,
        }),
      },
    ));
    if (this.snapshot.conversationId !== conversationId) return;
    if (this.snapshot.tabBinding) {
      await chrome.storage.session.remove(`${TAB_BINDING_PREFIX}${this.snapshot.tabBinding.id}`);
    }
    await chrome.storage.session.set({ [`${TAB_BINDING_PREFIX}${result.payload.id}`]: result.payload });
    this.update({ tabBinding: result.payload });
  }

  async unbindActiveTab(): Promise<void> {
    const conversationId = this.snapshot.conversationId;
    const binding = this.snapshot.tabBinding;
    if (!conversationId) return;
    await json(await gatewayFetch(`/api/browser/tab-bindings/${encodeURIComponent(conversationId)}`, { method: 'DELETE' }));
    if (this.snapshot.conversationId !== conversationId) return;
    if (binding) await chrome.storage.session.remove(`${TAB_BINDING_PREFIX}${binding.id}`);
    this.update({ tabBinding: undefined });
  }

  async respondToBrowserApproval(decision: 'approved' | 'denied'): Promise<void> {
    const approval = this.snapshot.browserApproval;
    if (!approval) return;
    await json(await gatewayFetch('/api/browser/approvals/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: approval.id, decision }),
    }));
    await this.reloadBrowserApproval();
  }

  private async waitForRun(conversationId: string, clientMessageId: string): Promise<string | undefined> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const state = await json<{ payload: { activeRunId?: string; inputs?: Array<{ clientMessageId?: string; runId?: string }> } }>(
        await gatewayFetch(`/api/sessions/${encodeURIComponent(conversationId)}/input-state`),
      );
      const runId = state.payload.inputs?.find((input) => input.clientMessageId === clientMessageId)?.runId
        ?? state.payload.activeRunId;
      if (runId) return runId;
      if (!state.payload.inputs?.some((input) => input.clientMessageId === clientMessageId)) return undefined;
    }
    return undefined;
  }

  private async followRun(runId: string): Promise<void> {
    const topic = `run:${runId}`;
    if (this.runTopic === topic) return;
    const conversationId = this.snapshot.conversationId;
    if (this.runTopic) this.realtime?.unsubscribe(this.runTopic);
    this.runTopic = topic;
    const stored = await chrome.storage.session.get(`${CURSOR_PREFIX}${runId}`);
    if (this.snapshot.conversationId !== conversationId || this.runTopic !== topic) return;
    const cursor = typeof stored[`${CURSOR_PREFIX}${runId}`] === 'number' ? stored[`${CURSOR_PREFIX}${runId}`] : undefined;
    this.update({ runId, streamingText: '' });
    this.realtime?.subscribe(topic, cursor);
  }

  private async onRealtimeEvent(topic: string, seq: number, event: string, data: unknown): Promise<void> {
    if (topic === 'gateway') {
      if (event === 'clarification.updated') {
        const conversationId = this.snapshot.conversationId;
        if (conversationId && data && typeof data === 'object'
          && (data as Record<string, unknown>).conversationId === conversationId) {
          this.update({ clarification: mapClarification(data, conversationId) });
        }
      }
      if (event === 'browser.approval.required') await this.reloadBrowserApproval();
      return;
    }
    if (topic === 'sessions') {
      await this.loadSessions();
      return;
    }
    if (topic !== this.runTopic) return;
    const runId = topic.slice('run:'.length);
    await chrome.storage.session.set({ [`${CURSOR_PREFIX}${runId}`]: seq });
    const payload = data && typeof data === 'object'
      ? (data as { payload?: Record<string, unknown> }).payload ?? {}
      : {};
    if (event === 'assistant_delta' && typeof payload.delta === 'string') {
      this.update({ streamingText: `${this.snapshot.streamingText}${payload.delta}` });
    }
    if (event === 'run_end' || event === 'error') {
      this.realtime?.unsubscribe(topic);
      this.runTopic = undefined;
      await chrome.storage.session.remove(`${CURSOR_PREFIX}${runId}`);
      try {
        await this.reloadMessages();
      } finally {
        if (topic === this.runTopic || this.snapshot.runId === runId) {
          this.update({ runId: undefined, streamingText: '', stopping: false });
        }
      }
    }
  }

  private async reloadMessages(): Promise<void> {
    const conversationId = this.snapshot.conversationId;
    if (!conversationId) return;
    const result = await json<{
      payload: { messages?: unknown[] };
    }>(await gatewayFetch(`/api/sessions/${encodeURIComponent(conversationId)}/messages?limit=200`));
    const messages = (result.payload.messages ?? []).flatMap((value, index) => {
      const message = mapMessage(value, index);
      return message ? [message] : [];
    });
    if (this.snapshot.conversationId !== conversationId) return;
    const session = this.snapshot.sessions.find((candidate) => candidate.key === conversationId);
    this.update({ messages, transcriptId: session?.transcriptId });
  }

  private async loadModels(): Promise<void> {
    const result = await json<{ payload?: { models?: unknown[] } }>(await gatewayFetch('/api/models'));
    const models = (result.payload?.models ?? []).flatMap((value): BrowserConfiguredModel[] => {
      if (!value || typeof value !== 'object') return [];
      const model = value as Record<string, unknown>;
      if (typeof model.id !== 'string' || typeof model.name !== 'string') return [];
      const thinking = model.thinking && typeof model.thinking === 'object'
        ? model.thinking as Record<string, unknown>
        : undefined;
      return [{
        id: model.id,
        name: model.name,
        ...(thinking && typeof thinking.mode === 'string' ? {
          thinking: {
            mode: thinking.mode,
            ...(Array.isArray(thinking.options)
              ? { options: thinking.options.filter((option): option is string => typeof option === 'string') }
              : {}),
            ...(typeof thinking.default === 'string' ? { default: thinking.default } : {}),
          },
        } : {}),
      }];
    });
    this.update({ models });
  }

  private async reloadModelConfig(): Promise<void> {
    const conversationId = this.snapshot.conversationId;
    if (!conversationId) return;
    const result = await json<{ payload?: Record<string, unknown> }>(await gatewayFetch(
      `/api/sessions/${encodeURIComponent(conversationId)}/agent-config`,
    ));
    const config = result.payload;
    if (!config || typeof config.model !== 'string' || typeof config.thinkingLevel !== 'string') {
      throw new Error(t('errorInvalidModelConfig'));
    }
    if (this.snapshot.conversationId !== conversationId) return;
    this.update({ modelConfig: {
      model: config.model,
      thinkingLevel: config.thinkingLevel,
      ...(typeof config.configVersion === 'number' ? { configVersion: config.configVersion } : {}),
      fixedModel: config.fixedModel === true,
    } });
  }

  private async patchModelConfig(patch: { model?: string; thinkingLevel?: string }): Promise<void> {
    const conversationId = this.snapshot.conversationId;
    const current = this.snapshot.modelConfig;
    if (!conversationId || !current) return;
    const result = await json<{ payload?: Record<string, unknown> }>(await gatewayFetch(
      `/api/sessions/${encodeURIComponent(conversationId)}/agent-config`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...patch, configVersion: current.configVersion }),
      },
    ));
    const config = result.payload;
    if (!config || typeof config.model !== 'string' || typeof config.thinkingLevel !== 'string') {
      throw new Error(t('errorInvalidModelConfig'));
    }
    if (this.snapshot.conversationId !== conversationId) return;
    this.update({ modelConfig: {
      model: config.model,
      thinkingLevel: config.thinkingLevel,
      ...(typeof config.configVersion === 'number' ? { configVersion: config.configVersion } : {}),
      fixedModel: config.fixedModel === true,
    } });
  }

  private async reloadClarification(): Promise<void> {
    const conversationId = this.snapshot.conversationId;
    if (!conversationId) return;
    const result = await json<{ payload: unknown }>(await gatewayFetch(
      `/api/sessions/${encodeURIComponent(conversationId)}/clarification`,
    ));
    if (this.snapshot.conversationId === conversationId) {
      this.update({ clarification: mapClarification(result.payload, conversationId) });
    }
  }

  private async reloadTabBinding(): Promise<void> {
    const conversationId = this.snapshot.conversationId;
    if (!conversationId) return;
    const response = await gatewayFetch(`/api/browser/tab-bindings/${encodeURIComponent(conversationId)}`);
    if (response.status === 404) {
      if (this.snapshot.conversationId === conversationId) this.update({ tabBinding: undefined });
      return;
    }
    const result = await json<{ payload: BrowserTabBinding }>(response);
    if (this.snapshot.conversationId !== conversationId) return;
    await chrome.storage.session.set({ [`${TAB_BINDING_PREFIX}${result.payload.id}`]: result.payload });
    this.update({ tabBinding: result.payload });
  }

  private async reloadBrowserApproval(): Promise<void> {
    const conversationId = this.snapshot.conversationId;
    if (!conversationId || !this.snapshot.tabBinding) {
      this.update({ browserApproval: undefined });
      return;
    }
    const result = await json<{ approvals: BrowserApproval[] }>(await gatewayFetch(
      `/api/browser/approvals?conversationId=${encodeURIComponent(conversationId)}`,
    ));
    if (this.snapshot.conversationId === conversationId) {
      this.update({ browserApproval: result.approvals.find((approval) => approval.status === 'pending') });
    }
  }

  private async reconcileAbortedRun(runId: string): Promise<void> {
    const conversationId = this.snapshot.conversationId;
    if (!conversationId) return;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (this.snapshot.conversationId !== conversationId || this.snapshot.runId !== runId) return;
      const run = await json<{ payload?: { active?: boolean; runId?: string } }>(await gatewayFetch(
        `/api/sessions/${encodeURIComponent(conversationId)}/run`,
      ));
      if (!run.payload?.active || run.payload.runId !== runId) {
        if (this.runTopic) this.realtime?.unsubscribe(this.runTopic);
        this.runTopic = undefined;
        await chrome.storage.session.remove(`${CURSOR_PREFIX}${runId}`);
        try {
          await this.reloadMessages();
        } finally {
          if (this.snapshot.conversationId === conversationId) {
            this.update({ runId: undefined, streamingText: '', stopping: false });
          }
        }
        return;
      }
    }
    if (this.snapshot.runId === runId) this.update({ stopping: false });
  }

  private requireProfileUrl(): string {
    const profile = this.profileUrl;
    if (!profile) throw new Error(t('errorProfileNotLoaded'));
    return profile;
  }

  private profileUrl?: string;

  async prepare(): Promise<void> {
    this.profileUrl = (await getAccessProfile()).gatewayUrl;
  }

  private update(patch: Partial<BrowserChatSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener(this.snapshot));
  }
}
