import { gatewaySession } from '../service/gatewaySession';
import { realtimeClient } from '../service/realtimeClient';
import { XopcDeviceCrypto } from '../service/deviceCrypto';
import { XopcPayload } from '../model/realtime';
import {
  XopcSessionList, XopcHistory, XopcCreatedSession, XopcCreateSession, XopcInput,
  XopcInputResult, XopcRun, XopcAbort, XopcRename, XopcChatAttachment
} from '../model/chat';

export class XopcChatRepository {
  private crypto: XopcDeviceCrypto = new XopcDeviceCrypto();
  async list(search: string = '', offset: number = 0): Promise<XopcSessionList> {
    const result = JSON.parse(await gatewaySession.request('/api/sessions?limit=30&offset=' + offset
      + '&channel=webchat&sortBy=updatedAt&sortOrder=desc&search=' + encodeURIComponent(search))) as XopcSessionList;
    if (!Array.isArray(result.items) || typeof result.hasMore !== 'boolean') throw new Error('INVALID_SESSION_LIST');
    return result;
  }
  async create(projectId?: string, agentId?: string): Promise<string> {
    const body: XopcCreateSession = { channel: 'webchat', projectId, agentId };
    const result = JSON.parse(await gatewaySession.request('/api/sessions', 'POST', JSON.stringify(body))) as XopcCreatedSession;
    if (!result.session?.key) throw new Error('INVALID_SESSION');
    return result.session.key;
  }
  async history(id: string, before: string = ''): Promise<XopcHistory> {
    return JSON.parse(await gatewaySession.request('/api/sessions/' + encodeURIComponent(id) + '/history?limit=50'
      + (before ? '&before=' + encodeURIComponent(before) : ''))) as XopcHistory;
  }
  async activeRun(id: string): Promise<XopcRun> {
    const result = JSON.parse(await gatewaySession.request('/api/sessions/' + encodeURIComponent(id) + '/run')) as XopcPayload<XopcRun>;
    if (!result.payload || typeof result.payload.active !== 'boolean') throw new Error('INVALID_RUN');
    return result.payload;
  }
  async send(id: string, content: string, clientMessageId: string, transcriptId?: string, attachments: XopcChatAttachment[] = []): Promise<string> {
    const body: XopcInput = { clientMessageId, expectedTranscriptId: transcriptId, content, delivery: 'next',
      origin: realtimeClient.turnClaim(), attachments: attachments.length ? attachments : undefined };
    const result = JSON.parse(await gatewaySession.request('/api/sessions/' + encodeURIComponent(id) + '/inputs', 'POST', JSON.stringify(body))) as XopcPayload<XopcInputResult>;
    if (!result.payload?.state) throw new Error('INVALID_INPUT_RESPONSE');
    return result.payload.state.activeRunId ?? '';
  }
  uuid(): string { return this.crypto.uuid(); }
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
    const path = '/api/sessions/' + encodeURIComponent(id);
    await gatewaySession.request(action === 'delete' ? path : path + '/' + action, action === 'delete' ? 'DELETE' : 'POST', '{}');
  }
}
