import { gatewaySession } from '../service/gatewaySession';
import { realtimeClient } from '../service/realtimeClient';
import { XopcDeviceCrypto } from '../service/deviceCrypto';
import { XopcPayload } from '../model/realtime';
import { XopcSecureStore } from '../service/secureStore';
import { chatHistoryCache } from '../service/chatHistoryCache';
import {
  XopcSessionList, XopcSessionItem, XopcHistory, XopcCreatedSession, XopcCreateSession, XopcInput,
  XopcInputResult, XopcRun, XopcAbort, XopcRename, XopcChatAttachment,
  XopcChatModels, XopcChatAgents, XopcAgentConfig, XopcQueueState, XopcQueuedInput, XopcQueueUpdate, XopcContextRef
} from '../model/chat';

export class XopcChatRepository {
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
    const result = JSON.parse(await gatewaySession.request('/api/sessions', 'POST', JSON.stringify(body))) as XopcCreatedSession;
    if (!result.session?.key) throw new Error('INVALID_SESSION');
    return result.session.key;
  }
  async history(id: string, before: string = ''): Promise<XopcHistory> {
    const revision = chatHistoryCache.revision();
    const gatewayId = gatewaySession.currentProfile()?.gatewayId || '';
    const page = JSON.parse(await gatewaySession.request('/api/sessions/' + encodeURIComponent(id) + '/history?limit=50'
      + (before ? '&before=' + encodeURIComponent(before) : ''))) as XopcHistory;
    if (!before) { this.cachePage = page; this.cacheGatewayId = gatewayId; this.cacheRevision = revision; }
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
    const result = JSON.parse(await gatewaySession.request('/api/sessions/' + encodeURIComponent(id) + '/run')) as XopcPayload<XopcRun>;
    if (!result.payload || typeof result.payload.active !== 'boolean') throw new Error('INVALID_RUN');
    return result.payload;
  }
  async send(id: string, content: string, clientMessageId: string, transcriptId?: string, attachments: XopcChatAttachment[] = [], delivery: string = 'next', refs: XopcContextRef[] = []): Promise<string> {
    const body: XopcInput = { clientMessageId, expectedTranscriptId: transcriptId, content, delivery,
      origin: realtimeClient.turnClaim(), attachments: attachments.length ? attachments : undefined,
      contextRefs: refs.length ? refs.map((ref: XopcContextRef): XopcContextRef => ({ kind: ref.kind, sourceId: ref.sourceId, expectedVersion: ref.expectedVersion })) : undefined };
    const result = JSON.parse(await gatewaySession.request('/api/sessions/' + encodeURIComponent(id) + '/inputs', 'POST', JSON.stringify(body))) as XopcPayload<XopcInputResult>;
    if (!result.payload?.state) throw new Error('INVALID_INPUT_RESPONSE');
    return result.payload.state.activeRunId ?? '';
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
    const result = JSON.parse(await gatewaySession.request('/api/sessions/' + encodeURIComponent(id) + '/agent-config')) as XopcPayload<XopcAgentConfig>;
    if (!result.payload) throw new Error('INVALID_AGENT_CONFIG');
    return result.payload;
  }
  async setModel(id: string, model: string): Promise<void> {
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
    const result = JSON.parse(await gatewaySession.request('/api/sessions/' + encodeURIComponent(id) + '/input-state')) as XopcPayload<XopcQueueState>;
    if (result.payload?.conversationId !== id || !Array.isArray(result.payload.inputs)) throw new Error('INVALID_INPUT_STATE');
    return result.payload;
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
