import type { MemoryProvider, MemoryProviderInitOptions } from '../../../src/agent/memory/provider.js';
import type {
  MemoryCapabilities,
  MemoryListRequest,
  MemoryProviderManifest,
  MemoryReadRequest,
  MemoryReadResult,
  MemoryRecord,
  MemoryScope,
  MemorySearchRequest,
  MemorySearchResult,
  MemorySyncEvent,
  MemoryWriteRequest,
  MemoryWriteResult,
} from '../../../src/agent/memory/types.js';

export const manifest: MemoryProviderManifest = {
  type: 'memory-provider',
  id: 'demo-memory',
  displayName: 'Demo Memory Provider',
  entry: './src/index.js',
  capabilities: {
    search: true,
    read: true,
    write: true,
    update: false,
    delete: false,
    keywordSearch: true,
    citations: true,
    sync: true,
  },
};

export const description = 'In-memory provider used to verify extension-backed memory providers.';

export function isAvailable(): boolean {
  return process.env.XOPC_DEMO_MEMORY_DISABLED !== '1';
}

export function createMemoryProvider(): MemoryProvider {
  return new DemoMemoryProvider();
}

class DemoMemoryProvider implements MemoryProvider {
  readonly id = manifest.id;
  readonly displayName = manifest.displayName;
  readonly manifest = manifest;
  readonly capabilities: MemoryCapabilities = {
    search: true,
    read: true,
    write: true,
    update: false,
    delete: false,
    keywordSearch: true,
    semanticSearch: false,
    hybridSearch: false,
    citations: true,
    sync: true,
  };

  private records = new Map<string, MemoryRecord>();
  private sequence = 0;
  private scope: MemoryScope = { agentId: 'main' };

  isAvailable(): boolean {
    return isAvailable();
  }

  initialize(_sessionId: string, options?: MemoryProviderInitOptions): void {
    const agentId = typeof options?.config?.agentId === 'string' ? options.config.agentId : 'main';
    const workspaceId = typeof options?.workspace === 'string' ? options.workspace : undefined;
    this.scope = workspaceId ? { agentId, workspaceId } : { agentId };
  }

  async write(request: MemoryWriteRequest): Promise<MemoryWriteResult> {
    const record = this.createRecord(request);
    return { success: true, record, message: `Demo memory stored ${record.id}` };
  }

  async search(request: MemorySearchRequest): Promise<MemorySearchResult[]> {
    const query = request.query.trim().toLocaleLowerCase();
    const kinds = request.kinds ? new Set(request.kinds) : null;
    const maxResults = request.maxResults ?? 5;
    return [...this.records.values()]
      .filter((record) => !kinds || kinds.has(record.kind))
      .filter((record) => !query || record.content.toLocaleLowerCase().includes(query))
      .map((record) => ({
        record,
        score: scoreRecord(record, query),
        snippet: record.content,
        citation: {
          providerId: this.id,
          recordId: record.id,
          title: this.displayName,
          createdAt: record.createdAt,
        },
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);
  }

  async read(request: MemoryReadRequest): Promise<MemoryReadResult | null> {
    if (!request.id) return null;
    const record = this.records.get(request.id);
    return record ? { record } : null;
  }

  async get(id: string): Promise<MemoryRecord | null> {
    return this.records.get(id) ?? null;
  }

  async list(request: MemoryListRequest): Promise<MemoryRecord[]> {
    return [...this.records.values()].filter((record) => !request.kind || record.kind === request.kind);
  }

  sync(event: MemorySyncEvent): void {
    if (event.type !== 'signal' || !event.signal.content) return;
    this.createRecord({
      kind: 'derived_insight',
      content: event.signal.content,
      source: { provider: event.signal.source },
      tags: ['signal', event.signal.source],
    });
  }

  shutdown(): void {
    this.records.clear();
  }

  private createRecord(request: MemoryWriteRequest): MemoryRecord {
    const now = new Date().toISOString();
    const id = `demo-memory-${++this.sequence}`;
    const record: MemoryRecord = {
      id,
      kind: request.kind,
      scope: { ...this.scope, ...request.scope },
      content: request.content,
      source: request.source ?? { provider: this.id },
      explicitness: request.explicitness ?? 'inferred',
      durability: request.durability ?? 'durable',
      importance: request.importance ?? 0.5,
      disclosurePolicy: request.disclosurePolicy ?? 'referenceable',
      createdAt: now,
      updatedAt: now,
      ...(request.tags ? { tags: request.tags } : {}),
    };
    this.records.set(id, record);
    return record;
  }
}

function scoreRecord(record: MemoryRecord, query: string): number {
  if (!query) return 0.5;
  const text = record.content.toLocaleLowerCase();
  if (text === query) return 1;
  if (text.includes(query)) return 0.8;
  return 0.1;
}
