/** Cache generated, sanitized markup only; never retain callbacks or React trees. */
export class RenderCache {
  private entries = new Map<string, { value: string; bytes: number }>();
  private bytes = 0;

  constructor(private readonly maxBytes = 8 * 1024 * 1024, private readonly maxEntries = 256) {}

  get(key: string): string | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: string): void {
    const old = this.entries.get(key);
    if (old) this.bytes -= old.bytes;
    this.entries.delete(key);
    const bytes = (key.length + value.length) * 2;
    if (bytes > this.maxBytes) return;
    this.entries.set(key, { value, bytes });
    this.bytes += bytes;
    while (this.bytes > this.maxBytes || this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.bytes -= this.entries.get(oldest)!.bytes;
      this.entries.delete(oldest);
    }
  }

  get sizeBytes(): number { return this.bytes; }
}

export const richMarkupCache = new RenderCache();
