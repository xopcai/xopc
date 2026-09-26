/** Small immutable registry used by scene capabilities at the composition root. */
export class SceneCapabilityRegistry<T extends { id: string }> {
  private readonly items = new Map<string, T>();

  constructor(items: readonly T[]) {
    for (const item of items) {
      if (!item.id.trim()) throw new Error('Scene capability id is required');
      if (this.items.has(item.id)) throw new Error(`Duplicate scene capability: ${item.id}`);
      this.items.set(item.id, item);
    }
  }

  ids(): string[] { return [...this.items.keys()]; }
  list(): T[] { return [...this.items.values()]; }
  has(id: string): boolean { return this.items.has(id); }

  get(id: string): T {
    const item = this.items.get(id);
    if (!item) throw new Error(`Scene capability unavailable: ${id}`);
    return item;
  }
}
