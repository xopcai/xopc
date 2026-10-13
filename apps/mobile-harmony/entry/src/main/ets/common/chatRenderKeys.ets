import { XopcChatRow, XopcChatBlock } from '../model/chat';

/** Keep a response's local UI identity when its durable history row arrives. */
export class XopcChatRenderKeys {
  private scope: string = '';
  private keys: Map<string, string> = new Map<string, string>();
  private history?: XopcChatRow[];
  private liveSegment: string = '';

  update(scope: string, history: XopcChatRow[], live?: XopcChatRow): void {
    if (scope !== this.scope) { this.scope = scope; this.keys.clear(); this.history = undefined; this.liveSegment = ''; }
    if (live) {
      const segments = (live.blocks || []).map((block: XopcChatBlock): string => block.segmentId || '').filter((id: string): boolean => !!id);
      const existing = segments.find((id: string): boolean => this.keys.has(id));
      const first = segments[0] || '';
      const key = (existing ? this.keys.get(existing) : '')
        || (first === this.liveSegment ? this.keys.get(live.id) : '') || live.id + (first ? ':' + first : '');
      this.liveSegment = first;
      this.keys.set(live.id, key);
      segments.forEach((id: string): void => { this.keys.set(id, key); });
    }
    if (history === this.history) return;
    this.history = history;
    const used = new Set<string>();
    history.forEach((row: XopcChatRow): void => {
      const matched = (row.sourceIds || [row.id]).find((id: string): boolean => this.keys.has(id));
      const candidate = this.keys.get(row.id) || (matched ? this.keys.get(matched) : '') || row.id;
      const key = used.has(candidate) ? row.id : candidate;
      used.add(key);
      this.keys.set(row.id, key);
      (row.sourceIds || [row.id]).forEach((id: string): void => { this.keys.set(id, key); });
    });
  }

  key(row: XopcChatRow): string { return this.scope + ':' + (this.keys.get(row.id) || row.id); }
}
