import {
  RealtimeClient,
  type RealtimeConnectionState,
  type RealtimeWebSocket,
} from '@xopcai/realtime-client';

import {
  createBrowserEndpointHello,
  gatewayFetch,
  getAccessProfile,
  registerBrowserEndpoint,
} from './auth';
import type { BrowserPageContextInput, BrowserTabBinding, BrowserTabBindingMode } from '@xopcai/gateway-contract';
import { activeTabId, currentTabDescriptor, TAB_BINDING_PREFIX } from './page-context';
import type { BrowserAttachment } from './attachments';

const CLIENT_ID_KEY = 'xopc.browser.client-id';
const ACTIVE_CHAT_KEY = 'xopc.browser.active-chat';
const CURSOR_PREFIX = 'xopc.browser.cursor.';
const OUTBOX_PREFIX = 'xopc.browser.outbox.';
const TAB_SESSION_PREFIX = 'xopc.browser.tab-session.';

export type BrowserChatSession = {
  key: string;
  sessionId?: string;
  title: string;
  updatedAt: string;
};

export type BrowserChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp?: number;
  sourceContexts?: Array<{ kind: 'note' | 'browser_page'; title: string; url?: string; truncated?: boolean }>;
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
  sessions: BrowserChatSession[];
  sessionKey?: string;
  sessionId?: string;
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

type TurnClaim = { endpointId: string; token: string };
type Listener = (snapshot: BrowserChatSnapshot) => void;
type BrowserOutboxRequest = {
  content: string;
  clientMessageId: string;
  delivery: 'next';
  expectedSessionId?: string;
  origin: { type: 'endpoint'; endpointId: string; token: string };
  browserContexts?: BrowserPageContextInput[];
  attachments?: BrowserAttachment[];
};

