import { XopcSessionItem, XopcSessionGroup } from '../model/chat';
import { XopcChatRepository } from '../repository/chatRepository';
import { groupChatSessions } from '../common/sessionGroups';

@ObservedV2
export class XopcChatDrawerViewModel {
  @Trace items: XopcSessionItem[] = [];
  @Trace groups: XopcSessionGroup[] = [];
  @Trace total: number = 0;
  @Trace hasMore: boolean = false;
  @Trace loading: boolean = false;
  @Trace error: string = '';
  @Trace actionError: string = '';
  @Trace busy: boolean = false;
  private repository: XopcChatRepository = new XopcChatRepository();
  private generation: number = 0;
  private offset: number = 0;
  private search: string = '';
  dispose(): void { this.generation++; this.loading = false; this.busy = false; }
  async open(): Promise<void> { await this.load('', false); }
  async load(search: string = this.search, more: boolean = false): Promise<void> {
    if (more && (this.loading || !this.hasMore)) return;
    const generation = ++this.generation;
    this.loading = true; this.error = ''; this.search = search;
    if (!more) this.offset = 0;
    try {
      const page = await this.repository.list(search, this.offset, 20);
      if (generation !== this.generation) return;
      const combined = more ? this.items.concat(page.items) : page.items;
      const seen: Set<string> = new Set<string>();
      this.items = combined.filter((item: XopcSessionItem): boolean => {
        if (seen.has(item.key)) return false; seen.add(item.key); return true;
      });
      this.offset += page.items.length;
      this.groups = groupChatSessions(this.items); this.total = page.total;
      this.hasMore = page.hasMore && page.items.length > 0;
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    finally { if (generation === this.generation) this.loading = false; }
  }
  async action(item: XopcSessionItem, action: string): Promise<boolean> {
    if (this.busy || !['pin', 'unpin', 'archive', 'unarchive', 'delete'].includes(action)) return false;
    const generation = ++this.generation;
    this.busy = true; this.actionError = '';
    try {
      await this.repository.action(item.key, action);
      if (generation !== this.generation) return false;
      if (action === 'delete') {
        this.items = this.items.filter((row: XopcSessionItem): boolean => row.key !== item.key);
        this.total = Math.max(0, this.total - 1);
      } else {
        const status = action === 'pin' ? 'pinned' : action === 'archive' ? 'archived' : 'active';
        this.items = this.items.map((row: XopcSessionItem): XopcSessionItem => row.key === item.key
          ? { key: row.key, name: row.name, displayName: row.displayName, title: row.title, status,
            messageCount: row.messageCount, updatedAt: row.updatedAt, agentId: row.agentId, projectId: row.projectId }
          : row);
      }
      this.groups = groupChatSessions(this.items);
      return true;
    } catch (error) {
      if (generation === this.generation) this.actionError = (error as Error).message;
      return false;
    } finally {
      if (generation === this.generation) this.busy = false;
    }
  }
}
