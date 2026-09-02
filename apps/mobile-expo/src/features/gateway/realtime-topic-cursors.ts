/**
 * Cursors that survive a WebSocket instance replacement within one gateway.
 * A LAN/tunnel route change creates a new RealtimeClient, but it must continue
 * from the sequence already applied by the old client.
 */
export class RealtimeTopicCursorStore {
  private scopeKey = '';
  private readonly cursors = new Map<string, number>();

  activateScope(scopeKey: string): void {
    if (scopeKey === this.scopeKey) return;
    this.scopeKey = scopeKey;
    this.cursors.clear();
  }

  isActiveScope(scopeKey: string): boolean {
    return scopeKey === this.scopeKey;
  }

  read(topic: string): number | undefined {
    return this.cursors.get(topic);
  }

  set(topic: string, cursor: number | undefined): void {
    if (cursor === undefined) this.cursors.delete(topic);
    else this.cursors.set(topic, cursor);
  }

  advance(topic: string, seq: number): void {
    const current = this.cursors.get(topic);
    if (current === undefined || seq > current) this.cursors.set(topic, seq);
  }

  resetForGap(topic: string, earliestSeq: number): void {
    this.cursors.set(topic, Math.max(0, earliestSeq - 1));
  }

  delete(topic: string): void {
    this.cursors.delete(topic);
  }
}
