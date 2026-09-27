import { gatewaySession } from '../service/gatewaySession';
import { realtimeClient } from '../service/realtimeClient';
import { XopcDeviceCrypto } from '../service/deviceCrypto';
import { XopcPayload } from '../model/realtime';
import { XopcSecureStore } from '../service/secureStore';
import { chatHistoryCache } from '../service/chatHistoryCache';
import { localSessionStore } from '../service/localSessionStore';
import { XopcHttpError } from '../service/transport';
import { XopcLocalSession, XopcSessionCreation, XopcSessionCommand, XopcSessionCommandResult, XopcSessionInputContent, XopcInputAttachment, XopcMaterializeCommand } from '../model/sessionCommand';
import {
  XopcSessionList, XopcSessionItem, XopcHistory, XopcCreateSession,
  XopcRun, XopcAbort, XopcRename, XopcChatAttachment,
  XopcChatModels, XopcChatAgents, XopcAgentConfig, XopcQueueState, XopcQueuedInput, XopcQueueUpdate, XopcContextRef
} from '../model/chat';

interface XopcPreparationRetry { operationId: string; expectedRevision: number; idempotencyKey: string; }
interface XopcCommandFailure { error?: XopcCommandFailureCode; }
interface XopcCommandFailureCode { code?: string; }

