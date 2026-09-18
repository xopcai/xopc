@ObservedV2
export class XopcChatDisclosure {
  @Trace values: Map<string, boolean> = new Map<string, boolean>();
  get(key: string): boolean | undefined { return this.values.get(key); }
  set(key: string, expanded: boolean): void {
    this.values.set(key, expanded);
    if (this.values.size > 1000) { const first = Array.from(this.values.keys())[0]; if (first) this.values.delete(first); }
  }
  clear(): void { this.values.clear(); }
}
