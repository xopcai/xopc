import type { MemoryProvider, MemoryProviderInitOptions } from './provider.js';

/**
 * Phase 2 placeholder external provider — enables wiring tests without cloud deps.
 */
export class StubMemoryProvider implements MemoryProvider {
  readonly name = 'stub';

  isAvailable(): boolean {
    return true;
  }

  async initialize(_sessionId: string, _options?: MemoryProviderInitOptions): Promise<void> {}

  systemPromptBlock(): string {
    return 'External memory provider: stub (Phase 2 wiring only; no cloud backend). Set `agents.defaults.memory.provider` to `none` to hide.';
  }

  async prefetch(query: string): Promise<string> {
    const q = query.trim();
    if (!q) {
      return '';
    }
    return `[stub prefetch] query length=${q.length}`;
  }

  queuePrefetch(): void {}

  syncTurn(_user: string, _assistant: string): void {}

  getToolSchemas() {
    return [];
  }

  async handleToolCall(toolName: string): Promise<string> {
    return JSON.stringify({ error: `stub provider has no tools (${toolName})` });
  }

  async shutdown(): Promise<void> {}
}
