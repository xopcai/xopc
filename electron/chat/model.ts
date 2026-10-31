import { RealtimeClient, RealtimeConnectionError, type RealtimeConnectionState } from '@xopcai/realtime-client';
import { dispatchAgentStreamEvent, type AgentStreamCallbacks } from '../../packages/agent-stream-client/src/index.js';

import type { ChatState } from './state.js';

export class ChatApiError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
export interface ChatApi { <T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> }
export type ChatMessage = { id?: string; role: string; content: string; media?: Array<{ uri?: string; name?: string; mimeType?: string }> };
export type ChatCatalog = { id: string; name?: string; thinking?: { initialValue?: string } };
type InputState = { activeRunId?: string; inputs?: Array<{ runId?: string; status?: string }>; control?: { phase: string } };
type Receipt = { receipt: { clientMessageId: string; conversationId: string; inputId?: string }; inputState: InputState };
export interface ChatView {
  phase: 'connecting' | 'syncing' | 'ready' | 'retrying' | 'recovery' | 'unknown';
  notice: string; sessions: Array<{ key: string; name?: string; label?: string }>;
  messages: ChatMessage[]; models: ChatCatalog[]; agents: ChatCatalog[];
  model: string; agent: string; selected?: string; draft: string; activeRun?: string;
  stop: '' | 'requested' | 'acknowledged' | 'confirmed' | 'unknown'; pending: boolean;
}
export interface ChatPersistence { read(): Promise<ChatState>; write(state: ChatState): Promise<unknown> }

