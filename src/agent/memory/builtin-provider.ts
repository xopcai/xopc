import { normalizeAgentId } from '../../routing/agent-session-key.js';
import type { MemoryProvider } from './provider.js';
import {
  appendMemorySignal,
  deleteMemoryRecord,
  getMemoryRecord,
  listMemoryRecords,
  searchMemoryRecords,
  upsertMemoryRecord,
} from '../../storage/sqlite/index.js';
import type {
  MemoryDeleteRequest,
  MemoryListRequest,
  MemoryReadRequest,
  MemoryReadResult,
  MemoryRecord,
  MemorySearchRequest,
  MemorySearchResult,
  MemoryUpdateRequest,
  MemoryWriteRequest,
  MemoryWriteResult,
  MemorySyncEvent,
} from './types.js';

/**
 * Builtin local memory provider backed exclusively by the structured SQLite store.
 */
export class BuiltinMemoryProvider implements MemoryProvider {
  readonly id = 'local';
  readonly displayName = 'Local Knowledge Store';
  readonly capabilities = {
    search: true,
    read: true,
    write: true,
    update: true,
    delete: true,
    keywordSearch: true,
    semanticSearch: false,
    hybridSearch: true,
    citations: true,
    sync: false,
    local: true,
  };

  isAvailable(): boolean {
    return true;
  }

  async initialize(): Promise<void> {}

  systemPromptBlock(): string {
    return '';
  }

  queuePrefetch(): void {}

  getToolSchemas() {
    return [];
  }

  async search(request: MemorySearchRequest): Promise<MemorySearchResult[]> {
    const options = {
        query: request.query,
        visibleToSessionKey: request.scope?.sessionKey,
        unscopedSessionOnly: request.scope?.sessionKey == null,
        visibleToProjectId: request.scope?.projectId,
        unscopedProjectOnly: request.scope?.projectId == null,
        visibleToWorkspaceId: request.scope?.workspaceId,
        unscopedWorkspaceOnly: request.scope?.workspaceId == null,
        kinds: request.kinds,
        maxResults: request.maxResults,
        minScore: request.minScore,
      };
    const [active, shadow] = [
      searchMemoryRecords(options),
      searchMemoryRecords({ ...options, statuses: ['candidate'], maxResults: Math.min(5, request.maxResults ?? 5) }),
    ];
    for (const result of shadow) {
      appendMemorySignal({
        signal: {
          source: 'search_recall',
          recordId: result.record.id,
          score: result.score,
          metadata: { query: request.query, shadow: true },
        },
        providerId: this.id,
        sourceAgentId: result.record.provenance.sourceAgentId,
        workspaceId: request.scope?.workspaceId,
        sessionKey: request.scope?.sessionKey,
      });
    }
    return active
      .filter((result) => this.canReadRecord(result.record, request.scope))
      .sort((left, right) => right.score - left.score)
      .slice(0, request.maxResults ?? 5);
  }

  async read(request: MemoryReadRequest): Promise<MemoryReadResult | null> {
    if (!request.id) return null;
    const record = getMemoryRecord(request.id);
    return record && this.canReadRecord(record, request.scope) ? { record } : null;
  }

  async get(id: string): Promise<MemoryRecord | null> {
    return getMemoryRecord(id);
  }

  async list(request: MemoryListRequest): Promise<MemoryRecord[]> {
    const records = listMemoryRecords({
      providerId: this.id,
      visibleToWorkspaceId: request.scope?.workspaceId,
      unscopedWorkspaceOnly: request.scope?.workspaceId == null,
      visibleToSessionKey: request.scope?.sessionKey,
      visibleToProjectId: request.scope?.projectId,
      kind: request.kind,
      status: request.status,
      canonicalKey: request.canonicalKey,
      limit: 200,
    });
    return records;
  }

