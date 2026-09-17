import { XopcHomeAction, XopcHomeItem } from '../model/home';
import { homeCommand } from '../common/homeProtocol';
import { gatewaySession } from '../service/gatewaySession';
import { XopcSecureStore } from '../service/secureStore';

export interface XopcAttentionStamp { id: string; revision: string; }
export function attentionRevision(item: XopcHomeItem): string {
  return typeof item.updatedAt === 'number' && Number.isFinite(item.updatedAt) ? String(item.updatedAt) : JSON.stringify(item);
}
export function unseenAttention(items: XopcHomeItem[], seen: XopcAttentionStamp[]): XopcHomeItem[] {
  return items.filter((item: XopcHomeItem): boolean => !seen.some((stamp: XopcAttentionStamp): boolean => stamp.id === item.id && stamp.revision === attentionRevision(item)));
}

@ObservedV2
export class XopcChatAttentionViewModel {
  @Trace seen: XopcAttentionStamp[] = [];
  @Trace ready: boolean = false;
  @Trace pending: boolean = false;
  @Trace error: string = '';
  @Trace completed: string = '';
  private generation: number = 0;
  private scope: string = '';
  private store: XopcSecureStore = new XopcSecureStore();

  dispose(): void { this.generation++; this.ready = false; }
  async activate(): Promise<void> {
    const generation = ++this.generation;
    this.scope = gatewaySession.currentProfile()?.gatewayId || '';
    this.ready = false; this.seen = []; this.error = ''; this.completed = '';
    if (!this.scope) return;
    try {
      const raw = await this.store.read('chat-attention:' + this.scope);
      if (generation !== this.generation) return;
      if (raw) {
        const parsed = JSON.parse(raw) as XopcAttentionStamp[];
        if (Array.isArray(parsed)) this.seen = parsed.filter((stamp: XopcAttentionStamp): boolean => !!stamp && typeof stamp.id === 'string' && typeof stamp.revision === 'string').slice(0, 100);
      }
    } catch (_) { /* Corrupt local seen state must not hide actionable items. */ }
    if (generation === this.generation) this.ready = true;
  }
  unseen(items: XopcHomeItem[]): XopcHomeItem[] { return this.ready ? unseenAttention(items, this.seen) : []; }
  ordered(items: XopcHomeItem[]): XopcHomeItem[] {
    const unseen = this.unseen(items);
    return unseen.concat(items.filter((item: XopcHomeItem): boolean => !unseen.some((entry: XopcHomeItem): boolean => entry.id === item.id)));
  }
  async dismiss(items: XopcHomeItem[]): Promise<void> {
    if (!this.scope || !this.ready) return;
    const generation = this.generation;
    const next = items.slice(0, 100).map((item: XopcHomeItem): XopcAttentionStamp => ({ id: item.id, revision: attentionRevision(item) }));
    try {
      await this.store.write('chat-attention:' + this.scope, JSON.stringify(next));
      if (generation === this.generation) this.seen = next;
    } catch (_) { if (generation === this.generation) this.error = 'ATTENTION_DISMISS_FAILED'; }
  }
  async act(action: XopcHomeAction): Promise<boolean> {
    if (this.pending || !this.ready || this.scope !== gatewaySession.currentProfile()?.gatewayId) return false;
    const generation = this.generation;
    this.pending = true; this.error = ''; this.completed = '';
    try {
      const body = homeCommand(action);
      const path = action.type === 'connector_decision' ? '/api/home/decisions/respond'
        : action.type === 'retry_run' ? '/api/home/attention/retry' : '/api/home/attention/acknowledge';
      await gatewaySession.request(path, 'POST', JSON.stringify(body));
      if (generation !== this.generation) return false;
      this.completed = action.type; return true;
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; return false; }
    finally { this.pending = false; }
  }
}
