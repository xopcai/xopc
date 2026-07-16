import type { MemoryProvider, MemoryProviderInitOptions } from './provider.js';

/**
 * Placeholder external provider — enables wiring tests without cloud deps.
 */
export class StubMemoryProvider implements MemoryProvider {
  readonly id = 'stub';
  readonly displayName = 'Stub Memory Provider';
  readonly capabilities = {
    search: true,
    read: false,
    write: false,
    update: false,
    delete: false,
    keywordSearch: false,
    semanticSearch: false,
    hybridSearch: false,
    citations: false,
    sync: true,
    local: false,
  };

  isAvailable(): boolean {
    return true;
  }

  async initialize(_sessionId: string, _options?: MemoryProviderInitOptions): Promise<void> {}

  systemPromptBlock(): string {
    return 'External memory provider: stub (wiring only; no cloud backend).';
  }

  queuePrefetch(): void {}

  sync(): void {}

  getToolSchemas() {
    return [];
  }

  async handleToolCall(toolName: string): Promise<string> {
    return JSON.stringify({ error: `stub provider has no tools (${toolName})` });
  }

  async search(): Promise<[]> {
    return [];
  }

  async shutdown(): Promise<void> {}
}
