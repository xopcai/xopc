import {
  nextTurnSuggestionResponseSchema,
  readClarificationPresentation,
  sessionInputCommandSchema,
  taskDescriptionForDisplay,
  type BrowserPageContextInput,
  type BrowserTabBinding,
  type BrowserTabBindingMode,
  type ClarificationPresentation,
  type ClarificationSubmission,
  type NextTurnSuggestionFeedback,
  type SessionCreation,
  type SessionInputCommand,
} from '@xopcai/gateway-contract';
import {
  RealtimeClient,
  type RealtimeConnectionState,
  type RealtimeWebSocket,
} from '@xopcai/realtime-client';
import { REALTIME_PROTOCOL_VERSION } from '@xopcai/realtime-protocol';

import { extensionLocale, t } from '../i18n';
import {
  gatewayFetch,
  getAccessProfile,
  readProfile,
  type BrowserGatewayIdentity,
} from './auth';
import type { BrowserAttachment } from './attachments';
import { deleteBrowserOutbox, readBrowserOutbox, writeBrowserOutbox } from './chat-outbox';
import {
  normalizeChatMessages,
  type BrowserChatAttachment,
  type BrowserChatMessage,
} from './chat-message-model';
import {
  createStreamingMessage,
  finalizeStreamingMessage,
  reduceRunEvent,
} from './chat-stream-reducer';
import { activeTabId, currentTabDescriptor, TAB_BINDING_PREFIX } from './page-context';

export type { BrowserChatAttachment, BrowserChatMessage } from './chat-message-model';

const CLIENT_ID_KEY = 'xopc.browser.client-id';
const ACTIVE_CHAT_KEY = 'xopc.browser.active-chat';
const CURSOR_PREFIX = 'xopc.browser.cursor.';
const TAB_SESSION_PREFIX = 'xopc.browser.tab-session.';

export type BrowserChatSession = {
  key: string;
  transcriptId?: string;
  title: string;
  updatedAt: string;
  pinned?: boolean;
  agentId?: string;
  messageCount?: number;
  totalTokens?: number;
};

export type BrowserConfiguredAgent = {
  id: string;
  name: string;
  description?: string;
  isDefault: boolean;
  thinkingLevel?: string;
};

export type BrowserNextTurnSuggestion = {
  id: string;
  prompt: string;
  conversationId: string;
  transcriptId: string;
  expiresAt: number;
  impressionId: string;
};

export type BrowserClarification = ClarificationPresentation & {
  id: string;
  kind: 'input' | 'approval';
  question: string;
  version: number;
  expiresAt?: number;
};

export type BrowserConfiguredModel = {
  id: string;
  name: string;
  provider?: string;
  recommended?: boolean;
  contextWindow?: number;
  thinking?: { mode: string; options?: string[]; initialValue?: string };
};

export type BrowserSessionModelConfig = {
  model: string;
  thinkingLevel: string;
  activityDetail: 'off' | 'on' | 'stream';
  configVersion?: number;
  fixedModel: boolean;
};

export type BrowserQueuedInput = {
  id: string;
  version: number;
  content: string;
};

export type BrowserChatSnapshot = {
  connection: RealtimeConnectionState;
  endpointReady: boolean;
  sessionLoading: boolean;
  submitting: boolean;
  stopping: boolean;
  pendingDelivery: boolean;
  queuedInputs?: BrowserQueuedInput[];
  sessions: BrowserChatSession[];
  agents: BrowserConfiguredAgent[];
  selectedAgentId: string;
  conversationId?: string;
  transcriptId?: string;
  isDraftSession?: boolean;
  gatewayUrl?: string;
  messages: BrowserChatMessage[];
  hasMoreHistory?: boolean;
  loadingMoreHistory?: boolean;
  streamingMessage?: BrowserChatMessage;
  runId?: string;
  clarification?: BrowserClarification;
  tabBinding?: BrowserTabBinding;
  nextTurnSuggestion?: BrowserNextTurnSuggestion;
  models: BrowserConfiguredModel[];
  modelConfig?: BrowserSessionModelConfig;
  error?: string;
};

class GatewayRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'GatewayRequestError';
  }
}

type TurnClaim = { endpointId: string; token: string };
type Listener = (snapshot: BrowserChatSnapshot) => void;
type BrowserOutboxRequest =
  | Omit<Extract<SessionInputCommand, { kind: 'start' }>, 'origin'>
  | Omit<Extract<SessionInputCommand, { kind: 'append' }>, 'origin'>;
type BrowserInputStateEntry = {
  id?: string;
  version?: number;
  content?: string;
  status?: string;
  clientMessageId?: string;
  runId?: string;
};
type BrowserInputResponse = {
  payload: {
    receipt: { conversationId: string; transcriptId: string; clientMessageId: string };
    session: { transcriptId?: string };
    agentConfig: BrowserSessionModelConfig;
    inputState: { activeRunId?: string; inputs?: BrowserInputStateEntry[] };
  };
};

type DeliveryScope = {
  identity: BrowserGatewayIdentity;
  draftKey: string;
  inputKey: string;
  assertCurrent(): Promise<void>;
};

async function deliveryScope(
  conversationId: string,
  expected: BrowserGatewayIdentity | undefined,
): Promise<DeliveryScope> {
  if (!expected) throw new Error(t('errorProfileNotLoaded'));
  const profile = await readProfile();
  if (!profile) throw new Error(t('errorEndpointNotReady'));
  if (
    profile.gatewayId !== expected.gatewayId
    || profile.deviceId !== expected.deviceId
    || profile.gatewayPublicKey !== expected.gatewayPublicKey
  ) {
    throw new Error(t('errorChatChanged'));
  }
  const draftKey = `creation:${profile.gatewayId}:${profile.deviceId}:${conversationId}`;
  return {
    identity: profile,
    draftKey,
    inputKey: `input:${draftKey}`,
    async assertCurrent() {
      const current = await readProfile();
      if (
        !current
        || current.gatewayId !== profile.gatewayId
        || current.deviceId !== profile.deviceId
        || current.gatewayPublicKey !== profile.gatewayPublicKey
      ) {
        throw new Error(t('errorChatChanged'));
      }
    },
  };
}

async function draftStorageKey(conversationId: string): Promise<string> {
  const profile = await readProfile();
  if (!profile) throw new Error(t('errorEndpointNotReady'));
  return `creation:${profile.gatewayId}:${profile.deviceId}:${conversationId}`;
}

async function readDraft(conversationId: string): Promise<SessionCreation | undefined> {
  return readBrowserOutbox<SessionCreation>(await draftStorageKey(conversationId));
}

async function inputStorageKey(conversationId: string): Promise<string> {
  return `input:${await draftStorageKey(conversationId)}`;
}

async function json<T>(response: Response): Promise<T> {
  const raw = await response.text();
  let body: T & { error?: { message?: string; code?: string } | string; code?: string };
  try {
    body = (raw ? JSON.parse(raw) : {}) as T & {
      error?: { message?: string; code?: string } | string;
      code?: string;
    };
  } catch {
    throw new GatewayRequestError(
      response.ok ? t('errorInvalidGatewayResponse') : t('errorGatewayStatus', String(response.status)),
      response.status,
    );
  }
  if (!response.ok) {
    const error = body.error;
    const code = typeof error === 'object' && error !== null && typeof error.code === 'string'
      ? error.code
      : typeof body.code === 'string' ? body.code : undefined;
    throw new GatewayRequestError(
      typeof error === 'string' ? error : error?.message ?? t('errorGatewayStatus', String(response.status)),
      response.status,
      code,
    );
  }
  return body;
}

function isRetryableDeliveryError(cause: unknown): boolean {
  return !(cause instanceof GatewayRequestError)
    || (cause.status >= 200 && cause.status < 300)
    || cause.status === 408
    || cause.status === 429
    || cause.status >= 500;
}

function activityDetail(
  config: Record<string, unknown>,
  fallback: 'off' | 'on' | 'stream' = 'on',
): 'off' | 'on' | 'stream' {
  const detail = config.activityDetail && typeof config.activityDetail === 'object'
    ? config.activityDetail as Record<string, unknown>
    : undefined;
  const value = detail?.effective ?? config.reasoningLevel;
  return value === 'off' || value === 'on' || value === 'stream' ? value : fallback;
}