  async write(request: MemoryWriteRequest): Promise<MemoryWriteResult> {
    const record = upsertMemoryRecord({
        providerId: this.id,
        kind: request.kind,
        sourceAgentId: normalizeAgentId(request.sourceAgentId ?? 'main'),
        workspaceId: request.scope?.workspaceId,
        sessionKey: request.scope?.sessionKey,
        projectId: request.scope?.projectId,
        content: request.content,
        source: {
          provider: this.id,
          ...(request.source ?? {}),
        },
        confidence: request.confidence,
        tags: request.tags,
        status: request.status ?? 'active',
        sensitivity: request.sensitivity,
        canonicalKey: request.canonicalKey,
        explicitness: request.explicitness,
        durability: request.durability,
        importance: request.importance,
        disclosurePolicy: request.disclosurePolicy,
        evidence: request.evidence,
        validFrom: request.validFrom,
        validTo: request.validTo,
        reviewAfter: request.reviewAfter,
        expiresAt: request.expiresAt,
        supersedesRecordId: request.supersedesRecordId,
        conflictGroupId: request.conflictGroupId,
      });
    return {
      success: true,
      message: record.status === 'candidate' ? 'Memory candidate added to inbox' : 'Memory saved',
      record,
    };
  }

  async update(request: MemoryUpdateRequest): Promise<MemoryWriteResult> {
    if (!request.id) return { success: false, error: 'Memory record id is required' };
    const existing = getMemoryRecord(request.id);
    if (!existing || !this.canReadRecord(existing, request.scope)) {
      return { success: false, error: 'Memory record not found' };
    }
    const record = upsertMemoryRecord({
        id: request.id,
        providerId: this.id,
        kind: existing.kind,
        userId: existing.scope.userId,
        sourceAgentId: existing.provenance.sourceAgentId,
        workspaceId: existing.scope.workspaceId,
        sessionKey: existing.scope.sessionKey,
        projectId: existing.scope.projectId,
        content: request.content,
        source: existing.source,
        confidence: existing.confidence,
        tags: existing.tags,
        status: existing.status,
        sensitivity: existing.sensitivity,
        canonicalKey: existing.canonicalKey,
        explicitness: existing.explicitness,
        durability: existing.durability,
        importance: existing.importance,
        disclosurePolicy: existing.disclosurePolicy,
        evidence: existing.evidence,
        validFrom: existing.validFrom,
        validTo: existing.validTo,
        reviewAfter: existing.reviewAfter,
        expiresAt: existing.expiresAt,
        supersedesRecordId: existing.supersedesRecordId,
        conflictGroupId: existing.conflictGroupId,
      });
    return { success: true, message: 'Memory updated', record };
  }

  async delete(request: MemoryDeleteRequest): Promise<MemoryWriteResult> {
    if (!request.id) return { success: false, error: 'Memory record id is required' };
    const existing = getMemoryRecord(request.id);
    if (!existing || !this.canReadRecord(existing, request.scope)) {
      return { success: false, error: 'Memory record not found' };
    }
    deleteMemoryRecord(request.id);
    return { success: true, message: 'Memory deleted' };
  }

  sync(event: MemorySyncEvent): void {
    if (event.type !== 'signal') return;
    appendMemorySignal({
      signal: event.signal,
      providerId: this.id,
      sourceAgentId: typeof event.signal.metadata?.agentId === 'string'
        ? normalizeAgentId(event.signal.metadata.agentId)
        : 'main',
      workspaceId: typeof event.signal.metadata?.workspaceId === 'string'
        ? event.signal.metadata.workspaceId
        : undefined,
      sessionKey:
        typeof event.signal.metadata?.sessionKey === 'string'
          ? event.signal.metadata.sessionKey
          : undefined,
    });
  }

  async shutdown(): Promise<void> {}

  private canReadRecord(record: MemoryRecord, scope: MemoryReadRequest['scope']): boolean {
    if (record.scope.sessionKey && record.scope.sessionKey !== scope?.sessionKey) return false;
    if (record.scope.projectId && record.scope.projectId !== scope?.projectId) return false;
    if (record.scope.workspaceId && record.scope.workspaceId !== scope?.workspaceId) return false;
    return true;
  }
}
