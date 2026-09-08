export type AssistantAudioAutoplayItem = {
  key: string;
  uri: string;
  mimeType?: string;
  sessionKey: string;
};

export type AssistantAudioAutoplayResult = 'completed' | 'interrupted';

/** Serializes live assistant audio without replaying history or duplicate events. */
export class AssistantAudioAutoplayQueue {
  private readonly pending: AssistantAudioAutoplayItem[] = [];
  private readonly seen = new Set<string>();
  private active = false;

  constructor(
    private readonly play: (item: AssistantAudioAutoplayItem) => Promise<AssistantAudioAutoplayResult>,
    private readonly maxPending = 8,
  ) {}

  enqueue(item: AssistantAudioAutoplayItem): void {
    if (this.seen.has(item.key)) return;
    this.seen.add(item.key);
    if (this.seen.size > 128) this.seen.delete(this.seen.values().next().value!);
    if (this.pending.length >= this.maxPending) this.pending.shift();
    this.pending.push(item);
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.active) return;
    const item = this.pending.shift();
    if (!item) return;
    this.active = true;
    try {
      if (await this.play(item) === 'interrupted') this.pending.splice(0);
    } catch {
      // A failed track must not poison playback for later assistant replies.
    } finally {
      this.active = false;
      void this.pump();
    }
  }
}
