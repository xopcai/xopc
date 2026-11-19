import { personalWorkNeedsAttention, personalWorkStatus, XopcPersonalWorkItem } from '../model/personalOverview';
import { XopcPersonalOverviewRepository } from '../repository/personalOverviewRepository';
import { gatewaySession } from '../service/gatewaySession';

const PERSONAL_ACTIVITY_REFRESH_MS: number = 10000;

@ObservedV2
export class XopcPersonalChatActivityViewModel {
  @Trace private current: XopcPersonalWorkItem[] = [];
  private readonly repository: XopcPersonalOverviewRepository = new XopcPersonalOverviewRepository();
  private conversationId: string = '';
  private connectionRevision: number = -1;
  private generation: number = 0;
  private timer: number = -1;
  private loading: boolean = false;

  @Computed get attention(): XopcPersonalWorkItem[] { return this.current.filter(personalWorkNeedsAttention); }

  @Computed get working(): XopcPersonalWorkItem[] {
    return this.current.filter((item: XopcPersonalWorkItem): boolean => item.phase !== 'closed' &&
      !personalWorkNeedsAttention(item) && ['allocating', 'queued', 'running', 'verifying', 'waiting', 'in_progress']
        .includes(personalWorkStatus(item)));
  }

  observe(conversationId: string, active: boolean): void {
    this.stop();
    const revision = gatewaySession.connectionRevision();
    if (conversationId !== this.conversationId || revision !== this.connectionRevision) this.current = [];
    this.conversationId = conversationId;
    this.connectionRevision = revision;
    if (!conversationId || !active) return;
    this.timer = setInterval((): void => { void this.refresh(); }, PERSONAL_ACTIVITY_REFRESH_MS);
    void this.refresh();
  }

  stop(): void {
    this.generation++;
    clearInterval(this.timer);
    this.timer = -1;
    this.loading = false;
  }

  async refresh(): Promise<void> {
    if (this.timer === -1 || this.loading) return;
    const generation = this.generation;
    const revision = gatewaySession.connectionRevision();
    if (revision !== this.connectionRevision) {
      this.current = [];
      this.connectionRevision = revision;
    }
    this.loading = true;
    try {
      gatewaySession.assertConnection(revision);
      const current = await this.repository.currentWork();
      gatewaySession.assertConnection(revision);
      if (generation === this.generation) this.current = current;
    } catch (_) {
      // Retry on the next refresh and keep the last snapshot from this connection.
    } finally {
      if (generation === this.generation) this.loading = false;
    }
  }
}