export class XopcChatRepository {
  private rejected(error: Error): boolean {
    if (!(error instanceof XopcHttpError) || (error.status !== 400 && error.status !== 409 && error.status !== 410)) return false;
    try {
      const failure = JSON.parse(error.body) as XopcCommandFailure;
      return ['BAD_REQUEST', 'CONFIG_CHANGED', 'SESSION_CHANGED', 'SESSION_DELETED', 'SESSION_BUSY', 'QUEUE_FULL'].includes(failure.error?.code ?? '');
    } catch (_) { return false; }
  }
  private crypto: XopcDeviceCrypto = new XopcDeviceCrypto();
  private store: XopcSecureStore = new XopcSecureStore();
  private cachePage?: XopcHistory;
  private cacheGatewayId: string = '';
  private cacheRevision: number = -1;
  async mainConversation(): Promise<string> {
    const gatewayId = gatewaySession.currentProfile()?.gatewayId;
    return gatewayId ? await this.store.read('main-chat.' + gatewayId) ?? '' : '';
  }
  async saveMainConversation(id: string): Promise<void> {
    const gatewayId = gatewaySession.currentProfile()?.gatewayId;
    if (gatewayId) await this.store.write('main-chat.' + gatewayId, id);
  }
  async list(search: string = '', offset: number = 0, limit: number = 30, channel: string = 'webchat'): Promise<XopcSessionList> {
    const result = JSON.parse(await gatewaySession.request('/api/sessions?limit=' + limit + '&offset=' + offset
      + (channel ? '&channel=' + encodeURIComponent(channel) : '')
      + '&sortBy=updatedAt&sortOrder=desc&search=' + encodeURIComponent(search.trim()))) as XopcSessionList;
    if (!Array.isArray(result.items) || typeof result.hasMore !== 'boolean') throw new Error('INVALID_SESSION_LIST');
    if (result.items.some((item: XopcSessionItem): boolean => !item || typeof item.key !== 'string' || !item.key
      || typeof item.updatedAt !== 'string' || typeof item.messageCount !== 'number')) throw new Error('INVALID_SESSION_LIST');
    return result;
  }
  async create(projectId?: string | null, agentId?: string, executionMode?: string): Promise<string> {
    const scope = localSessionStore.scope();
    const body: XopcCreateSession = { channel: 'webchat', projectId, agentId, executionMode };
    const gatewayId = gatewaySession.currentProfile()?.gatewayId;
    if (gatewayId && agentId) {
      const raw = await this.store.read('chat-model.' + gatewayId + '.' + agentId);
      if (raw) {
        try {
          const config = JSON.parse(raw) as XopcAgentConfig;
          if (typeof config.model === 'string' && config.model) body.initialAgentConfig = { model: config.model,
            thinkingLevel: typeof config.thinkingLevel === 'string' ? config.thinkingLevel : undefined };
        } catch (_) { /* Invalid preference records do not replace the Gateway defaults. */ }
      }
    }
    const id = this.uuid();
    const creation: XopcSessionCreation = { agentId: agentId || 'main', projectId: projectId || null,
      execution: executionMode ? { mode: executionMode } : null, temporary: false,
      model: body.initialAgentConfig?.model || '', thinkingLevel: body.initialAgentConfig?.thinkingLevel || 'off' };
    await localSessionStore.save({ conversationId: id, creation, createdAt: new Date().toISOString() }, scope);
    return id;
  }
  async draft(id: string): Promise<XopcLocalSession | undefined> { return localSessionStore.read(id); }
  async pendingInput(id: string): Promise<XopcSessionCommand | undefined> {
    return await localSessionStore.readCommand(id, localSessionStore.scope()) ?? (await this.draft(id))?.command;
  }
  async reconcile(id: string): Promise<void> {
    const scope = localSessionStore.scope();
    const connection = gatewaySession.connectionRevision();
    const draft = await this.draft(id);
    const pending = await localSessionStore.readCommand(id, scope);
    const commandId = pending?.clientMessageId ?? draft?.command?.clientMessageId ?? draft?.materialization?.commandId;
    if (!commandId) return;
    gatewaySession.assertConnection(connection);
    try {
      const result = JSON.parse(await gatewaySession.request('/api/sessions/' + encodeURIComponent(id)
        + '/input-receipts/' + encodeURIComponent(commandId))) as XopcPayload<XopcSessionCommandResult>;
      gatewaySession.assertConnection(connection);
      if (result.payload?.receipt.conversationId !== id || result.payload.receipt.clientMessageId !== commandId) throw new Error('INVALID_INPUT_RECEIPT');
      if (draft?.materialization && result.payload.receipt.lifecycle !== 'ready') return;
      await localSessionStore.clearCommand(id, scope);
      await localSessionStore.remove(id, scope);
    } catch (error) {
      if (error instanceof XopcHttpError && error.status === 404) return;
      throw error as Error;
    }
  }
  async materialize(id: string, purpose: string): Promise<void> {
    const scope = localSessionStore.scope();
    const connection = gatewaySession.connectionRevision();
    await this.reconcile(id);
    gatewaySession.assertConnection(connection);
    const draft = await this.draft(id);
    if (!draft) return;
    if (draft.command) throw new Error('FIRST_INPUT_PENDING');
    if (!draft.creation.model) throw new Error('SELECT_MODEL_FIRST');
    draft.materialization ??= { commandId: this.uuid(), purpose };
    await localSessionStore.save(draft, scope);
    gatewaySession.assertConnection(connection);
    const body: XopcMaterializeCommand = { commandId: draft.materialization.commandId,
      purpose: draft.materialization.purpose, creation: draft.creation };
    let raw: string;
    try {
      raw = await gatewaySession.request('/api/sessions/' + encodeURIComponent(id) + '/materialize', 'POST', JSON.stringify(body));
    } catch (error) {
      if (this.rejected(error as Error)) { draft.materialization = undefined; await localSessionStore.save(draft, scope); }
      throw error as Error;
    }
    const result = JSON.parse(raw) as XopcPayload<XopcSessionCommandResult>;
    gatewaySession.assertConnection(connection);
    if (result.payload?.receipt.conversationId !== id || result.payload.receipt.clientMessageId !== body.commandId) throw new Error('INVALID_INPUT_RECEIPT');
    if (result.payload.receipt.lifecycle !== 'ready') throw new Error('SESSION_PREPARING');
    await localSessionStore.remove(id, scope);
  }
  async history(id: string, before: string = '', transcriptId: string = ''): Promise<XopcHistory> {
    const connection = gatewaySession.connectionRevision();
    await this.reconcile(id);
    gatewaySession.assertConnection(connection);
    const draft = await this.draft(id);
    gatewaySession.assertConnection(connection);
    if (draft) return { session: { key: id, agentId: draft.creation.agentId, projectId: draft.creation.projectId || undefined, messages: [] }, pagination: { hasMore: false } };
    const revision = chatHistoryCache.revision();
    const gatewayId = gatewaySession.currentProfile()?.gatewayId || '';
    if (before && transcriptId) {
      const cached = await chatHistoryCache.readPage(gatewayId, id, transcriptId, before);
      gatewaySession.assertConnection(connection);
      if (cached) return cached;
    }
    const page = JSON.parse(await gatewaySession.request('/api/sessions/' + encodeURIComponent(id) + '/history?limit=' + (before ? 100 : 150)
      + (before ? '&before=' + encodeURIComponent(before) : ''))) as XopcHistory;
    if (!before) { this.cachePage = page; this.cacheGatewayId = gatewayId; this.cacheRevision = revision; }
    else if (transcriptId && page.session?.transcriptId === transcriptId && revision === chatHistoryCache.revision()
      && gatewayId === gatewaySession.currentProfile()?.gatewayId) {
      await chatHistoryCache.writePage(gatewayId, id, transcriptId, before, page);
    }
    return page;
  }
  async cachedHistory(id: string): Promise<XopcHistory | undefined> {
    const revision = gatewaySession.connectionRevision();
    const page = await chatHistoryCache.read(gatewaySession.currentProfile()?.gatewayId || '', id);
    gatewaySession.assertConnection(revision);
    return page;
  }
  async rememberHistory(id: string, page: XopcHistory): Promise<void> {
    if (page !== this.cachePage || this.cacheRevision !== chatHistoryCache.revision()
      || this.cacheGatewayId !== gatewaySession.currentProfile()?.gatewayId) return;
    await chatHistoryCache.write(this.cacheGatewayId, id, page);
  }
  async activeRun(id: string): Promise<XopcRun> {
    if (await this.draft(id)) return { active: false };
    const result = JSON.parse(await gatewaySession.request('/api/sessions/' + encodeURIComponent(id) + '/run')) as XopcPayload<XopcRun>;
    if (!result.payload || typeof result.payload.active !== 'boolean') throw new Error('INVALID_RUN');
    return result.payload;
  }
  async send(id: string, content: string, clientMessageId: string, transcriptId?: string, attachments: XopcChatAttachment[] = [], delivery: string = 'next', refs: XopcContextRef[] = []): Promise<string> {
    const scope = localSessionStore.scope();
    const connection = gatewaySession.connectionRevision();
    const draft = await this.draft(id);
    gatewaySession.assertConnection(connection);
    const input: XopcSessionInputContent = { content, attachments: attachments.length ? attachments.map((item: XopcChatAttachment): XopcInputAttachment => ({
      type: item.type, name: item.name, mimeType: item.mimeType, size: item.size, data: item.data,
      workspaceRelativePath: item.workspaceRelativePath, uri: item.uri, durationSeconds: item.duration
    })) : undefined,
      contextRefs: refs.length ? refs.map((ref: XopcContextRef): XopcContextRef => ({ kind: ref.kind, sourceId: ref.sourceId, expectedVersion: ref.expectedVersion })) : undefined };
    let body: XopcSessionCommand;
    const pending = await localSessionStore.readCommand(id, scope);
    gatewaySession.assertConnection(connection);
    if (pending) {
      if (pending.clientMessageId !== clientMessageId || JSON.stringify(pending.input) !== JSON.stringify(input)) throw new Error('INPUT_PENDING');
      body = pending;
    } else if (draft) {
      if (draft.materialization) throw new Error('SESSION_PREPARING');
      if (draft.command && (draft.command.clientMessageId !== clientMessageId || JSON.stringify(draft.command.input) !== JSON.stringify(input))) throw new Error('FIRST_INPUT_PENDING');
      body = draft.command ?? { kind: 'start', clientMessageId, creation: draft.creation, input };
      if (!draft.creation.model) throw new Error('SELECT_MODEL_FIRST');
      draft.command = body;
      await localSessionStore.save(draft, scope);
    } else {
      const config = await this.config(id);
      if (!transcriptId) transcriptId = (await this.history(id)).session.transcriptId;
      if (!transcriptId || config.configVersion === undefined) throw new Error('SESSION_IDENTITY_UNAVAILABLE');
      body = { kind: 'append', clientMessageId, expectedTranscriptId: transcriptId,
        configVersion: config.configVersion, delivery, input };
    }
    gatewaySession.assertConnection(connection);
    await localSessionStore.saveCommand(id, body, scope);
    gatewaySession.assertConnection(connection);
    body.origin = realtimeClient.turnClaim();
    let raw: string;
    try {
      raw = await gatewaySession.request('/api/sessions/' + encodeURIComponent(id) + '/inputs', 'POST', JSON.stringify(body));
    } catch (error) {
      if (this.rejected(error as Error)) {
        await localSessionStore.clearCommand(id, scope);
        if (draft) { draft.command = undefined; await localSessionStore.save(draft, scope); }
      }
      throw error as Error;
    }
    const result = JSON.parse(raw) as XopcPayload<XopcSessionCommandResult>;
    gatewaySession.assertConnection(connection);
    if (!result.payload?.inputState || result.payload.receipt.conversationId !== id
      || result.payload.receipt.clientMessageId !== body.clientMessageId) throw new Error('INVALID_INPUT_RESPONSE');
    if (result.payload.receipt.transcriptId !== result.payload.session.transcriptId) throw new Error('SESSION_CHANGED');
    await localSessionStore.clearCommand(id, scope);
    if (draft) await localSessionStore.remove(id, scope);
    return result.payload.inputState.activeRunId ?? '';
  }
  uuid(): string { return this.crypto.uuid(); }
  async models(agentId: string): Promise<XopcChatModels> {
    const result = JSON.parse(await gatewaySession.request('/api/models' + (agentId ? '?agentId=' + encodeURIComponent(agentId) : ''))) as XopcPayload<XopcChatModels>;
    if (!result.payload || !Array.isArray(result.payload.models ?? result.payload.items)) throw new Error('INVALID_MODELS');
    return result.payload;
  }
  async agents(): Promise<XopcChatAgents> {
    const result = JSON.parse(await gatewaySession.request('/api/agents')) as XopcPayload<XopcChatAgents>;
    if (!Array.isArray(result.payload?.agents)) throw new Error('INVALID_AGENTS');
    return result.payload;
  }
  async config(id: string): Promise<XopcAgentConfig> {
    const draft = await this.draft(id);
    if (draft) return { model: draft.creation.model, thinkingLevel: draft.creation.thinkingLevel,
      workingDirectoryLocked: true, effectiveWorkspacePath: '' };
    const result = JSON.parse(await gatewaySession.request('/api/sessions/' + encodeURIComponent(id) + '/agent-config')) as XopcPayload<XopcAgentConfig>;
    if (!result.payload) throw new Error('INVALID_AGENT_CONFIG');
    return result.payload;
  }
  async setModel(id: string, model: string, thinkingLevel?: string): Promise<void> {
    const scope = localSessionStore.scope();
    const connection = gatewaySession.connectionRevision();
    const draft = await this.draft(id);
    gatewaySession.assertConnection(connection);
    if (draft) {
      if (draft.command || draft.materialization) throw new Error('FIRST_INPUT_PENDING');
      draft.creation.model = model;
      if (thinkingLevel !== undefined) draft.creation.thinkingLevel = thinkingLevel;
      await localSessionStore.save(draft, scope); return;
    }
    const body: XopcAgentConfig = { model };
    await gatewaySession.request('/api/sessions/' + encodeURIComponent(id) + '/agent-config', 'PATCH', JSON.stringify(body));
  }
  async rememberModel(agentId: string, model: string, thinkingLevel?: string): Promise<void> {
    const gatewayId = gatewaySession.currentProfile()?.gatewayId;
    if (gatewayId && agentId) {
      const config: XopcAgentConfig = { model, thinkingLevel };
      await this.store.write('chat-model.' + gatewayId + '.' + agentId, JSON.stringify(config));
    }
  }
  async queue(id: string): Promise<XopcQueueState> {
    const draft = await this.draft(id);
    if (draft && !draft.materialization) return { conversationId: id, inputs: [] };
    const result = JSON.parse(await gatewaySession.request('/api/sessions/' + encodeURIComponent(id) + '/input-state')) as XopcPayload<XopcQueueState>;
    if (result.payload?.conversationId !== id || !Array.isArray(result.payload.inputs)) throw new Error('INVALID_INPUT_STATE');
    return result.payload;
  }
  async retryPreparation(id: string, operationId: string, revision: number): Promise<void> {
    const body: XopcPreparationRetry = { operationId, expectedRevision: revision, idempotencyKey: operationId + ':' + revision.toString() };
    await gatewaySession.request('/api/sessions/' + encodeURIComponent(id) + '/preparation/retry', 'POST', JSON.stringify(body));
  }
  async changeQueued(id: string, input: XopcQueuedInput, content?: string): Promise<XopcQueueState> {
    const path = '/api/sessions/' + encodeURIComponent(id) + '/inputs/' + encodeURIComponent(input.id);
    const body: XopcQueueUpdate = { version: input.version, content: content ?? '' };
    const result = JSON.parse(await gatewaySession.request(content === undefined ? path + '?version=' + input.version : path,
      content === undefined ? 'DELETE' : 'PATCH', content === undefined ? undefined : JSON.stringify(body))) as XopcPayload<XopcQueueState>;
    if (result.payload?.conversationId !== id || !Array.isArray(result.payload.inputs)) throw new Error('INVALID_INPUT_STATE');
    return result.payload;
  }
  async abort(runId: string): Promise<void> {
    const body: XopcAbort = { runId };
    await gatewaySession.request('/api/agent/abort', 'POST', JSON.stringify(body));
  }
  async rename(id: string, name: string): Promise<void> {
    const body: XopcRename = { name };
    await gatewaySession.request('/api/sessions/' + encodeURIComponent(id) + '/rename', 'POST', JSON.stringify(body));
  }
  async action(id: string, action: string): Promise<void> {
    if (!['pin', 'unpin', 'archive', 'unarchive', 'reset', 'delete'].includes(action)) throw new Error('INVALID_ACTION');
    const gatewayId = gatewaySession.currentProfile()?.gatewayId || '';
    const connection = gatewaySession.connectionRevision();
    // Invalidate before mutation so an ambiguous response cannot resurrect a reset/deleted head.
    if (gatewayId && (action === 'delete' || action === 'reset')) await chatHistoryCache.remove(gatewayId, id);
    const path = '/api/sessions/' + encodeURIComponent(id);
    gatewaySession.assertConnection(connection);
    try {
      await gatewaySession.request(action === 'delete' ? path : path + '/' + action, action === 'delete' ? 'DELETE' : 'POST', '{}');
    } finally {
      if (gatewayId && (action === 'delete' || action === 'reset')) await chatHistoryCache.remove(gatewayId, id);
    }
  }
}
