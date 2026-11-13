import { generatedMediaCards, generatedMediaPath } from '../common/generatedMedia';
import { XopcGeneratedMediaCard, XopcGeneratedMediaItem, XopcGeneratedMediaJobs, XopcGeneratedMediaKind } from '../model/generatedMedia';
import { gatewaySession } from '../service/gatewaySession';

interface XopcVideoDraftConfirmation { id: string; revision: number; }

@ObservedV2
export class XopcGeneratedMediaViewModel {
  @Trace cards: XopcGeneratedMediaCard[] = [];
  @Trace submitting: boolean = false;
  @Trace failedDraftId: string = '';
  private conversationId: string = '';
  private scope: string = '';
  private observing: boolean = false;
  private generation: number = 0;
  private videoRevision: number = 0;
  private timer: number = -1;

  observe(id: string, scope: string, visible: boolean, busy: boolean): void {
    this.stop();
    if (scope !== this.scope) {
      this.scope = scope; this.videoRevision++;
      this.conversationId = id; this.cards = []; this.submitting = false; this.failedDraftId = '';
    }
    this.observing = visible && !!id;
    if (this.observing) void this.poll(id, busy, this.generation);
  }

  stop(): void {
    this.observing = false; this.generation++;
    clearTimeout(this.timer);
  }

  private async load(kind: XopcGeneratedMediaKind, id: string, generation: number, videoRevision: number): Promise<void> {
    try {
      const response = JSON.parse(await gatewaySession.request(generatedMediaPath(kind, id))) as XopcGeneratedMediaJobs;
      if (generation !== this.generation || !Array.isArray(response.jobs)) return;
      if (kind === 'video' && (this.submitting || videoRevision !== this.videoRevision)) return;
      this.replace(kind, generatedMediaCards(kind, response));
    } catch (_) {
      // An older gateway may omit a generation route. The other media type remains available.
    }
  }

  private async poll(id: string, busy: boolean, generation: number): Promise<void> {
    const revision = this.videoRevision;
    await Promise.all([this.load('music', id, generation, revision), this.load('video', id, generation, revision)]);
    if (generation !== this.generation) return;
    const active = this.cards.some((card: XopcGeneratedMediaCard): boolean =>
      ['queued', 'submitting', 'submitted', 'running', 'saving'].includes(card.item.state ?? ''));
    this.timer = setTimeout((): void => { void this.poll(id, busy, generation); }, busy || active ? 3000 : 20000);
  }

  private replace(kind: XopcGeneratedMediaKind, cards: XopcGeneratedMediaCard[]): void {
    const next = this.cards.filter((card: XopcGeneratedMediaCard): boolean => card.kind !== kind).concat(cards)
      .sort((left: XopcGeneratedMediaCard, right: XopcGeneratedMediaCard): number =>
        (left.item.draftCreatedAt ?? left.item.createdAt) - (right.item.draftCreatedAt ?? right.item.createdAt)
        || left.item.id.localeCompare(right.item.id));
    if (JSON.stringify(next) !== JSON.stringify(this.cards)) this.cards = next;
  }

  async confirm(card: XopcGeneratedMediaCard): Promise<void> {
    const id = this.conversationId;
    const revision = card.item.revision;
    if (!this.observing || !id || this.submitting || !card.draft || !card.canConfirm || revision === undefined) return;
    this.submitting = true; this.failedDraftId = '';
    const request = ++this.videoRevision;
    const connection = gatewaySession.connectionRevision();
    const payload: XopcVideoDraftConfirmation = { id: card.item.id, revision };
    try {
      const job = JSON.parse(await gatewaySession.request(generatedMediaPath('video', id) + '/confirm-draft',
        'POST', JSON.stringify(payload))) as XopcGeneratedMediaItem;
      gatewaySession.assertConnection(connection);
      if (id !== this.conversationId || request !== this.videoRevision) return;
      const jobs = this.cards.filter((entry: XopcGeneratedMediaCard): boolean =>
        entry.kind === 'video' && !entry.draft && entry.item.id !== job.id);
      jobs.push({ kind: 'video', item: job, draft: false, canConfirm: false });
      this.replace('video', jobs);
    } catch (_) {
      if (id === this.conversationId && request === this.videoRevision) this.failedDraftId = card.item.id;
    } finally {
      if (id === this.conversationId && request === this.videoRevision) {
        this.submitting = false;
        if (this.observing) await this.load('video', id, this.generation, request);
      }
    }
  }
}