function mapClarification(value: unknown, conversationId: string): BrowserClarification | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const envelope = value as Record<string, unknown>;
  const row = envelope.clarification && typeof envelope.clarification === 'object'
    ? envelope.clarification as Record<string, unknown>
    : envelope;
  if (
    row.status !== 'open'
    || row.conversationId !== conversationId
    || typeof row.id !== 'string'
    || typeof row.question !== 'string'
  ) {
    return undefined;
  }
  return {
    ...readClarificationPresentation(row),
    id: row.id,
    kind: row.kind === 'approval' ? 'approval' : 'input',
    question: row.question,
    version: typeof row.version === 'number' ? row.version : 1,
    ...(typeof row.expiresAt === 'number' ? { expiresAt: row.expiresAt } : {}),
  };
}

function extractQueuedInputs(entries?: BrowserInputStateEntry[]): BrowserQueuedInput[] | undefined {
  if (!Array.isArray(entries)) return undefined;
  return entries.flatMap((entry): BrowserQueuedInput[] => {
    if (entry.status !== 'queued' || typeof entry.id !== 'string' || typeof entry.version !== 'number') {
      return [];
    }
    return [{
      id: entry.id,
      version: entry.version,
      content: typeof entry.content === 'string' ? taskDescriptionForDisplay(entry.content) : '',
    }];
  });
}

function parseSessionInputCommandOrThrow(candidate: unknown): SessionInputCommand {
  const parsed = sessionInputCommandSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const path = issue?.path.join('.') ?? '';
  if (path === 'expectedTranscriptId' || path === 'configVersion') {
    throw new Error(t('errorSessionSyncRequired'));
  }
  if (path === 'creation.model') {
    throw new Error(t('errorSelectModelBeforeSending'));
  }
  throw new Error(issue?.message || t('errorInvalidMessageRequest'));
}

function suggestionLocale(): 'zh' | 'en' {
  return extensionLocale().toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

async function clientId(): Promise<string> {
  const stored = await chrome.storage.local.get(CLIENT_ID_KEY);
  if (typeof stored[CLIENT_ID_KEY] === 'string') return stored[CLIENT_ID_KEY];
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [CLIENT_ID_KEY]: id });
  return id;
}

function extractStreamError(payload: Record<string, unknown>): string {
  const err = payload.error;
  if (typeof err === 'string' && err.trim()) return err.trim();
  if (err && typeof err === 'object' && typeof (err as Record<string, unknown>).message === 'string') {
    const message = ((err as Record<string, unknown>).message as string).trim();
    if (message) return message;
  }
  if (typeof payload.message === 'string' && payload.message.trim()) return payload.message.trim();
  return t('errorRunFailed');
}

function indexAttachmentMediaUris(
  target: Map<string, string>,
  conversationId: string,
  rawRows: readonly unknown[],
): void {
  for (let rowIndex = 0; rowIndex < rawRows.length; rowIndex += 1) {
    const row = rawRows[rowIndex];
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const record = row as Record<string, unknown>;
    if (record.role !== 'user' && record.role !== 'assistant' && record.role !== 'system') continue;
    const messageId = typeof record.id === 'string' ? record.id : `${record.role}:${rowIndex}`;
    const list = [
      ...(Array.isArray(record.media) ? record.media : []),
      ...(Array.isArray(record.attachments) ? record.attachments : []),
    ];
    list.forEach((item, attachmentIndex) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return;
      const entry = item as Record<string, unknown>;
      const uri = typeof entry.uri === 'string' && entry.uri.startsWith('media://') ? entry.uri : undefined;
      if (uri) target.set(`${conversationId}:${messageId}:${attachmentIndex}`, uri);
    });
  }
}

export class BrowserChatClient {
  private readonly listeners = new Set<Listener>();
  private readonly transcriptCache = new Map<string, string>();
  private readonly attachmentMediaUris = new Map<string, string>();
  private readonly attachmentPreviewUrls = new Map<string, string>();
  private readonly objectUrls = new Set<string>();
  private realtime?: RealtimeClient;
  private turnClaim?: TurnClaim;
  private runTopic?: string;
  private historyCursor?: string;
  private recoveringOutbox = false;
  private sendingInput = false;
  private clarificationAttempt?: { signature: string; key: string };
  private lastOutboxRecoveryAt = 0;
  private sessionsRequest = 0;
  private suggestionRequest = 0;
  private defaultModelId?: string;
  private inputsRequest = 0;
  private endpointPoll?: ReturnType<typeof setInterval>;
  private suggestionTimer?: ReturnType<typeof setTimeout>;
  private lastContextPulse = 0;
  private lastSessionSearch = '';
  private readonly onRuntimeMessage = (message: { type?: string; claim?: TurnClaim }) => {
    if (message.type !== 'browser/endpoint-ready' || !message.claim) return;
    this.turnClaim = message.claim;
    this.update({ endpointReady: true, error: undefined });
    void this.recoverOutbox()
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
    agents: [],
    selectedAgentId: 'main',
    messages: [],
    models: [],
  };

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  private transcriptCacheKey(conversationId: string): string {
    return `${this.profileIdentity?.gatewayId ?? ''}:${this.profileIdentity?.deviceId ?? ''}:${conversationId}`;
  }

  private rememberTranscriptId(conversationId: string, transcriptId: string | undefined): void {
    if (!transcriptId) return;
    this.transcriptCache.set(this.transcriptCacheKey(conversationId), transcriptId);
  }

  private rememberedTranscriptId(conversationId: string): string | undefined {
    return this.transcriptCache.get(this.transcriptCacheKey(conversationId));
  }

