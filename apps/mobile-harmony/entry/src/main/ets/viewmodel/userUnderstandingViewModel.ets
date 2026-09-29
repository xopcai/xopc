import {
  XopcUnderstandingItem,
  XopcUnderstandingItemResponse,
  XopcUnderstandingPage,
  XopcUnderstandingProfile,
  XopcUnderstandingSummary
} from '../model/userUnderstanding';
import { gatewaySession } from '../service/gatewaySession';

@ObservedV2
export class XopcUserUnderstandingViewModel {
  @Trace summary?: XopcUnderstandingSummary;
  @Trace items: XopcUnderstandingItem[] = [];
  @Trace selected?: XopcUnderstandingItem;
  @Trace filter: string = 'all';
  @Trace query: string = '';
  @Trace loading: boolean = true;
  @Trace loadingMore: boolean = false;
  @Trace saving: boolean = false;
  @Trace error: string = '';
  @Trace nextCursor: string = '';
  private generation: number = 0;
  private requestRevision: number = 0;
  private searchTimer: number = -1;

  dispose(): void { this.generation++; this.requestRevision++; clearTimeout(this.searchTimer); }

  async refresh(): Promise<void> {
    const generation = ++this.generation;
    this.loading = true;
    try {
      const text = await gatewaySession.request('/api/user-model/mobile-summary');
      const result = JSON.parse(text) as XopcUnderstandingSummary;
      if (generation !== this.generation) return;
      this.summary = result;
      this.error = '';
    } catch (error) {
      if (generation === this.generation) this.error = (error as Error).message;
    } finally {
      if (generation === this.generation) this.loading = false;
    }
  }

  async load(filter: string): Promise<void> {
    this.filter = filter;
    this.items = [];
    this.nextCursor = '';
    await this.loadPage(false);
  }

  search(query: string): void {
    this.query = query;
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout((): void => { void this.load(this.filter); }, 300);
  }

  async loadMore(): Promise<void> { if (this.nextCursor && !this.loadingMore) await this.loadPage(true); }

  private async loadPage(append: boolean): Promise<void> {
    const generation = this.generation;
    const requestRevision = ++this.requestRevision;
    this.loadingMore = true;
    try {
      let path = '/api/user-model/assertions?view=mobile&limit=20&filter=' + encodeURIComponent(this.filter);
      if (this.query.trim()) path += '&q=' + encodeURIComponent(this.query.trim());
      if (append && this.nextCursor) path += '&cursor=' + encodeURIComponent(this.nextCursor);
      const result = JSON.parse(await gatewaySession.request(path)) as XopcUnderstandingPage;
      if (generation !== this.generation || requestRevision !== this.requestRevision) return;
      this.items = append ? this.items.concat(result.items) : result.items;
      this.nextCursor = result.nextCursor ?? '';
      this.error = '';
    } catch (error) {
      if (generation === this.generation && requestRevision === this.requestRevision) this.error = (error as Error).message;
    } finally {
      if (generation === this.generation && requestRevision === this.requestRevision) this.loadingMore = false;
    }
  }

  async open(id: string): Promise<void> {
    try {
      const result = JSON.parse(await gatewaySession.request('/api/user-model/assertions/' + encodeURIComponent(id))) as XopcUnderstandingItemResponse;
      this.selected = result.assertion;
      this.error = '';
    } catch (error) { this.error = (error as Error).message; }
  }

  close(): void { this.selected = undefined; }

  async saveProfile(profile: XopcUnderstandingProfile): Promise<void> {
    this.saving = true;
    try {
      await gatewaySession.request('/api/user-model/profile', 'PATCH', JSON.stringify(profile));
      await this.refresh();
    } catch (error) { this.error = (error as Error).message; }
    finally { this.saving = false; }
  }

  async saveStatement(statement: string): Promise<void> {
    if (!this.selected) return;
    this.saving = true;
    try {
      await gatewaySession.request('/api/user-model/assertions/' + encodeURIComponent(this.selected.id), 'PATCH',
        JSON.stringify({ 'statement': statement }));
      await this.open(this.selected.id);
      await this.refresh();
      await this.load(this.filter);
    } catch (error) { this.error = (error as Error).message; }
    finally { this.saving = false; }
  }

  async removeSelected(): Promise<void> {
    if (!this.selected) return;
    this.saving = true;
    try {
      await gatewaySession.request('/api/user-model/assertions/' + encodeURIComponent(this.selected.id), 'DELETE');
      this.selected = undefined;
      await this.refresh();
      await this.load(this.filter);
    } catch (error) { this.error = (error as Error).message; }
    finally { this.saving = false; }
  }
}