/** One instance per Shell window. Persistent hints cannot replay an input. */
export class RemoteChatModel {
  readonly view: ChatView = { phase: 'connecting', notice: '', sessions: [], messages: [], models: [], agents: [], model: '', agent: '', draft: '', stop: '', pending: false };
  private state: ChatState = { version: 1, drafts: {} };
  private generation = 0;
  private disposed = false;
  private locked = false;
  private connected = false;
  private writeQueue = Promise.resolve();
  private writing?: Promise<void>;
  private queuedState?: ChatState;
  private syncing = false;
  private rerun = false;
  private submitting = false;
  private realtime?: RealtimeClient;
  private runTopic?: string;
  private timer?: ReturnType<typeof setInterval>;
  private abort = new AbortController();
  private stream = new Map<string, string>();
  private history: ChatMessage[] = [];
  constructor(private readonly api: ChatApi, private readonly persistence: ChatPersistence,
    private readonly changed: (view: ChatView) => void, private readonly websocket: (url: string) => WebSocket,
    private readonly socketUrl: string, private readonly chatEnabled = true) {}
  private emit() {
    if (this.disposed) return;
    this.view.pending = Boolean(this.state.pending);
    this.view.selected = this.state.selected;
    this.view.draft = this.state.selected ? this.state.drafts[this.state.selected] ?? '' : '';
    this.view.messages = this.history.map(message => ({ ...message, content: message.id && this.stream.has(message.id) ? this.stream.get(message.id)! : message.content }));
    for (const [id, content] of this.stream) if (!this.history.some(message => message.id === id)) this.view.messages.push({ id, role: 'assistant', content });
    this.changed(this.view);
  }
  private fail(error: unknown) {
    this.locked = true; this.connected = false; this.view.phase = 'recovery';
    this.view.notice = error instanceof Error ? error.message : 'CHAT_RECOVERY_REQUIRED'; this.realtime?.disconnect(); this.emit();
  }
  private persist(): Promise<void> {
    this.queuedState = structuredClone(this.state);
    if (!this.writing) {
      this.writing = (async () => {
        while (this.queuedState && !this.disposed) {
          const snapshot = this.queuedState; this.queuedState = undefined;
          await this.persistence.write(snapshot);
        }
      })().catch(error => { this.fail(error); throw error; }).finally(() => { this.writing = undefined; });
      this.writeQueue = this.writing.catch(() => {});
    }
    return this.writing;
  }
  async initialize() {
    try {
      this.state = await this.persistence.read();
      const [models, agents] = await Promise.all([
        this.api<{ models: ChatCatalog[] }>('/api/models', undefined, this.abort.signal),
        this.api<{ agents: ChatCatalog[]; defaultId?: string }>('/api/agents', undefined, this.abort.signal),
      ]);
      if (this.disposed) return;
      this.view.models = models.models ?? []; this.view.agents = agents.agents ?? [];
      this.view.model = this.view.models[0]?.id ?? ''; this.view.agent = agents.defaultId ?? this.view.agents[0]?.id ?? '';
      this.state.selected = this.state.pending?.conversationId ?? this.state.selected ?? crypto.randomUUID();
      this.emit(); this.startRealtime();
      this.timer = setInterval(() => { if (this.connected && !this.locked) void this.refresh(); }, 3000);
    } catch (error) { this.fail(error); }
  }
  private startRealtime() {
    this.connected = false; this.realtime?.disconnect(); this.runTopic = undefined;
    const generation = ++this.generation;
    const current = () => !this.disposed && generation === this.generation && !this.locked;
    const clientId = crypto.randomUUID();
    this.realtime = new RealtimeClient({ clientId, clientKind: 'web', maxReconnectAttempts: 10, connectionTimeoutMs: 15_000,
      getWebSocketUrl: () => this.socketUrl, createWebSocket: this.websocket,
      issueTicket: async signal => {
        try { return await this.api('/api/realtime/tickets', { clientId, clientKind: 'web', protocolVersion: 2 }, signal); }
        catch (error) { if (error instanceof ChatApiError && [401, 403, 409].includes(error.status)) throw new RealtimeConnectionError(error.code, false); throw error; }
      },
      onStateChange: state => {
        if (!current()) return;
        this.connected = state === 'connected';
        this.connectionState(state);
        if (this.connected) { this.stream.clear(); void this.refresh(); }
      },
      onGap: async () => { if (current()) { this.stream.clear(); await this.refresh(); } },
      onEvent: event => {
        if (!current()) return;
        if (event.topic.startsWith('run:')) this.dispatch(event.event, event.data);
        if (event.event !== 'assistant_delta') void this.refresh();
      },
    });
    this.realtime.subscribe('sessions');
    if (this.state.selected) this.realtime.subscribe(`session:${this.state.selected}`, 0);
    this.realtime.connect();
  }
  private connectionState(state: RealtimeConnectionState) {
    if (state === 'error') { this.locked = true; this.view.phase = 'recovery'; this.view.notice = '连接需恢复；请返回配置重新核验身份。'; }
    else this.view.phase = state === 'connected' ? 'syncing' : state === 'reconnecting' ? 'retrying' : 'connecting';
    this.emit();
  }
  private dispatch(event: string, data: unknown) {
    const callbacks: AgentStreamCallbacks = {
      onStreamStart: () => {}, onThinking: () => {}, onThinkingEnd: () => {}, onToolStart: () => {}, onToolEnd: () => {}, onProgress: () => {},
      onToken: (delta, messageId, offset) => {
        if (!messageId) return;
        const previous = this.stream.get(messageId) ?? this.history.find(message => message.id === messageId)?.content ?? '';
        if (offset !== undefined && offset > previous.length) { void this.refresh(); return; }
        const text = offset === undefined ? previous + delta : previous.slice(0, offset) + delta + previous.slice(offset + delta.length);
        if (text.length > 1024 * 1024 || this.stream.size >= 100 && !this.stream.has(messageId)) { this.fail(new Error('CHAT_STREAM_LIMIT')); return; }
        this.stream.set(messageId, text); this.emit();
      },
      onResult: () => { void this.refresh(); }, onError: () => { void this.refresh(); }, onReplayGap: () => { this.stream.clear(); return this.refresh(); },
    };
    dispatchAgentStreamEvent(event, JSON.stringify(data), callbacks);
  }
  async refresh() {
    if (this.disposed || this.locked || !this.connected) return;
    if (this.syncing) { this.rerun = true; return; }
    this.syncing = true;
    const generation = this.generation, selected = this.state.selected;
    const current = () => !this.disposed && !this.locked && generation === this.generation;
    try {
      const sessions = await this.api<{ items: ChatView['sessions'] }>('/api/sessions?limit=100', undefined, this.abort.signal);
      if (!current()) return;
      this.view.sessions = sessions.items ?? [];
      if (this.state.pending) await this.verifyPending();
      if (!current()) return;
      if (selected) {
        try {
          const [history, input] = await Promise.all([
            this.api<{ messages: ChatMessage[] }>(`/api/sessions/${selected}/messages?limit=100`, undefined, this.abort.signal),
            this.api<InputState>(`/api/sessions/${selected}/input-state`, undefined, this.abort.signal),
          ]);
          if (!current()) return;
          this.history = history.messages ?? [];
          for (const message of this.history) if (message.id && this.stream.get(message.id) === message.content) this.stream.delete(message.id);
          const next = input.activeRunId;
          if (this.runTopic && this.runTopic !== (next ? `run:${next}` : undefined)) this.realtime?.unsubscribe(this.runTopic);
          if (next && this.runTopic !== `run:${next}`) { this.runTopic = `run:${next}`; this.realtime?.subscribe(this.runTopic, 0); }
          if (!next) { this.runTopic = undefined; this.stream.clear(); }
          this.view.activeRun = next;
          if (!next && input.control?.phase === 'idle' && this.view.stop) this.view.stop = 'confirmed';
        } catch (error) { if (!(error instanceof ChatApiError && error.status === 404)) throw error; this.history = []; this.view.activeRun = undefined; }
      }
      if (!current()) return;
      this.view.phase = this.state.pending ? 'unknown' : this.chatEnabled ? 'ready' : 'recovery';
      if (!this.chatEnabled) this.view.notice = 'Gateway 未声明 S3 文本输入能力；当前仅可查看历史。';
      this.emit();
    } catch (error) {
      if (current()) {
        if (error instanceof ChatApiError && [401, 403, 409].includes(error.status)) this.fail(error);
        else { this.connected = false; this.view.phase = 'retrying'; this.realtime?.reconnect(); this.emit(); }
      }
    } finally {
      this.syncing = false;
      if (this.rerun) { this.rerun = false; if (!this.disposed) void this.refresh(); }
    }
  }
  async verifyPending() {
    const pending = this.state.pending;
    if (!pending || this.disposed) return;
    try {
      const receipt = await this.api<Receipt>(`/api/sessions/${pending.conversationId}/input-receipts/${pending.clientMessageId}`, undefined, this.abort.signal);
      if (this.disposed || this.state.pending !== pending) return;
      if (receipt.receipt.clientMessageId !== pending.clientMessageId || receipt.receipt.conversationId !== pending.conversationId) throw new Error('CHAT_RECEIPT_MISMATCH');
      this.state.pending = undefined; delete this.state.drafts[pending.conversationId];
      await this.persist(); this.view.notice = '输入已由服务器接收；未重复提交。'; this.emit();
    } catch (error) {
      if (this.disposed || this.locked) return;
      if (error instanceof ChatApiError && [401, 403, 409].includes(error.status)) { this.fail(error); return; }
      this.view.phase = 'unknown'; this.view.notice = '上次输入尚待核实；不会自动重发。可稍后核实或返回连接配置。'; this.emit();
    }
  }
  async draft(text: string) {
    if (text.length > 8192 || !this.state.selected || this.disposed || this.locked || this.submitting || this.state.pending) return;
    const selected = this.state.selected;
    if (!text) delete this.state.drafts[selected];
    else {
      if (!this.state.drafts[selected] && Object.keys(this.state.drafts).length >= 20) throw new Error('最多保留 20 份草稿，请先清理已有草稿。');
      this.state.drafts[selected] = text;
    }
    this.emit(); await this.persist();
  }
  async select(conversationId: string = crypto.randomUUID()) {
    if (this.disposed || this.submitting || this.locked) return;
    await this.writeQueue;
    this.state.selected = conversationId; this.history = []; this.stream.clear(); this.view.stop = ''; this.view.activeRun = undefined;
    await this.persist(); this.startRealtime(); this.emit();
  }
  choose(model: string, agent: string) { this.view.model = model; this.view.agent = agent; this.emit(); }
  async send() {
    if (this.disposed || this.locked || this.submitting || this.state.pending || !this.chatEnabled || this.view.phase !== 'ready' || !this.state.selected) return;
    const conversationId = this.state.selected, text = this.state.drafts[conversationId]?.trim();
    if (!text) return;
    this.submitting = true; this.view.phase = 'syncing'; this.emit();
    let posted = false;
    try {
      await this.writeQueue;
      let command: unknown;
      const common = { clientMessageId: crypto.randomUUID(), input: { content: text }, origin: { type: 'system', source: 'cli' } };
      try {
        const [session, config] = await Promise.all([
          this.api<{ session: { transcriptId: string } }>(`/api/sessions/${conversationId}`, undefined, this.abort.signal),
          this.api<{ configVersion: number }>(`/api/sessions/${conversationId}/agent-config`, undefined, this.abort.signal),
        ]);
        command = { ...common, kind: 'append', expectedTranscriptId: session.session.transcriptId, configVersion: config.configVersion, delivery: 'next' };
      } catch (error) {
        if (!(error instanceof ChatApiError && error.status === 404)) throw error;
        const model = this.view.models.find(model => model.id === this.view.model);
        if (!model || !this.view.agent) throw new Error('请选择已配置的服务器模型和 Agent。');
        command = { ...common, kind: 'start', creation: { agentId: this.view.agent, projectId: null, execution: null, temporary: false,
          model: model.id, thinkingLevel: model.thinking?.initialValue ?? 'off' } };
      }
      if (this.disposed || this.locked || !this.connected) return;
      this.state.pending = { conversationId, clientMessageId: common.clientMessageId, createdAt: Date.now() };
      await this.persist(); this.emit();
      posted = true;
      await this.api<Receipt>(`/api/sessions/${conversationId}/inputs`, command, this.abort.signal);
      await this.verifyPending();
      await this.refresh();
    } catch (error) {
      if (!this.disposed) {
        if (!posted) this.fail(error);
        else if (error instanceof ChatApiError && [400, 404, 409, 422, 429].includes(error.status) && !error.code.startsWith('GATEWAY_')) {
          this.state.pending = undefined; await this.persist(); this.view.notice = `服务器未接受输入：${error.code}。请刷新后检查草稿。`;
        } else { this.view.phase = 'unknown'; this.view.notice = '输入结果未知，正在等待核实；不会自动重发。'; this.emit(); }
      }
    } finally { this.submitting = false; if (!this.disposed && !this.locked) void this.refresh(); }
  }
  async stop() {
    if (!this.view.activeRun || this.locked || this.disposed || this.view.stop === 'requested') return;
    this.view.stop = 'requested'; this.emit();
    try { await this.api('/api/agent/abort', { runId: this.view.activeRun }, this.abort.signal); this.view.stop = 'acknowledged'; await this.refresh(); }
    catch { if (!this.disposed) this.view.stop = 'unknown'; }
    this.emit();
  }
  dispose() { this.disposed = true; this.generation++; this.abort.abort(); this.realtime?.disconnect(); clearInterval(this.timer); this.history = []; this.stream.clear(); }
  async flush() { await this.writeQueue; }
}