  private resolveKnownTranscriptId(conversationId: string): string | undefined {
    const fromSnapshot = this.snapshot.conversationId === conversationId ? this.snapshot.transcriptId : undefined;
    const fromSessions = this.snapshot.sessions.find((candidate) => candidate.key === conversationId)?.transcriptId;
    return fromSnapshot || fromSessions || this.rememberedTranscriptId(conversationId);
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
          body: JSON.stringify({ clientId: id, clientKind: 'browser_extension', protocolVersion: REALTIME_PROTOCOL_VERSION }),
          signal,
        });
        const body = await json<{ payload: { ticket: string; realtime: { minVersion: number; maxVersion: number; capabilities: string[] } } }>(response);
        return body.payload;
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
    await this.loadAgents().catch(() => undefined);
    await Promise.all([
      this.loadSessions(),
      this.loadModels(this.snapshot.selectedAgentId),
    ]);
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
          isDraftSession: false,
          messages: [],
          sessionLoading: false,
          modelConfig: undefined,
          nextTurnSuggestion: undefined,
          error: undefined,
        });
      }
    }
  }

  private revokeObjectUrls(): void {
    this.objectUrls.forEach((url) => URL.revokeObjectURL(url));
    this.objectUrls.clear();
    this.attachmentPreviewUrls.clear();
    this.attachmentMediaUris.clear();
  }

  stop(): void {
    void chrome.runtime?.sendMessage?.({ type: 'browser/context-activity', foreground: false })?.catch(() => undefined);
    chrome.runtime?.onMessage?.removeListener?.(this.onRuntimeMessage);
    if (this.endpointPoll) clearInterval(this.endpointPoll);
    if (this.suggestionTimer) clearTimeout(this.suggestionTimer);
    this.endpointPoll = undefined;
    this.suggestionTimer = undefined;
    this.realtime?.disconnect();
    this.realtime = undefined;
    this.turnClaim = undefined;
    this.revokeObjectUrls();
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
    if (!this.snapshot.models.length) {
      void this.loadModels(this.snapshot.selectedAgentId).catch(() => undefined);
    }
    if (!this.snapshot.sessions.length) {
      void this.loadSessions(this.lastSessionSearch).catch(() => undefined);
    }
  }

  private async refreshEndpointClaim(): Promise<void> {
    if (Date.now() - this.lastContextPulse >= 10_000) {
      this.lastContextPulse = Date.now();
      void chrome.runtime.sendMessage({
        type: 'browser/context-activity',
        foreground: typeof document !== 'undefined' && document.visibilityState === 'visible',
      }).catch(() => undefined);
    }
    const response = await chrome.runtime.sendMessage({ type: 'browser/get-endpoint-claim' }).catch(() => undefined) as {
      claim?: TurnClaim;
      error?: string;
    } | undefined;
    this.turnClaim = response?.claim;
    this.update({
      endpointReady: Boolean(this.turnClaim),
      ...(response?.error ? { error: response.error } : this.turnClaim ? { error: undefined } : {}),
    });
    if (this.turnClaim && this.snapshot.pendingDelivery) void this.recoverOutbox();
  }

  async loadAgents(): Promise<void> {
    const result = await json<{ payload?: { defaultId?: string; agents?: unknown[] } }>(
      await gatewayFetch('/api/agents', {}, this.profileIdentity),
    );
    const defaultId = typeof result.payload?.defaultId === 'string' && result.payload.defaultId.trim()
      ? result.payload.defaultId.trim()
      : 'main';
    const agents = (result.payload?.agents ?? []).flatMap((value): BrowserConfiguredAgent[] => {
      if (!value || typeof value !== 'object') return [];
      const row = value as Record<string, unknown>;
      if (typeof row.id !== 'string' || !row.id.trim()) return [];
      const effective = row.effective && typeof row.effective === 'object'
        ? row.effective as Record<string, unknown>
        : undefined;
      const runtime = effective?.runtime && typeof effective.runtime === 'object'
        ? effective.runtime as Record<string, unknown>
        : undefined;
      return [{
        id: row.id,
        name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : row.id,
        ...(typeof row.description === 'string' && row.description.trim() ? { description: row.description.trim() } : {}),
        isDefault: row.isDefault === true || row.id === defaultId,
        ...(typeof runtime?.thinkingLevel === 'string' && runtime.thinkingLevel ? { thinkingLevel: runtime.thinkingLevel } : {}),
      }];
    });
    const selectedAgentId = agents.some((agent) => agent.id === this.snapshot.selectedAgentId)
      ? this.snapshot.selectedAgentId
      : defaultId;
    this.update({ agents, selectedAgentId });
  }

  async selectAgent(agentId: string): Promise<void> {
    const normalized = agentId.trim() || 'main';
    this.update({ selectedAgentId: normalized });
    await this.loadModels(normalized);
    const conversationId = this.snapshot.conversationId;
    if (!conversationId) return;
    const draft = await readDraft(conversationId);
    if (!draft) return;
    if (await readBrowserOutbox(await inputStorageKey(conversationId))) throw new Error(t('errorWaitQueuedMessage'));
    const model = this.snapshot.models.find((candidate) => candidate.id === this.defaultModelId);
    const agent = this.snapshot.agents.find((candidate) => candidate.id === normalized);
    const thinkingLevel = agent?.thinkingLevel ?? model?.thinking?.initialValue ?? 'off';
    const creation: SessionCreation = {
      ...draft,
      agentId: normalized,
      model: model?.id ?? '',
      thinkingLevel,
    };
    await writeBrowserOutbox(await draftStorageKey(conversationId), creation);
    if (this.snapshot.conversationId === conversationId) {
      this.update({
        modelConfig: {
          model: creation.model,
          thinkingLevel: creation.thinkingLevel,
          fixedModel: false,
          activityDetail: 'on',
        },
      });
    }
  }

  async loadSessions(search?: string): Promise<void> {
    const requestId = ++this.sessionsRequest;
    const normalizedSearch = search?.trim() ?? '';
    this.lastSessionSearch = normalizedSearch;
    const params = new URLSearchParams({
      channel: 'webchat',
      limit: '40',
      excludeArchived: 'true',
      includePinned: 'true',
    });
    if (normalizedSearch) params.set('search', normalizedSearch);
    const result = await json<{ items?: unknown[] }>(await gatewayFetch(`/api/sessions?${params}`));
    const sessions = (result.items ?? []).flatMap((value): BrowserChatSession[] => {
      if (!value || typeof value !== 'object') return [];
      const row = value as Record<string, unknown>;
      if (typeof row.key !== 'string') return [];
      const transcriptId = typeof row.transcriptId === 'string' && row.transcriptId ? row.transcriptId : undefined;
      if (transcriptId) this.rememberTranscriptId(row.key, transcriptId);
      const usage = row.usage && typeof row.usage === 'object' ? row.usage as Record<string, unknown> : undefined;
      return [{
        key: row.key,
        ...(transcriptId ? { transcriptId } : {}),
        title: [row.name, row.title, row.displayName].find((item) => typeof item === 'string' && item.trim()) as string || t('newChat'),
        updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : '',
        pinned: row.status === 'pinned',
        ...(typeof row.agentId === 'string' ? { agentId: row.agentId } : {}),
        ...(typeof row.messageCount === 'number' ? { messageCount: row.messageCount } : {}),
        ...(typeof usage?.totalTokens === 'number' ? { totalTokens: usage.totalTokens } : {}),
      }];
    });
    sessions.sort((left, right) => {
      if (Boolean(left.pinned) !== Boolean(right.pinned)) return left.pinned ? -1 : 1;
      return Date.parse(right.updatedAt || '0') - Date.parse(left.updatedAt || '0');
    });
    if (requestId === this.sessionsRequest) {
      const currentTranscriptId = this.snapshot.conversationId
        ? sessions.find((candidate) => candidate.key === this.snapshot.conversationId)?.transcriptId
        : undefined;
      this.update({
        sessions,
        ...(currentTranscriptId && !this.snapshot.transcriptId ? { transcriptId: currentTranscriptId } : {}),
      });
    }
  }

  async createSession(agentId?: string): Promise<void> {
    const conversationId = crypto.randomUUID();
    const scope = await deliveryScope(conversationId, this.profileIdentity);
    const chosenAgentId = agentId?.trim() || this.snapshot.selectedAgentId || 'main';
    const agent = this.snapshot.agents.find((candidate) => candidate.id === chosenAgentId);
    const model = this.snapshot.models.find((candidate) => candidate.id === this.defaultModelId);
    const creation: SessionCreation = {
      agentId: chosenAgentId,
      projectId: null,
      execution: null,
      temporary: false,
      model: model?.id ?? '',
      thinkingLevel: agent?.thinkingLevel ?? model?.thinking?.initialValue ?? 'off',
    };
    await writeBrowserOutbox(scope.draftKey, creation);
    await scope.assertCurrent();
    await this.openSession(conversationId);
  }

  async openSession(conversationId: string): Promise<void> {
    if (this.runTopic) this.realtime?.unsubscribe(this.runTopic);
    this.runTopic = undefined;
    this.historyCursor = undefined;
    this.clearSuggestionTimer();
    const knownTranscriptId = this.snapshot.sessions.find((candidate) => candidate.key === conversationId)?.transcriptId
      ?? this.rememberedTranscriptId(conversationId);
    this.update({
      conversationId,
      transcriptId: knownTranscriptId,
      isDraftSession: false,
      messages: [],
      hasMoreHistory: false,
      loadingMoreHistory: false,
      streamingMessage: undefined,
      runId: undefined,
      stopping: false,
      sessionLoading: true,
      pendingDelivery: false,
      queuedInputs: [],
      clarification: undefined,
      tabBinding: undefined,
      nextTurnSuggestion: undefined,
      modelConfig: undefined,
      error: undefined,
    });
    await chrome.storage.session.set({ [ACTIVE_CHAT_KEY]: conversationId });
    const tabId = await activeTabId();
    if (tabId !== undefined) {
      await chrome.storage.session.set({ [`${TAB_SESSION_PREFIX}${tabId}`]: conversationId });
    }
    try {
      const draft = await readDraft(conversationId);
      if (draft) {
        this.update({
          isDraftSession: true,
          selectedAgentId: draft.agentId || this.snapshot.selectedAgentId,
          modelConfig: { model: draft.model, thinkingLevel: draft.thinkingLevel, fixedModel: false, activityDetail: 'on' },
        });
        this.update({ pendingDelivery: Boolean(await readBrowserOutbox<BrowserOutboxRequest>(await inputStorageKey(conversationId))) });
        if (this.snapshot.endpointReady) await this.recoverOutbox();
        return;
      }
      await Promise.all([
        this.reloadMessages(),
        this.reloadModelConfig(),
        this.reloadClarification(),
        this.reloadTabBinding(),
      ]);
      if (this.snapshot.conversationId !== conversationId) return;
      const run = await json<{ payload?: { active?: boolean; runId?: string } }>(await gatewayFetch(
        `/api/sessions/${encodeURIComponent(conversationId)}/run`,
      ));
      if (this.snapshot.conversationId !== conversationId) return;
      if (run.payload?.active && run.payload.runId) {
        await this.followRun(run.payload.runId);
      } else {
        void this.loadNextTurnSuggestion().catch(() => undefined);
      }
      if (this.snapshot.conversationId !== conversationId) return;
      this.update({ pendingDelivery: Boolean(await readBrowserOutbox<BrowserOutboxRequest>(await inputStorageKey(conversationId))) });
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

  async renameSession(conversationId: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    await json(await gatewayFetch(`/api/sessions/${encodeURIComponent(conversationId)}/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    }));
    await this.loadSessions(this.lastSessionSearch);
  }

  async togglePinSession(conversationId: string, pinned: boolean): Promise<void> {
    await json(await gatewayFetch(`/api/sessions/${encodeURIComponent(conversationId)}/${pinned ? 'unpin' : 'pin'}`, {
      method: 'POST',
    }));
    await this.loadSessions(this.lastSessionSearch);
  }

  async deleteSession(conversationId: string): Promise<void> {
    const draft = await readDraft(conversationId).catch(() => undefined);
    if (draft) {
      await deleteBrowserOutbox(await draftStorageKey(conversationId)).catch(() => undefined);
      await deleteBrowserOutbox(await inputStorageKey(conversationId)).catch(() => undefined);
    } else {
      await json(await gatewayFetch(`/api/sessions/${encodeURIComponent(conversationId)}`, {
        method: 'DELETE',
      }));
    }
    this.transcriptCache.delete(this.transcriptCacheKey(conversationId));
    if (this.snapshot.conversationId === conversationId) {
      if (this.runTopic) this.realtime?.unsubscribe(this.runTopic);
      this.runTopic = undefined;
      this.historyCursor = undefined;
      this.clearSuggestionTimer();
      const tabId = await activeTabId();
      await chrome.storage.session.remove([
        ACTIVE_CHAT_KEY,
        ...(tabId === undefined ? [] : [`${TAB_SESSION_PREFIX}${tabId}`]),
      ]);
      this.update({
        conversationId: undefined,
        transcriptId: undefined,
        isDraftSession: false,
        messages: [],
        hasMoreHistory: false,
        loadingMoreHistory: false,
        streamingMessage: undefined,
        runId: undefined,
        stopping: false,
        queuedInputs: [],
        clarification: undefined,
        tabBinding: undefined,
        nextTurnSuggestion: undefined,
        modelConfig: undefined,
        error: undefined,
      });
    }
    await this.loadSessions(this.lastSessionSearch).catch(() => undefined);
  }

  async resetSession(conversationId = this.snapshot.conversationId): Promise<void> {
    if (!conversationId) return;
    if (await readDraft(conversationId).catch(() => undefined)) {
      await this.createSession(this.snapshot.selectedAgentId);
      return;
    }
    const result = await json<{ transcriptId?: string; session?: { transcriptId?: string } }>(
      await gatewayFetch(`/api/sessions/${encodeURIComponent(conversationId)}/reset`, { method: 'POST' }),
    );
    const nextTranscriptId = result.transcriptId ?? result.session?.transcriptId;
    if (nextTranscriptId) this.rememberTranscriptId(conversationId, nextTranscriptId);
    if (this.snapshot.conversationId !== conversationId) return;
    if (this.runTopic) this.realtime?.unsubscribe(this.runTopic);
    this.runTopic = undefined;
    this.historyCursor = undefined;
    this.clearSuggestionTimer();
    this.update({
      ...(nextTranscriptId ? { transcriptId: nextTranscriptId } : {}),
      messages: [],
      hasMoreHistory: false,
      loadingMoreHistory: false,
      streamingMessage: undefined,
      runId: undefined,
      stopping: false,
      queuedInputs: [],
      clarification: undefined,
      nextTurnSuggestion: undefined,
      error: undefined,
    });
    await Promise.all([
      this.reloadModelConfig().catch(() => undefined),
      this.loadSessions(this.lastSessionSearch).catch(() => undefined),
    ]);
  }

  get currentConversationId(): string | undefined { return this.snapshot.conversationId; }

  getConsoleUrl(conversationId = this.snapshot.conversationId): string | undefined {
    if (!this.profileUrl) return undefined;
    const base = this.profileUrl.replace(/\/+$/, '');
    if (!conversationId || this.snapshot.isDraftSession) return `${base}/#/chat`;
    return `${base}/#/chat/${encodeURIComponent(conversationId)}`;
  }

  private async hydrateAppendIdentity(
    conversationId: string,
    scope: DeliveryScope,
  ): Promise<{ transcriptId: string; configVersion: number }> {
    let transcriptId = this.resolveKnownTranscriptId(conversationId);
    let configVersion = this.snapshot.modelConfig?.configVersion;

    if (!transcriptId || configVersion === undefined) {
      await this.reloadModelConfig(scope.identity);
      await scope.assertCurrent();
      if (this.snapshot.conversationId !== conversationId) throw new Error(t('errorChatChanged'));
      transcriptId = this.resolveKnownTranscriptId(conversationId);
      configVersion = this.snapshot.modelConfig?.configVersion;
    }

    if (!transcriptId) {
      const resolved = await json<{ payload?: { transcriptId?: string } }>(
        await gatewayFetch(`/api/sessions/resolve?conversationId=${encodeURIComponent(conversationId)}`, {}, scope.identity),
      ).catch(() => undefined);
      const resolvedId = resolved?.payload?.transcriptId;
      if (typeof resolvedId === 'string' && resolvedId) {
        transcriptId = resolvedId;
        this.rememberTranscriptId(conversationId, resolvedId);
        if (this.snapshot.conversationId === conversationId) {
          this.update({ transcriptId: resolvedId });
        }
      }
    }

    if (!transcriptId || configVersion === undefined) {
      throw new Error(t('errorSessionSyncRequired'));
    }
    return { transcriptId, configVersion };
  }

  private async acceptReceipt(
    conversationId: string,
    clientMessageId: string,
    result: BrowserInputResponse,
    scope: DeliveryScope,
  ): Promise<void> {
    const payload = result.payload;
    if (
      payload.receipt.conversationId !== conversationId
      || payload.receipt.clientMessageId !== clientMessageId
      || payload.receipt.transcriptId !== payload.session.transcriptId
    ) {
      throw new Error(t('errorChatChanged'));
    }
    await scope.assertCurrent();
    await deleteBrowserOutbox(scope.draftKey);
    await scope.assertCurrent();
    this.rememberTranscriptId(conversationId, payload.receipt.transcriptId);
    if (this.snapshot.conversationId === conversationId) {
      const queuedInputs = extractQueuedInputs(payload.inputState?.inputs);
      this.update({
        transcriptId: payload.receipt.transcriptId,
        isDraftSession: false,
        modelConfig: payload.agentConfig,
        ...(queuedInputs ? { queuedInputs } : {}),
      });
    }
  }

  async send(
    content: string,
    browserContexts: BrowserPageContextInput[] = [],
    attachments: BrowserAttachment[] = [],
  ): Promise<'sent' | 'queued'> {
    if (this.sendingInput) throw new Error(t('errorWaitQueuedMessage'));
    this.sendingInput = true;
    try {
      return await this.sendInput(content, browserContexts, attachments);
    } finally {
      this.sendingInput = false;
    }
  }

  private async postInputWithEndpointRetry(
    conversationId: string,
    request: SessionInputCommand,
    scope: DeliveryScope,
  ): Promise<BrowserInputResponse> {
    try {
      return await json<BrowserInputResponse>(
        await gatewayFetch(`/api/sessions/${encodeURIComponent(conversationId)}/inputs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        }, scope.identity),
      );
    } catch (cause) {
      if (cause instanceof GatewayRequestError && cause.status === 401 && cause.code === 'INVALID_ENDPOINT') {
        const refreshed = await chrome.runtime.sendMessage({ type: 'browser/get-endpoint-claim' }).catch(() => undefined) as {
          claim?: TurnClaim;
        } | undefined;
        if (
          refreshed?.claim
          && (refreshed.claim.token !== this.turnClaim?.token || refreshed.claim.endpointId !== this.turnClaim?.endpointId)
        ) {
          this.turnClaim = refreshed.claim;
          const retried: SessionInputCommand = {
            ...request,
            origin: { type: 'endpoint', endpointId: refreshed.claim.endpointId, token: refreshed.claim.token },
          };
          return await json<BrowserInputResponse>(
            await gatewayFetch(`/api/sessions/${encodeURIComponent(conversationId)}/inputs`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(retried),
            }, scope.identity),
          );
        }
      }
      throw cause;
    }
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
    const scope = await deliveryScope(conversationId, this.profileIdentity);
    const draft = await readBrowserOutbox<SessionCreation>(scope.draftKey);
    await scope.assertCurrent();
    if (this.snapshot.conversationId !== conversationId) throw new Error(t('errorChatChanged'));
    const clientMessageId = crypto.randomUUID();
    const input = {
      content: text,
      ...(browserContexts.length ? { browserContexts } : {}),
      ...(attachments.length ? { attachments } : {}),
    };
    const origin = { type: 'endpoint' as const, endpointId: this.turnClaim.endpointId, token: this.turnClaim.token };

    let request: SessionInputCommand;
    if (draft) {
      request = parseSessionInputCommandOrThrow({ kind: 'start', clientMessageId, creation: draft, input, origin });
    } else {
      const { transcriptId, configVersion } = await this.hydrateAppendIdentity(conversationId, scope);
      request = parseSessionInputCommandOrThrow({
        kind: 'append',
        clientMessageId,
        expectedTranscriptId: transcriptId,
        configVersion,
        delivery: 'next',
        input,
        origin,
      });
    }

    const previousMessages = this.snapshot.messages;
    let outboxStored = false;
    let deliveryAccepted = false;
    this.clearSuggestionTimer();
    this.update({ submitting: true, pendingDelivery: false, nextTurnSuggestion: undefined });
    try {
      const { origin: _origin, ...durable } = request;
      await writeBrowserOutbox(scope.inputKey, durable);
      outboxStored = true;
      await scope.assertCurrent();
      attachments.forEach((attachment, index) => {
        if (attachment.type === 'image' && attachment.data && attachment.mimeType) {
          this.attachmentPreviewUrls.set(
            `${conversationId}:${clientMessageId}:${index}`,
            `data:${attachment.mimeType};base64,${attachment.data}`,
          );
        }
      });
      this.update({
        messages: this.snapshot.runId ? this.snapshot.messages : [...this.snapshot.messages, {
          id: clientMessageId,
          role: 'user',
          blocks: text ? [{ type: 'text', text }] : [],
          timestamp: Date.now(),
          ...(attachments.length ? {
            attachments: attachments.map((attachment) => ({
              type: attachment.type,
              mimeType: attachment.mimeType,
              name: attachment.name,
              size: attachment.size,
            })),
          } : {}),
        }],
        ...(this.snapshot.runId ? {} : { streamingMessage: undefined }),
        error: undefined,
      });
      const response = await this.postInputWithEndpointRetry(conversationId, request, scope);
      await this.acceptReceipt(conversationId, clientMessageId, response, scope);
      deliveryAccepted = true;
      await deleteBrowserOutbox(scope.inputKey);
      outboxStored = false;
      await scope.assertCurrent();
      if (this.snapshot.conversationId !== conversationId) return 'sent';
      const runId = response.payload.inputState.inputs?.find((entry) => entry.clientMessageId === clientMessageId)?.runId
        ?? response.payload.inputState.activeRunId
        ?? await this.waitForRun(conversationId, clientMessageId);
      if (this.snapshot.conversationId !== conversationId) return 'sent';
      if (runId) await this.followRun(runId);
      else await this.reloadMessages();
      return 'sent';
    } catch (cause) {
      try { await scope.assertCurrent(); } catch { return deliveryAccepted ? 'sent' : 'queued'; }
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
      if (outboxStored) await deleteBrowserOutbox(scope.inputKey);
      if (this.snapshot.conversationId === conversationId) this.update({ messages: previousMessages });
      if (cause instanceof GatewayRequestError && cause.status === 409) {
        if (cause.code === 'CONFIG_CHANGED') {
          void this.reloadModelConfig(scope.identity).catch(() => undefined);
        } else if (cause.code === 'SESSION_CHANGED') {
          void Promise.all([
            this.reloadMessages(),
            this.reloadModelConfig(scope.identity),
          ]).catch(() => undefined);
        }
      }
      throw cause;
    } finally {
      const current = await scope.assertCurrent().then(() => true, () => false);
      if (current && this.snapshot.conversationId === conversationId) this.update({ submitting: false });
    }
  }

  async retryPendingDelivery(): Promise<void> {
    this.lastOutboxRecoveryAt = 0;
    await this.recoverOutbox();
  }

  async discardPendingDelivery(): Promise<string | undefined> {
    const conversationId = this.snapshot.conversationId;
    if (!conversationId || this.recoveringOutbox) return undefined;
    const scope = await deliveryScope(conversationId, this.profileIdentity);
    const pending = await readBrowserOutbox<BrowserOutboxRequest>(scope.inputKey);
    await deleteBrowserOutbox(scope.inputKey);
    await scope.assertCurrent();
    if (this.snapshot.conversationId === conversationId) {
      this.update({
        pendingDelivery: false,
        messages: pending?.clientMessageId
          ? this.snapshot.messages.filter((message) => message.id !== pending.clientMessageId)
          : this.snapshot.messages,
        error: undefined,
      });
    }
    return typeof pending?.input?.content === 'string' ? pending.input.content : undefined;
  }

  async replaceLatestTurn(turnId: string, content: string): Promise<void> {
    const text = content.trim();
    if (!text) return;
    if (this.sendingInput) throw new Error(t('errorWaitQueuedMessage'));
    const conversationId = this.snapshot.conversationId;
    if (!conversationId) throw new Error(t('errorOpenChatBeforeSending'));
    if (this.snapshot.submitting || this.snapshot.pendingDelivery || this.recoveringOutbox || this.snapshot.runId) {
      throw new Error(t('errorWaitQueuedMessage'));
    }
    if (!this.turnClaim) throw new Error(t('errorEndpointNotReady'));
    this.sendingInput = true;
    this.clearSuggestionTimer();
    this.update({ submitting: true, nextTurnSuggestion: undefined, error: undefined });
    try {
      const scope = await deliveryScope(conversationId, this.profileIdentity);
      const { transcriptId, configVersion } = await this.hydrateAppendIdentity(conversationId, scope);
      const clientMessageId = crypto.randomUUID();
      const postReplace = async (claim: TurnClaim) => json<{
        payload?: {
          state?: { activeRunId?: string; inputs?: BrowserInputStateEntry[] };
          activeRunId?: string;
        };
      }>(await gatewayFetch(
        `/api/sessions/${encodeURIComponent(conversationId)}/turns/${encodeURIComponent(turnId)}/replace`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientMessageId,
            expectedTranscriptId: transcriptId,
            configVersion,
            delivery: 'next',
            content: text,
            origin: { type: 'endpoint', endpointId: claim.endpointId, token: claim.token },
          }),
        },
        scope.identity,
      ));

      let response: Awaited<ReturnType<typeof postReplace>>;
      try {
        response = await postReplace(this.turnClaim);
      } catch (cause) {
        if (cause instanceof GatewayRequestError && cause.status === 401 && cause.code === 'INVALID_ENDPOINT') {
          const refreshed = await chrome.runtime.sendMessage({ type: 'browser/get-endpoint-claim' }).catch(() => undefined) as {
            claim?: TurnClaim;
          } | undefined;
          if (refreshed?.claim) {
            this.turnClaim = refreshed.claim;
            response = await postReplace(refreshed.claim);
          } else {
            throw cause;
          }
        } else {
          if (cause instanceof GatewayRequestError && cause.status === 409) {
            if (cause.code === 'CONFIG_CHANGED') void this.reloadModelConfig(scope.identity).catch(() => undefined);
            else void Promise.all([this.reloadMessages(), this.reloadModelConfig(scope.identity)]).catch(() => undefined);
          }
          throw cause;
        }
      }

      if (this.snapshot.conversationId !== conversationId) return;
      await this.reloadMessages();
      if (this.snapshot.conversationId !== conversationId) return;
      const runId = response.payload?.state?.activeRunId
        ?? response.payload?.activeRunId
        ?? await this.waitForRun(conversationId, clientMessageId);
      if (this.snapshot.conversationId !== conversationId) return;
      if (runId) await this.followRun(runId);
    } finally {
      this.sendingInput = false;
      if (this.snapshot.conversationId === conversationId) this.update({ submitting: false });
    }
  }

  async loadEarlierMessages(): Promise<number> {
    const conversationId = this.snapshot.conversationId;
    const cursor = this.historyCursor;
    if (!conversationId || !cursor || this.snapshot.loadingMoreHistory || !this.snapshot.hasMoreHistory) return 0;
    this.update({ loadingMoreHistory: true });
    try {
      const result = await json<{
        payload: { messages?: unknown[]; transcriptId?: string };
        pagination?: { hasMore?: boolean; nextBeforeCursor?: string };
      }>(await gatewayFetch(
        `/api/sessions/${encodeURIComponent(conversationId)}/messages?limit=100&before=${encodeURIComponent(cursor)}`,
      ));
      if (this.snapshot.conversationId !== conversationId) return 0;
      const rawRows = result.payload.messages ?? [];
      indexAttachmentMediaUris(this.attachmentMediaUris, conversationId, rawRows);
      const older = normalizeChatMessages(rawRows);
      const existingIds = new Set(this.snapshot.messages.map((message) => message.id));
      const uniqueOlder = older.filter((message) => !existingIds.has(message.id));
      this.historyCursor = result.pagination?.nextBeforeCursor;
      this.update({
        messages: [...uniqueOlder, ...this.snapshot.messages],
        hasMoreHistory: Boolean(result.pagination?.hasMore && this.historyCursor),
      });
      return uniqueOlder.length;
    } finally {
      if (this.snapshot.conversationId === conversationId) {
        this.update({ loadingMoreHistory: false });
      }
    }
  }

  async findInSession(query: string): Promise<{ total: number; truncated: boolean }> {
    const conversationId = this.snapshot.conversationId;
    const trimmed = query.trim();
    if (!conversationId || !trimmed || this.snapshot.isDraftSession) return { total: 0, truncated: false };
    const result = await json<{ total?: number; truncated?: boolean }>(
      await gatewayFetch(`/api/sessions/${encodeURIComponent(conversationId)}/find?q=${encodeURIComponent(trimmed)}`),
    );
    return {
      total: typeof result.total === 'number' ? result.total : 0,
      truncated: result.truncated === true,
    };
  }

  async compactSession(conversationId = this.snapshot.conversationId): Promise<boolean> {
    if (!conversationId || this.snapshot.isDraftSession) return false;
    await json(await gatewayFetch(`/api/sessions/${encodeURIComponent(conversationId)}/compaction/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: true }),
    }));
    if (this.snapshot.conversationId === conversationId) {
      await Promise.all([
        this.reloadMessages().catch(() => undefined),
        this.loadSessions(this.lastSessionSearch).catch(() => undefined),
      ]);
    }
    return true;
  }

  async exportSessionMarkdown(conversationId = this.snapshot.conversationId): Promise<string> {
    if (!conversationId || this.snapshot.isDraftSession) {
      return this.snapshot.messages
        .map((message) => `### ${message.role === 'user' ? 'User' : message.role === 'assistant' ? 'xopc' : 'System'}\n\n${message.blocks.filter((b) => b.type === 'text').map((b) => b.text).join('')}`)
        .join('\n\n---\n\n');
    }
    const result = await json<{ content?: string }>(
      await gatewayFetch(`/api/sessions/${encodeURIComponent(conversationId)}/export?format=markdown`),
    );
    return typeof result.content === 'string' ? result.content : '';
  }

  hasAttachmentPreview(messageId: string, index: number): boolean {
    const conversationId = this.snapshot.conversationId;
    if (!conversationId) return false;
    const key = `${conversationId}:${messageId}:${index}`;
    return this.attachmentPreviewUrls.has(key) || this.attachmentMediaUris.has(key);
  }

  async loadAttachmentPreview(messageId: string, index: number): Promise<string | undefined> {
    const conversationId = this.snapshot.conversationId;
    if (!conversationId) return undefined;
    const key = `${conversationId}:${messageId}:${index}`;
    const cached = this.attachmentPreviewUrls.get(key);
    if (cached) return cached;
    const uri = this.attachmentMediaUris.get(key);
    if (!uri) return undefined;
    const response = await gatewayFetch(
      `/api/media/read?uri=${encodeURIComponent(uri)}&conversationId=${encodeURIComponent(conversationId)}`,
    );
    if (!response.ok) return undefined;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    this.objectUrls.add(url);
    this.attachmentPreviewUrls.set(key, url);
    return url;
  }

  private async lookupInputReceipt(
    conversationId: string,
    clientMessageId: string,
    identity: BrowserGatewayIdentity,
  ): Promise<BrowserInputResponse | undefined> {
    const response = await gatewayFetch(
      `/api/sessions/${encodeURIComponent(conversationId)}/input-receipts/${encodeURIComponent(clientMessageId)}`,
      {},
      identity,
    );
    if (response.status === 404) return undefined;
    return json<BrowserInputResponse>(response);
  }

  private async recoverOutbox(): Promise<void> {
    const conversationId = this.snapshot.conversationId;
    if (!conversationId || !this.turnClaim || this.recoveringOutbox) return;
    if (Date.now() - this.lastOutboxRecoveryAt < 3_000) return;
    const scope = await deliveryScope(conversationId, this.profileIdentity);
    const pending = await readBrowserOutbox<BrowserOutboxRequest>(scope.inputKey);
    await scope.assertCurrent();
    if (this.snapshot.conversationId !== conversationId || !this.turnClaim) return;
    if (!pending?.clientMessageId || typeof pending.input.content !== 'string') return;
    this.recoveringOutbox = true;
    this.lastOutboxRecoveryAt = Date.now();
    this.update({ pendingDelivery: true });
    let deliveryAccepted = false;
    try {
      const existingReceipt = await this.lookupInputReceipt(conversationId, pending.clientMessageId, scope.identity)
        .catch(() => undefined);
      let response: BrowserInputResponse;
      if (existingReceipt) {
        response = existingReceipt;
      } else {
        const request: SessionInputCommand = {
          ...pending,
          origin: { type: 'endpoint', endpointId: this.turnClaim.endpointId, token: this.turnClaim.token },
        };
        response = await this.postInputWithEndpointRetry(conversationId, request, scope);
      }
      await this.acceptReceipt(conversationId, pending.clientMessageId, response, scope);
      deliveryAccepted = true;
      await deleteBrowserOutbox(scope.inputKey);
      await scope.assertCurrent();
      if (this.snapshot.conversationId !== conversationId) return;
      this.update({ pendingDelivery: false, error: undefined });
      const runId = response.payload.inputState.inputs?.find((entry) => entry.clientMessageId === pending.clientMessageId)?.runId
        ?? response.payload.inputState.activeRunId
        ?? await this.waitForRun(conversationId, pending.clientMessageId);
      if (this.snapshot.conversationId !== conversationId) return;
      if (runId) await this.followRun(runId);
      else await this.reloadMessages();
    } catch (cause) {
      try { await scope.assertCurrent(); } catch { return; }
      if (this.snapshot.conversationId === conversationId) {
        if (deliveryAccepted) {
          this.update({
            pendingDelivery: false,
            error: t('errorSentStatusUnknown'),
          });
        } else if (isRetryableDeliveryError(cause)) {
          this.update({ pendingDelivery: true, error: undefined });
        } else {
          await deleteBrowserOutbox(scope.inputKey);
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
    if (await readDraft(conversationId).catch(() => undefined)) return;
    const result = await json<{ payload: { activeRunId?: string; inputs?: BrowserInputStateEntry[] } }>(
      await gatewayFetch(`/api/sessions/${encodeURIComponent(conversationId)}/input-state`),
    );
    if (this.snapshot.conversationId !== conversationId || requestId !== this.inputsRequest) return;
    await this.applyInputState(conversationId, result.payload, requestId);
  }

  private async applyInputState(
    conversationId: string,
    payload: { activeRunId?: string; inputs?: BrowserInputStateEntry[] },
    requestId?: number,
  ): Promise<void> {
    if (this.snapshot.conversationId !== conversationId) return;
    if (requestId !== undefined && requestId !== this.inputsRequest) return;
    const queuedInputs = extractQueuedInputs(payload.inputs) ?? [];
    this.update({ queuedInputs });
    if (payload.activeRunId !== this.snapshot.runId) {
      await this.reloadMessages();
      if (this.snapshot.conversationId !== conversationId) return;
      if (requestId !== undefined && requestId !== this.inputsRequest) return;
      if (payload.activeRunId) {
        await this.followRun(payload.activeRunId);
      } else {
        if (this.runTopic) this.realtime?.unsubscribe(this.runTopic);
        this.runTopic = undefined;
        this.update({ runId: undefined, streamingMessage: undefined, stopping: false });
      }
    }
  }

  async editInput(id: string, version: number, content: string): Promise<void> {
    const key = this.snapshot.conversationId;
    if (!key) return;
    try {
      await json(await gatewayFetch(`/api/sessions/${encodeURIComponent(key)}/inputs/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version, content }),
      }));
    } finally {
      if (this.snapshot.conversationId === key) await this.refreshInputs();
    }
  }

  async cancelInput(id: string, version: number): Promise<void> {
    const key = this.snapshot.conversationId;
    if (!key) return;
    try {
      await json(await gatewayFetch(`/api/sessions/${encodeURIComponent(key)}/inputs/${encodeURIComponent(id)}?version=${version}`, {
        method: 'DELETE',
      }));
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
      : selected?.thinking?.initialValue;
    await this.patchModelConfig({ model, thinkingLevel });
  }

  async updateThinking(thinkingLevel: string): Promise<void> {
    if (!this.snapshot.modelConfig) return;
    await this.patchModelConfig({ thinkingLevel });
  }

  async respondToClarification(
    action: 'answer' | 'agent_decide' | 'cancel',
    submission?: ClarificationSubmission,
  ): Promise<void> {
    const clarification = this.snapshot.clarification;
    if (!clarification) return;
    const signature = JSON.stringify([clarification.id, clarification.version, action, submission]);
    if (this.clarificationAttempt?.signature !== signature) {
      this.clarificationAttempt = { signature, key: crypto.randomUUID() };
    }
    await json(await gatewayFetch(`/api/clarifications/${encodeURIComponent(clarification.id)}/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        ...submission,
        expectedVersion: clarification.version,
        idempotencyKey: this.clarificationAttempt.key,
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

  private clearSuggestionTimer(): void {
    if (this.suggestionTimer) clearTimeout(this.suggestionTimer);
    this.suggestionTimer = undefined;
  }

  async loadNextTurnSuggestion(): Promise<void> {
    const conversationId = this.snapshot.conversationId;
    if (!conversationId || this.snapshot.runId || this.snapshot.isDraftSession) return;
    if (await readDraft(conversationId).catch(() => undefined)) return;
    const requestId = ++this.suggestionRequest;
    const locale = suggestionLocale();
    const response = await gatewayFetch(
      `/api/sessions/${encodeURIComponent(conversationId)}/next-turn-suggestion?locale=${locale}`,
    );
    if (!response.ok) return;
    const parsed = nextTurnSuggestionResponseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success || requestId !== this.suggestionRequest || this.snapshot.conversationId !== conversationId) return;
    const suggestion = parsed.data.suggestion;
    const currentTranscriptId = this.resolveKnownTranscriptId(conversationId);
    if (
      parsed.data.status === 'ready'
      && suggestion
      && suggestion.conversationId === conversationId
      && suggestion.expiresAt > Date.now()
      && (!currentTranscriptId || suggestion.transcriptId === currentTranscriptId)
    ) {
      const existing = this.snapshot.nextTurnSuggestion;
      const next: BrowserNextTurnSuggestion = existing?.id === suggestion.id
        ? existing
        : {
          id: suggestion.id,
          prompt: suggestion.prompt,
          conversationId: suggestion.conversationId,
          transcriptId: suggestion.transcriptId,
          expiresAt: suggestion.expiresAt,
          impressionId: crypto.randomUUID(),
        };
      this.clearSuggestionTimer();
      this.suggestionTimer = setTimeout(() => {
        if (this.snapshot.nextTurnSuggestion?.id === next.id) {
          this.update({ nextTurnSuggestion: undefined });
        }
      }, Math.max(0, next.expiresAt - Date.now()));
      this.update({ nextTurnSuggestion: next });
      if (existing?.id !== suggestion.id) {
        this.sendSuggestionFeedback(next, 'shown');
      }
      return;
    }
    this.clearSuggestionTimer();
    if (this.snapshot.nextTurnSuggestion) this.update({ nextTurnSuggestion: undefined });
  }

  sendSuggestionFeedback(
    suggestion: BrowserNextTurnSuggestion,
    event: NextTurnSuggestionFeedback['event'],
    edited?: boolean,
  ): void {
    void gatewayFetch(`/api/sessions/${encodeURIComponent(suggestion.conversationId)}/next-turn-suggestion-feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        suggestionId: suggestion.id,
        impressionId: suggestion.impressionId,
        event,
        ...(edited === undefined ? {} : { edited }),
      }),
    }).catch(() => undefined);
  }

  dismissNextTurnSuggestion(): void {
    const current = this.snapshot.nextTurnSuggestion;
    if (!current) return;
    this.clearSuggestionTimer();
    this.update({ nextTurnSuggestion: undefined });
    this.sendSuggestionFeedback(current, 'dismissed');
  }

  private async waitForRun(conversationId: string, clientMessageId: string): Promise<string | undefined> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const state = await json<{ payload: { activeRunId?: string; inputs?: BrowserInputStateEntry[] } }>(
        await gatewayFetch(`/api/sessions/${encodeURIComponent(conversationId)}/input-state`),
      );
      const runId = state.payload.inputs?.find((entry) => entry.clientMessageId === clientMessageId)?.runId
        ?? state.payload.activeRunId;
      if (runId) return runId;
      if (!state.payload.inputs?.some((entry) => entry.clientMessageId === clientMessageId)) return undefined;
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
    this.clearSuggestionTimer();
    this.update({ runId, streamingMessage: createStreamingMessage(runId), nextTurnSuggestion: undefined });
    this.realtime?.subscribe(topic, cursor);
  }

  private async onRealtimeEvent(topic: string, seq: number, event: string, data: unknown): Promise<void> {
    if (topic === 'gateway') {
      if (event === 'clarification.updated') {
        const conversationId = this.snapshot.conversationId;
        if (
          conversationId
          && data
          && typeof data === 'object'
          && (data as Record<string, unknown>).conversationId === conversationId
        ) {
          await this.applyClarification(data, conversationId);
        }
      }
      return;
    }
    if (topic === 'sessions') {
      const record = data && typeof data === 'object' ? data as Record<string, unknown> : undefined;
      const conversationId = this.snapshot.conversationId;
      if (event === 'session.input-state' && conversationId && record?.conversationId === conversationId) {
        await this.applyInputState(conversationId, record as { activeRunId?: string; inputs?: BrowserInputStateEntry[] }).catch(() => undefined);
        return;
      }
      if (event === 'session.next-turn-suggestion.changed' && conversationId && record?.conversationId === conversationId) {
        void this.loadNextTurnSuggestion().catch(() => undefined);
        return;
      }
      if (
        (event === 'session.transcript_updated' || event === 'session.transcript.updated')
        && conversationId
        && record?.key === conversationId
        && !this.snapshot.runId
      ) {
        await this.reloadMessages().catch(() => undefined);
        void this.loadNextTurnSuggestion().catch(() => undefined);
        return;
      }
      await this.loadSessions(this.lastSessionSearch).catch(() => undefined);
      return;
    }
    if (topic !== this.runTopic) return;
    const runId = topic.slice('run:'.length);
    const envelope = data && typeof data === 'object'
      ? data as { payload?: Record<string, unknown>; timestamp?: unknown }
      : {};
    const payload = envelope.payload && typeof envelope.payload === 'object'
      ? envelope.payload
      : {};
    if (event !== 'run_end' && event !== 'error') {
      this.update({
        streamingMessage: reduceRunEvent(this.snapshot.streamingMessage, {
          event,
          payload,
          runId,
          timestamp: typeof envelope.timestamp === 'number' ? envelope.timestamp : Date.now(),
        }),
      });
    }
    await chrome.storage.session.set({ [`${CURSOR_PREFIX}${runId}`]: seq });
    if (event === 'run_end' || event === 'error') {
      const streamError = event === 'error'
        ? extractStreamError(payload)
        : (payload.status === 'error' || payload.error ? extractStreamError(payload) : undefined);
      if (this.snapshot.streamingMessage) {
        this.update({
          streamingMessage: finalizeStreamingMessage(this.snapshot.streamingMessage, Boolean(streamError)),
        });
      }
      this.realtime?.unsubscribe(topic);
      this.runTopic = undefined;
      await chrome.storage.session.remove(`${CURSOR_PREFIX}${runId}`);
      try {
        await this.reloadMessages();
      } finally {
        if (topic === this.runTopic || this.snapshot.runId === runId) {
          this.update({
            runId: undefined,
            streamingMessage: undefined,
            stopping: false,
            ...(streamError ? { error: streamError } : {}),
          });
        }
      }
      void this.loadSessions(this.lastSessionSearch).catch(() => undefined);
      if (!streamError) void this.loadNextTurnSuggestion().catch(() => undefined);
    }
  }

  private async reloadMessages(): Promise<void> {
    const conversationId = this.snapshot.conversationId;
    if (!conversationId) return;
    const result = await json<{
      payload: { messages?: unknown[]; transcriptId?: string };
      pagination?: { hasMore?: boolean; nextBeforeCursor?: string };
    }>(await gatewayFetch(`/api/sessions/${encodeURIComponent(conversationId)}/messages?limit=200`));
    const rawRows = result.payload.messages ?? [];
    indexAttachmentMediaUris(this.attachmentMediaUris, conversationId, rawRows);
    const messages = normalizeChatMessages(rawRows);
    if (this.snapshot.conversationId !== conversationId) return;
    const fromPayload = typeof result.payload.transcriptId === 'string' && result.payload.transcriptId
      ? result.payload.transcriptId
      : undefined;
    const transcriptId = fromPayload ?? this.resolveKnownTranscriptId(conversationId);
    if (transcriptId) this.rememberTranscriptId(conversationId, transcriptId);
    this.historyCursor = result.pagination?.nextBeforeCursor;
    this.update({
      messages,
      hasMoreHistory: Boolean(result.pagination?.hasMore && this.historyCursor),
      ...(transcriptId ? { transcriptId } : {}),
    });
  }

  private async loadModels(agentId = 'main'): Promise<void> {
    const params = new URLSearchParams({ agentId });
    const result = await json<{ payload?: { models?: unknown[]; defaultId?: string } }>(
      await gatewayFetch(`/api/models?${params}`, {}, this.profileIdentity),
    );
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
        ...(typeof model.provider === 'string' ? { provider: model.provider } : {}),
        ...(model.recommended === true ? { recommended: true } : {}),
        ...(typeof model.contextWindow === 'number' && Number.isFinite(model.contextWindow)
          ? { contextWindow: model.contextWindow }
          : {}),
        ...(thinking && typeof thinking.mode === 'string' ? {
          thinking: {
            mode: thinking.mode,
            ...(Array.isArray(thinking.options)
              ? { options: thinking.options.filter((option): option is string => typeof option === 'string') }
              : {}),
            ...(typeof thinking.initialValue === 'string' ? { initialValue: thinking.initialValue } : {}),
          },
        } : {}),
      }];
    });
    this.defaultModelId = result.payload?.defaultId;
    this.update({ models });
  }

  private async reloadModelConfig(identity?: BrowserGatewayIdentity): Promise<void> {
    const conversationId = this.snapshot.conversationId;
    if (!conversationId) return;
    const draft = await readDraft(conversationId);
    if (draft) {
      this.update({
        isDraftSession: true,
        modelConfig: { model: draft.model, thinkingLevel: draft.thinkingLevel, fixedModel: false, activityDetail: 'on' },
      });
      return;
    }
    const result = await json<{ payload?: Record<string, unknown> }>(await gatewayFetch(
      `/api/sessions/${encodeURIComponent(conversationId)}/agent-config`,
      {},
      identity,
    ));
    const config = result.payload;
    if (!config || typeof config.model !== 'string' || typeof config.thinkingLevel !== 'string') {
      throw new Error(t('errorInvalidModelConfig'));
    }
    if (this.snapshot.conversationId !== conversationId) return;
    const transcriptId = typeof config.transcriptId === 'string' && config.transcriptId
      ? config.transcriptId
      : this.resolveKnownTranscriptId(conversationId);
    if (transcriptId) this.rememberTranscriptId(conversationId, transcriptId);
    this.update({
      ...(transcriptId ? { transcriptId } : {}),
      modelConfig: {
        model: config.model,
        thinkingLevel: config.thinkingLevel,
        activityDetail: activityDetail(config),
        ...(typeof config.configVersion === 'number' ? { configVersion: config.configVersion } : {}),
        fixedModel: config.fixedModel === true,
      },
    });
  }

  private async patchModelConfig(patch: { model?: string; thinkingLevel?: string }): Promise<void> {
    const conversationId = this.snapshot.conversationId;
    const current = this.snapshot.modelConfig;
    if (!conversationId || !current) return;
    const draft = await readDraft(conversationId);
    if (draft) {
      if (await readBrowserOutbox(await inputStorageKey(conversationId))) throw new Error(t('errorWaitQueuedMessage'));
      const creation = { ...draft, ...patch };
      await writeBrowserOutbox(await draftStorageKey(conversationId), creation);
      this.update({ modelConfig: { ...current, model: creation.model, thinkingLevel: creation.thinkingLevel } });
      return;
    }
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
    const transcriptId = typeof config.transcriptId === 'string' && config.transcriptId
      ? config.transcriptId
      : undefined;
    if (transcriptId) this.rememberTranscriptId(conversationId, transcriptId);
    this.update({
      ...(transcriptId ? { transcriptId } : {}),
      modelConfig: {
        model: config.model,
        thinkingLevel: config.thinkingLevel,
        activityDetail: activityDetail(config, current.activityDetail),
        ...(typeof config.configVersion === 'number' ? { configVersion: config.configVersion } : {}),
        fixedModel: config.fixedModel === true,
      },
    });
  }

  private async applyClarification(value: unknown, conversationId: string): Promise<void> {
    if (this.snapshot.conversationId !== conversationId) return;
    const clarification = mapClarification(value, conversationId);
    this.update({ clarification });
  }

  private async reloadClarification(): Promise<void> {
    const conversationId = this.snapshot.conversationId;
    if (!conversationId) return;
    if (await readDraft(conversationId)) return;
    const result = await json<{ payload: unknown }>(await gatewayFetch(
      `/api/sessions/${encodeURIComponent(conversationId)}/clarification`,
    ));
    if (this.snapshot.conversationId === conversationId) {
      await this.applyClarification(result.payload, conversationId);
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
            this.update({ runId: undefined, streamingMessage: undefined, stopping: false });
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
  private profileIdentity?: BrowserGatewayIdentity;

  async prepare(): Promise<void> {
    const profile = await getAccessProfile();
    this.profileUrl = profile.gatewayUrl;
    this.profileIdentity = {
      gatewayId: profile.gatewayId,
      deviceId: profile.deviceId,
      gatewayPublicKey: profile.gatewayPublicKey,
    };
    this.update({ gatewayUrl: profile.gatewayUrl });
  }

  private update(patch: Partial<BrowserChatSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener(this.snapshot));
  }
}
