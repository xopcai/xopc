import { XopcSessionItem } from '../model/chat';
import { XopcChatRepository } from '../repository/chatRepository';
import { gatewaySession } from '../service/gatewaySession';

@ObservedV2
export class XopcSessionsViewModel {
  @Trace items: XopcSessionItem[] = [];
  @Trace search: string = '';
  @Trace loading: boolean = false;
  @Trace loadingMore: boolean = false;
  @Trace hasMore: boolean = false;
  @Trace error: string = '';
  @Trace actionError: string = '';
  @Trace busy: boolean = false;
  @Trace selecting: boolean = false;
  @Trace selected: string[] = [];
  @Trace hidden: string[] = [];
  @Trace undoId: string = '';
  private repository: XopcChatRepository = new XopcChatRepository();
  private generation: number = 0;
  private offset: number = 0;
  private searchTimer: number = -1;
  private deletes: Map<string, number> = new Map<string, number>();
  private gatewayId: string = gatewaySession.currentProfile()?.gatewayId ?? '';
  private disposed: boolean = false;

  private current(): boolean {
    return !this.disposed && !!this.gatewayId && gatewaySession.currentProfile()?.gatewayId === this.gatewayId;
  }
  dispose(): void {
    this.disposed = true; this.generation++; clearTimeout(this.searchTimer);
    this.loading = false; this.loadingMore = false;
    // Already requested deletes keep their undo deadline, but never follow a Gateway switch.
  }
  setSearch(text: string): void {
    if (this.busy) return;
    clearTimeout(this.searchTimer); this.generation++;
    this.search = text; this.selected = []; this.selecting = false;
    this.loading = true; this.loadingMore = false;
    this.searchTimer = setTimeout((): void => { this.load(); }, 250);
  }
  async load(more: boolean = false): Promise<void> {
    if (!this.current() || (more && (this.loading || this.loadingMore || !this.hasMore))) return;
    clearTimeout(this.searchTimer);
    const generation = ++this.generation;
    const offset = more ? this.offset : 0;
    this.loading = !more; this.loadingMore = more; this.error = '';
    try {
      const page = await this.repository.list(this.search.trim(), offset, 20, '');
      if (generation !== this.generation || !this.current()) return;
      const retained = more ? [] : this.selectedItems();
      const seen: Set<string> = new Set<string>();
      this.items = (more ? this.items.concat(page.items) : page.items.concat(retained)).filter((item: XopcSessionItem): boolean => {
        if (seen.has(item.key)) return false;
        seen.add(item.key); return true;
      });
      this.offset = offset + page.items.length;
      this.hasMore = page.hasMore && page.items.length > 0;
      // Selected rows outside the first page must survive a refresh after a partial batch failure.
    } catch (error) {
      if (generation === this.generation && this.current()) this.error = (error as Error).message;
    } finally {
      if (generation === this.generation) { this.loading = false; this.loadingMore = false; }
    }
  }
  select(id: string): void {
    if (!this.current() || this.busy || this.hidden.includes(id)) return;
    this.selecting = true;
    this.selected = this.selected.includes(id) ? this.selected.filter((key: string): boolean => key !== id) : this.selected.concat(id);
  }
  cancelSelection(): void { if (!this.busy) { this.selected = []; this.selecting = false; } }
  async newConversation(): Promise<string> {
    if (!this.current() || this.busy) return '';
    this.busy = true; this.actionError = '';
    try {
      const id = await this.repository.create();
      return this.current() ? id : '';
    } catch (error) { if (this.current()) this.actionError = (error as Error).message; return ''; }
    finally { this.busy = false; }
  }
  async rename(id: string, name: string): Promise<boolean> {
    if (!this.current() || this.busy || !name.trim() || !id) return false;
    this.busy = true; this.actionError = ''; this.generation++;
    try {
      await this.repository.rename(id, name.trim());
      if (!this.current()) return false;
      this.items = this.items.map((item: XopcSessionItem): XopcSessionItem => item.key === id
        ? { key: item.key, name: name.trim(), displayName: name.trim(), title: name.trim(), status: item.status,
          messageCount: item.messageCount, updatedAt: item.updatedAt, agentId: item.agentId, projectId: item.projectId } : item);
      await this.load(); this.selected = []; this.selecting = false; return true;
    } catch (error) { if (this.current()) this.actionError = (error as Error).message; return false; }
    finally { this.busy = false; }
  }
  async act(targets: XopcSessionItem[], action: string): Promise<void> {
    if (!this.current() || this.busy || !targets.length || !['pin', 'unpin', 'archive', 'delete'].includes(action)) return;
    this.busy = true; this.actionError = ''; this.generation++;
    const failed: string[] = [];
    const seen: Set<string> = new Set<string>();
    for (const item of targets) {
      if (!this.current()) break;
      if (seen.has(item.key) || this.hidden.includes(item.key)) continue;
      seen.add(item.key);
      try {
        if (action !== 'pin' || item.status !== 'pinned') {
          await this.repository.action(item.key, action === 'archive' && item.status === 'archived' ? 'unarchive' : action);
        }
        if (this.current()) {
          this.selected = this.selected.filter((id: string): boolean => id !== item.key);
          this.items = action === 'delete' ? this.items.filter((row: XopcSessionItem): boolean => row.key !== item.key)
            : this.items.map((row: XopcSessionItem): XopcSessionItem => row.key === item.key
              ? { key: row.key, name: row.name, displayName: row.displayName, title: row.title,
                status: action === 'pin' ? 'pinned' : action === 'unpin' || item.status === 'archived' ? 'active' : 'archived',
                messageCount: row.messageCount, updatedAt: row.updatedAt, agentId: row.agentId, projectId: row.projectId } : row);
        }
      } catch (error) {
        failed.push(item.key);
        if (this.current()) this.actionError = (error as Error).message;
      }
    }
    if (this.current()) {
      const failedItems = targets.filter((item: XopcSessionItem): boolean => failed.includes(item.key));
      await this.load();
      // Keep unsuccessful targets reachable even if they were on a later page.
      this.items = this.items.concat(failedItems.filter((item: XopcSessionItem): boolean =>
        !this.items.some((row: XopcSessionItem): boolean => row.key === item.key)));
      this.selected = failed; this.selecting = failed.length > 0;
    }
    this.busy = false;
  }
  selectedItems(): XopcSessionItem[] {
    return this.items.filter((item: XopcSessionItem): boolean => this.selected.includes(item.key) && !this.hidden.includes(item.key));
  }
  scheduleDelete(id: string): void {
    if (!this.current() || this.busy || this.hidden.includes(id)) return;
    this.hidden = this.hidden.concat(id); this.undoId = id; this.actionError = '';
    this.deletes.set(id, setTimeout((): void => { this.commitDelete(id); }, 5000));
  }
  undoDelete(): void {
    const id = this.undoId;
    const timer = this.deletes.get(id);
    if (timer === undefined) return;
    clearTimeout(timer); this.deletes.delete(id);
    this.hidden = this.hidden.filter((key: string): boolean => key !== id); this.undoId = '';
  }
  private async commitDelete(id: string): Promise<void> {
    this.deletes.delete(id); if (this.undoId === id) this.undoId = '';
    try {
      if (gatewaySession.currentProfile()?.gatewayId !== this.gatewayId) throw new Error('GATEWAY_CHANGED');
      await this.repository.action(id, 'delete');
      if (this.current()) await this.load();
    } catch (error) {
      this.hidden = this.hidden.filter((key: string): boolean => key !== id);
      if (this.current()) this.actionError = (error as Error).message;
    }
  }
}
