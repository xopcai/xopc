import { XopcPersonalAgentRecord, XopcPersonalAgentResponse, XopcPersonalReadRequest, XopcPersonalReadTarget,
  XopcPersonalUnreadResponse, XopcPersonalUnreadSnapshot } from '../model/personalAgent';
import { gatewaySession } from '../service/gatewaySession';

@ObservedV2
export class XopcPersonalAgentViewModel {
  @Trace record: XopcPersonalAgentRecord | null = null;
  @Trace loading: boolean = false;
  @Trace creating: boolean = false;
  @Trace error: string = '';
  @Trace unreadSnapshot: XopcPersonalUnreadSnapshot | null = null;
  private requestRevision: number = 0;
  private unreadConnection: number = -1;
  private unreadRevision: number = 0;
  private pendingCreate?: Promise<XopcPersonalAgentRecord | null>;

  async refresh(): Promise<void> {
    const revision = ++this.requestRevision;
    const connection = gatewaySession.connectionRevision();
    this.loading = true;
    this.error = '';
    try {
      const response = JSON.parse(await gatewaySession.request('/api/personal-agent')) as XopcPersonalAgentResponse;
      gatewaySession.assertConnection(connection);
      if (revision !== this.requestRevision) return;
      if (!response.ok) throw new Error(response.error ?? 'PERSONAL_AGENT_UNAVAILABLE');
      this.record = response.payload;
    } catch (error) {
      if (revision === this.requestRevision) { this.record = null; this.error = (error as Error).message; }
    } finally {
      if (revision === this.requestRevision) this.loading = false;
    }
  }

  async openOrCreate(): Promise<XopcPersonalAgentRecord | null> {
    if (this.record?.state === 'ready') return this.record;
    if (this.pendingCreate) return this.pendingCreate;
    const pending = this.createPersonalAgent();
    this.pendingCreate = pending;
    try { return await pending; }
    finally { if (this.pendingCreate === pending) this.pendingCreate = undefined; }
  }

  async refreshUnread(viewed: () => XopcPersonalReadTarget | undefined): Promise<void> {
    const revision = ++this.unreadRevision;
    const connection = gatewaySession.connectionRevision();
    if (connection !== this.unreadConnection) {
      this.unreadConnection = connection;
      this.unreadSnapshot = null;
    }
    try {
      const response = JSON.parse(await gatewaySession.request('/api/personal-agent/unread')) as XopcPersonalUnreadResponse;
      gatewaySession.assertConnection(connection);
      if (!response.ok || revision !== this.unreadRevision) return;
      const snapshot = response.payload;
      this.unreadSnapshot = snapshot;
      const target = viewed();
      if (!snapshot || snapshot.unreadCount <= 0 || target?.conversationId !== snapshot.conversationId ||
        target.transcriptId !== snapshot.transcriptId || target.lastSeq <= 0) return;
      const body: XopcPersonalReadRequest = { transcriptId: snapshot.transcriptId,
        lastSeq: Math.min(snapshot.lastSeq, target.lastSeq) };
      const confirmed = JSON.parse(await gatewaySession.request('/api/personal-agent/read', 'POST',
        JSON.stringify(body))) as XopcPersonalUnreadResponse;
      gatewaySession.assertConnection(connection);
      if (confirmed.ok && revision === this.unreadRevision) this.unreadSnapshot = confirmed.payload;
    } catch (_) { /* Keep the last server-confirmed count until the next refresh. */ }
  }

  private async createPersonalAgent(): Promise<XopcPersonalAgentRecord | null> {
    const revision = ++this.requestRevision;
    const connection = gatewaySession.connectionRevision();
    this.creating = true;
    this.error = '';
    try {
      const response = JSON.parse(await gatewaySession.request('/api/personal-agent', 'POST', '{}')) as XopcPersonalAgentResponse;
      gatewaySession.assertConnection(connection);
      if (revision !== this.requestRevision) return null;
      if (!response.ok || !response.payload || response.payload.state !== 'ready') {
        throw new Error(response.error ?? response.payload?.errorMessage ?? 'PERSONAL_AGENT_UNAVAILABLE');
      }
      this.record = response.payload;
      return response.payload;
    } catch (error) {
      if (revision === this.requestRevision) this.error = (error as Error).message;
      return null;
    } finally {
      if (revision === this.requestRevision) this.creating = false;
    }
  }
}