async function json<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: { message?: string } | string };
  if (!response.ok) {
    const error = body.error;
    throw new Error(typeof error === 'string' ? error : error?.message ?? `Gateway returned ${response.status}`);
  }
  return body;
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
  if (!text) return undefined;
  return {
    id: typeof row.id === 'string' ? row.id : `${row.role}-${index}`,
    role: row.role,
    text,
    ...(typeof row.timestamp === 'number' ? { timestamp: row.timestamp } : {}),
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

function mapClarification(value: unknown, sessionKey: string): BrowserClarification | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const envelope = value as Record<string, unknown>;
  const row = envelope.clarification && typeof envelope.clarification === 'object'
    ? envelope.clarification as Record<string, unknown>
    : envelope;
  if (row.status !== 'open' || row.sessionKey !== sessionKey
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
  private snapshot: BrowserChatSnapshot = {
    connection: 'idle',
    endpointReady: false,
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
    await registerBrowserEndpoint();
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
        ...(error ? { error } : {}),
      }),
      onEvent: (event) => { void this.onRealtimeEvent(event.topic, event.seq, event.event, event.data); },
      onGap: async ({ topic }) => {
        if (topic === this.runTopic) await this.reloadMessages();
      },
    });
    this.realtime.setEndpoint({
      createHello: createBrowserEndpointHello,
      onReady: ({ endpointId, turnToken }) => {
        this.turnClaim = { endpointId, token: turnToken };
        this.update({ endpointReady: true, error: undefined });
        void this.recoverOutbox();
      },
      onMessage: () => {},
      onDisconnected: () => {
        this.turnClaim = undefined;
        this.update({ endpointReady: false });
      },
    });
    this.realtime.subscribe('gateway');
    this.realtime.subscribe('sessions');
    this.realtime.connect();
    await Promise.all([this.loadSessions(), this.loadModels()]);
    const tabId = await activeTabId();
    const tabKey = tabId === undefined ? undefined : `${TAB_SESSION_PREFIX}${tabId}`;
    const stored = await chrome.storage.session.get([ACTIVE_CHAT_KEY, ...(tabKey ? [tabKey] : [])]);
    const restored = tabKey && typeof stored[tabKey] === 'string'
      ? stored[tabKey]
      : stored[ACTIVE_CHAT_KEY];
    if (typeof restored === 'string') {
      await this.openSession(restored);
    }
  }

  stop(): void {
    this.realtime?.disconnect();
    this.realtime = undefined;
    this.turnClaim = undefined;
    this.update({ endpointReady: false });
  }

  async loadSessions(search?: string): Promise<void> {
    const params = new URLSearchParams({ channel: 'webchat', limit: '30' });
    if (search?.trim()) params.set('search', search.trim());
    const result = await json<{ items?: unknown[] }>(await gatewayFetch(`/api/sessions?${params}`));
    const sessions = (result.items ?? []).flatMap((value): BrowserChatSession[] => {
      if (!value || typeof value !== 'object') return [];
      const row = value as Record<string, unknown>;
      if (typeof row.key !== 'string') return [];
      return [{
        key: row.key,
        ...(typeof row.sessionId === 'string' ? { sessionId: row.sessionId } : {}),
        title: [row.name, row.title, row.displayName].find((item) => typeof item === 'string' && item.trim()) as string || 'New chat',
        updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : '',
      }];
    });
    this.update({ sessions });
  }

  async createSession(): Promise<void> {
    const response = await json<{ session: { key: string; sessionId?: string } }>(await gatewayFetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'webchat', createdSurface: 'browser_extension' }),
    }));
    await this.loadSessions();
    await this.openSession(response.session.key);
  }

  async openSession(sessionKey: string): Promise<void> {
    if (this.runTopic) this.realtime?.unsubscribe(this.runTopic);
    this.runTopic = undefined;
    this.update({ sessionKey, streamingText: '', runId: undefined, clarification: undefined, error: undefined });
    await chrome.storage.session.set({ [ACTIVE_CHAT_KEY]: sessionKey });
    const tabId = await activeTabId();
    if (tabId !== undefined) {
      await chrome.storage.session.set({ [`${TAB_SESSION_PREFIX}${tabId}`]: sessionKey });
    }
    await this.reloadMessages();
    await this.reloadModelConfig();
    const run = await json<{ payload?: { active?: boolean; runId?: string } }>(await gatewayFetch(
      `/api/sessions/${encodeURIComponent(sessionKey)}/run`,
    ));
    if (run.payload?.active && run.payload.runId) await this.followRun(run.payload.runId);
    await this.reloadClarification();
    await this.reloadTabBinding();
    await this.reloadBrowserApproval();
    if (this.snapshot.endpointReady) await this.recoverOutbox();
  }

  async send(
    content: string,
    browserContexts: BrowserPageContextInput[] = [],
    attachments: BrowserAttachment[] = [],
  ): Promise<void> {
    const text = content.trim();
    if ((!text && attachments.length === 0) || !this.snapshot.sessionKey) return;
    if (!this.turnClaim) throw new Error('Realtime endpoint is not ready');
    const sessionKey = this.snapshot.sessionKey;
    const clientMessageId = crypto.randomUUID();
    const outboxKey = `${OUTBOX_PREFIX}${sessionKey}`;
    const request: BrowserOutboxRequest = {
      content: text,
      clientMessageId,
      delivery: 'next',
      expectedSessionId: this.snapshot.sessionId,
      origin: { type: 'endpoint', endpointId: this.turnClaim.endpointId, token: this.turnClaim.token },
      ...(browserContexts.length ? { browserContexts } : {}),
      ...(attachments.length ? { attachments } : {}),
    };
    await chrome.storage.session.set({ [outboxKey]: request });
    this.update({
      messages: [...this.snapshot.messages, {
        id: clientMessageId,
        role: 'user',
        text: text || `[Attached ${attachments.length} file${attachments.length === 1 ? '' : 's'}]`,
      }],
      streamingText: '',
      error: undefined,
    });
    const response = await json<{ payload: { state: { activeRunId?: string; inputs?: Array<{ clientMessageId?: string; runId?: string }> } } }>(
      await gatewayFetch(`/api/sessions/${encodeURIComponent(sessionKey)}/inputs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      }),
    );
    await chrome.storage.session.remove(outboxKey);
    const runId = response.payload.state.inputs?.find((input) => input.clientMessageId === clientMessageId)?.runId
      ?? response.payload.state.activeRunId
      ?? await this.waitForRun(sessionKey, clientMessageId);
    if (runId) await this.followRun(runId);
    else await this.reloadMessages();
  }

  private async recoverOutbox(): Promise<void> {
    const sessionKey = this.snapshot.sessionKey;
    if (!sessionKey || !this.turnClaim || this.recoveringOutbox) return;
    const outboxKey = `${OUTBOX_PREFIX}${sessionKey}`;
    const stored = await chrome.storage.session.get(outboxKey);
    const pending = stored[outboxKey] as BrowserOutboxRequest | undefined;
    if (!pending?.clientMessageId || typeof pending.content !== 'string') return;
    this.recoveringOutbox = true;
    try {
      const request: BrowserOutboxRequest = {
        ...pending,
        origin: { type: 'endpoint', endpointId: this.turnClaim.endpointId, token: this.turnClaim.token },
      };
      const response = await json<{
        payload: { state: { activeRunId?: string; inputs?: Array<{ clientMessageId?: string; runId?: string }> } };
      }>(await gatewayFetch(`/api/sessions/${encodeURIComponent(sessionKey)}/inputs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      }));
      await chrome.storage.session.remove(outboxKey);
      const runId = response.payload.state.inputs?.find((input) => input.clientMessageId === request.clientMessageId)?.runId
        ?? response.payload.state.activeRunId
        ?? await this.waitForRun(sessionKey, request.clientMessageId);
      if (runId) await this.followRun(runId);
      else await this.reloadMessages();
    } catch (cause) {
      this.update({ error: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      this.recoveringOutbox = false;
    }
  }

  async abort(): Promise<void> {
    if (!this.snapshot.runId) return;
    await json(await gatewayFetch('/api/agent/abort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: this.snapshot.runId }),
    }));
  }

  async updateModel(model: string): Promise<void> {
    const sessionKey = this.snapshot.sessionKey;
    const current = this.snapshot.modelConfig;
    if (!sessionKey || !current || current.fixedModel) return;
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
    const sessionKey = this.snapshot.sessionKey;
    if (!sessionKey || !this.turnClaim) throw new Error('Open a chat and wait for the browser endpoint');
    const descriptor = await currentTabDescriptor();
    const result = await json<{ payload: BrowserTabBinding }>(await gatewayFetch(
      `/api/browser/tab-bindings/${encodeURIComponent(sessionKey)}`,
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
    if (this.snapshot.tabBinding) {
      await chrome.storage.session.remove(`${TAB_BINDING_PREFIX}${this.snapshot.tabBinding.id}`);
    }
    await chrome.storage.session.set({ [`${TAB_BINDING_PREFIX}${result.payload.id}`]: result.payload });
    this.update({ tabBinding: result.payload });
  }

  async unbindActiveTab(): Promise<void> {
    const sessionKey = this.snapshot.sessionKey;
    const binding = this.snapshot.tabBinding;
    if (!sessionKey) return;
    await json(await gatewayFetch(`/api/browser/tab-bindings/${encodeURIComponent(sessionKey)}`, { method: 'DELETE' }));
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

  private async waitForRun(sessionKey: string, clientMessageId: string): Promise<string | undefined> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const state = await json<{ payload: { activeRunId?: string; inputs?: Array<{ clientMessageId?: string; runId?: string }> } }>(
        await gatewayFetch(`/api/sessions/${encodeURIComponent(sessionKey)}/input-state`),
      );
      const runId = state.payload.inputs?.find((input) => input.clientMessageId === clientMessageId)?.runId
        ?? state.payload.activeRunId;
      if (runId) return runId;
      if (!state.payload.inputs?.some((input) => input.clientMessageId === clientMessageId)) return undefined;
    }
    return undefined;
  }

  private async followRun(runId: string): Promise<void> {
    if (this.runTopic) this.realtime?.unsubscribe(this.runTopic);
    this.runTopic = `run:${runId}`;
    const stored = await chrome.storage.session.get(`${CURSOR_PREFIX}${runId}`);
    const cursor = typeof stored[`${CURSOR_PREFIX}${runId}`] === 'number'
      ? stored[`${CURSOR_PREFIX}${runId}`]
      : undefined;
    this.realtime?.subscribe(this.runTopic, cursor);
    this.update({ runId });
  }

  private async onRealtimeEvent(topic: string, seq: number, event: string, data: unknown): Promise<void> {
    if (topic === 'gateway') {
      if (event === 'clarification.updated') {
        const sessionKey = this.snapshot.sessionKey;
        if (sessionKey && data && typeof data === 'object'
          && (data as Record<string, unknown>).sessionKey === sessionKey) {
          this.update({ clarification: mapClarification(data, sessionKey) });
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
      await this.reloadMessages();
      this.update({ runId: undefined, streamingText: '' });
    }
  }

  private async reloadMessages(): Promise<void> {
    const sessionKey = this.snapshot.sessionKey;
    if (!sessionKey) return;
    const result = await json<{
      payload: { messages?: unknown[] };
    }>(await gatewayFetch(`/api/sessions/${encodeURIComponent(sessionKey)}/messages?limit=200`));
    const messages = (result.payload.messages ?? []).flatMap((value, index) => {
      const message = mapMessage(value, index);
      return message ? [message] : [];
    });
    const session = this.snapshot.sessions.find((candidate) => candidate.key === sessionKey);
    this.update({ messages, sessionId: session?.sessionId });
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
    const sessionKey = this.snapshot.sessionKey;
    if (!sessionKey) return;
    const result = await json<{ payload?: Record<string, unknown> }>(await gatewayFetch(
      `/api/sessions/${encodeURIComponent(sessionKey)}/agent-config`,
    ));
    const config = result.payload;
    if (!config || typeof config.model !== 'string' || typeof config.thinkingLevel !== 'string') {
      throw new Error('Gateway returned an invalid session model configuration');
    }
    this.update({ modelConfig: {
      model: config.model,
      thinkingLevel: config.thinkingLevel,
      ...(typeof config.configVersion === 'number' ? { configVersion: config.configVersion } : {}),
      fixedModel: config.fixedModel === true,
    } });
  }

  private async patchModelConfig(patch: { model?: string; thinkingLevel?: string }): Promise<void> {
    const sessionKey = this.snapshot.sessionKey;
    const current = this.snapshot.modelConfig;
    if (!sessionKey || !current) return;
    const result = await json<{ payload?: Record<string, unknown> }>(await gatewayFetch(
      `/api/sessions/${encodeURIComponent(sessionKey)}/agent-config`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...patch, configVersion: current.configVersion }),
      },
    ));
    const config = result.payload;
    if (!config || typeof config.model !== 'string' || typeof config.thinkingLevel !== 'string') {
      throw new Error('Gateway returned an invalid session model configuration');
    }
    this.update({ modelConfig: {
      model: config.model,
      thinkingLevel: config.thinkingLevel,
      ...(typeof config.configVersion === 'number' ? { configVersion: config.configVersion } : {}),
      fixedModel: config.fixedModel === true,
    } });
  }

  private async reloadClarification(): Promise<void> {
    const sessionKey = this.snapshot.sessionKey;
    if (!sessionKey) return;
    const result = await json<{ payload: unknown }>(await gatewayFetch(
      `/api/sessions/${encodeURIComponent(sessionKey)}/clarification`,
    ));
    if (this.snapshot.sessionKey === sessionKey) {
      this.update({ clarification: mapClarification(result.payload, sessionKey) });
    }
  }

  private async reloadTabBinding(): Promise<void> {
    const sessionKey = this.snapshot.sessionKey;
    if (!sessionKey) return;
    const response = await gatewayFetch(`/api/browser/tab-bindings/${encodeURIComponent(sessionKey)}`);
    if (response.status === 404) {
      this.update({ tabBinding: undefined });
      return;
    }
    const result = await json<{ payload: BrowserTabBinding }>(response);
    await chrome.storage.session.set({ [`${TAB_BINDING_PREFIX}${result.payload.id}`]: result.payload });
    this.update({ tabBinding: result.payload });
  }

  private async reloadBrowserApproval(): Promise<void> {
    const sessionKey = this.snapshot.sessionKey;
    if (!sessionKey || !this.snapshot.tabBinding) {
      this.update({ browserApproval: undefined });
      return;
    }
    const result = await json<{ approvals: BrowserApproval[] }>(await gatewayFetch(
      `/api/browser/approvals?sessionKey=${encodeURIComponent(sessionKey)}`,
    ));
    this.update({ browserApproval: result.approvals.find((approval) => approval.status === 'pending') });
  }

  private requireProfileUrl(): string {
    const profile = this.profileUrl;
    if (!profile) throw new Error('Gateway profile is not loaded');
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
