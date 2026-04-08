import type { BuiltinMemoryStore } from './builtin-memory-store.js';
import type { MemoryProvider, MemoryProviderInitOptions } from './provider.js';

/**
 * Builtin curated store: snapshot is injected via {@link MemorySnapshot} in the system prompt builder.
 * This provider participates in prefetch/sync orchestration only as a no-op.
 */
export class BuiltinMemoryProvider implements MemoryProvider {
  readonly name = 'builtin';

  constructor(private readonly _store: BuiltinMemoryStore) {}

  isAvailable(): boolean {
    return true;
  }

  async initialize(_sessionId: string, _options?: MemoryProviderInitOptions): Promise<void> {
    void this._store;
  }

  /** Curated blocks are injected separately as frozen snapshot; avoid duplicating in provider merge. */
  systemPromptBlock(): string {
    return '';
  }

  async prefetch(): Promise<string> {
    return '';
  }

  queuePrefetch(): void {}

  syncTurn(): void {}

  getToolSchemas() {
    return [];
  }

  async handleToolCall(): Promise<string> {
    return JSON.stringify({ error: 'Built-in memory uses curated_memory tool' });
  }

  async shutdown(): Promise<void> {}
}
