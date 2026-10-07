import { XopcPersonalAgentRecord, XopcPersonalAgentResponse } from '../model/personalAgent';
import { gatewaySession } from '../service/gatewaySession';

@ObservedV2
export class XopcPersonalAgentViewModel {
  @Trace record: XopcPersonalAgentRecord | null = null;
  @Trace loading: boolean = false;
  @Trace creating: boolean = false;
  @Trace error: string = '';
  private requestRevision: number = 0;
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
