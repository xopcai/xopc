import { generatedMediaCards, generatedMediaPath, isGeneratedMediaInProgress } from '../common/generatedMedia';
import { XopcGeneratedMediaCard, XopcGeneratedMediaItem, XopcGeneratedMediaJobs, XopcGeneratedMediaKind } from '../model/generatedMedia';
import { gatewaySession } from '../service/gatewaySession';
import { XopcListSnapshots } from '../service/listSnapshots';

interface XopcVideoDraftConfirmation { id: string; revision: number; }
const mediaSnapshots = new XopcListSnapshots<XopcGeneratedMediaCard[]>();

@ObservedV2
export class XopcGeneratedMediaViewModel {
  @Trace cards: XopcGeneratedMediaCard[] = [];
  @Trace submitting: boolean = false;
  @Trace failedDraftId: string = '';
  private conversationId: string = '';
  private scope: string = '';
  private transcriptId: string = '';
  private observing: boolean = false;
  private connectionRevision: number = 0;
  private generation: number = 0;
  private videoRevision: number = 0;
  private pollTimers: Map<XopcGeneratedMediaKind, number> = new Map<XopcGeneratedMediaKind, number>();

  observe(id: string, scope: string, transcriptId: string, visible: boolean, busy: boolean): void {
    this.stop();
    if (scope !== this.scope) {
      this.scope = scope; this.videoRevision++;
      this.conversationId = id; this.transcriptId = transcriptId;
      this.cards = (mediaSnapshots.read(scope, 'jobs') ?? []).map((card: XopcGeneratedMediaCard): XopcGeneratedMediaCard =>
        card.canConfirm ? { kind: card.kind, item: card.item, draft: card.draft, canConfirm: false } : card);
      this.submitting = false; this.failedDraftId = '';
    }
    this.observing = visible && !!id && !!scope && !!transcriptId;
    if (this.observing) {
      this.connectionRevision = gatewaySession.connectionRevision();
      void this.poll('music', id, busy, this.generation);
      void this.poll('video', id, busy, this.generation);
    }
  }

  stop(): void {
    this.observing = false; this.generation++;
    this.pollTimers.forEach((timer: number): void => { clearTimeout(timer); });
    this.pollTimers.clear();
  }

  private async load(kind: XopcGeneratedMediaKind, id: string, generation: number, videoRevision: number): Promise<void> {
    try {
      const connection = this.connectionRevision;
      gatewaySession.assertConnection(connection);
      const response = JSON.parse(await gatewaySession.request(generatedMediaPath(kind, id))) as XopcGeneratedMediaJobs;
      gatewaySession.assertConnection(connection);
      if (generation !== this.generation || !Array.isArray(response.jobs)) return;
      if (response.transcriptId && response.transcriptId !== this.transcriptId) return;
      if (kind === 'video' && (this.submitting || videoRevision !== this.videoRevision)) return;
      this.replace(kind, generatedMediaCards(kind, response));
    } catch (_) {
      // An older gateway may omit a generation route. The other media type remains available.
    }
  }

  private async poll(kind: XopcGeneratedMediaKind, id: string, busy: boolean, generation: number): Promise<void> {
    await this.load(kind, id, generation, this.videoRevision);
    if (generation !== this.generation) return;
    const active = this.cards.some((card: XopcGeneratedMediaCard): boolean =>
      card.kind === kind && isGeneratedMediaInProgress(card.item));
    this.pollTimers.set(kind, setTimeout((): void => { void this.poll(kind, id, busy, generation); }, busy || active ? 3000 : 20000));
  }

  private replace(kind: XopcGeneratedMediaKind, cards: XopcGeneratedMediaCard[]): void {
    const previousById = new Map<string, XopcGeneratedMediaCard>();
    for (const card of this.cards) {
      if (card.kind === kind) previousById.set(card.item.id, card);
    }
    const updated = cards.map((card: XopcGeneratedMediaCard): XopcGeneratedMediaCard => {
      const previous = previousById.get(card.item.id);
      return previous && JSON.stringify(previous) === JSON.stringify(card) ? previous : card;
    });
    const incoming = new Set<string>(updated.map((card: XopcGeneratedMediaCard): string => card.item.id));
    // Job snapshots can lag or omit older results. Drafts are governed by the current response.
    const next = this.cards.filter((card: XopcGeneratedMediaCard): boolean =>
      card.kind !== kind || (!card.draft && !incoming.has(card.item.id))).concat(updated)
      .sort((left: XopcGeneratedMediaCard, right: XopcGeneratedMediaCard): number =>
        (left.item.draftCreatedAt ?? left.item.createdAt) - (right.item.draftCreatedAt ?? right.item.createdAt)
        || left.item.id.localeCompare(right.item.id));
    if (next.length !== this.cards.length
      || next.some((card: XopcGeneratedMediaCard, index: number): boolean => card !== this.cards[index])) this.cards = next;
    mediaSnapshots.write(this.scope, 'jobs', next, Date.now());
  }

  async confirm(card: XopcGeneratedMediaCard): Promise<void> {
    const id = this.conversationId;
    const revision = card.item.revision;
    if (!this.observing || !id || this.submitting || !card.draft || !card.canConfirm || revision === undefined) return;
    this.submitting = true; this.failedDraftId = '';
    const request = ++this.videoRevision;
    const connection = this.connectionRevision;
    const payload: XopcVideoDraftConfirmation = { id: card.item.id, revision };
    try {
      gatewaySession.assertConnection(connection);
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
