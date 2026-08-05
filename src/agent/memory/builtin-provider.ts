import type { BuiltinMemoryStore } from './builtin-memory-store.js';
import { normalizeAgentId } from '../../routing/agent-session-key.js';
import type { MemoryProvider, MemoryProviderInitOptions } from './provider.js';
import { memoryGet, memorySearch } from '../prompt/memory/index.js';
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
 * Builtin local memory provider backed by profile memory, agent-home curated files,
 * and the local SQLite FTS index.
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
    hybridSearch: false,
    citations: true,
    sync: false,
    local: true,
  };

  private workspaceDir = '';
  private agentId = 'main';

  constructor(private readonly store: BuiltinMemoryStore) {}

  isAvailable(): boolean {
    return true;
  }

  async initialize(_sessionId: string, options?: MemoryProviderInitOptions): Promise<void> {
    this.workspaceDir = options?.workspace ?? options?.agentWorkspace ?? this.store.workspaceDir;
    this.agentId = normalizeAgentId(String(options?.agentId ?? this.agentId));
  }

  systemPromptBlock(): string {
    return '';
  }

  queuePrefetch(): void {}

  getToolSchemas() {
    return [];
  }

  async search(request: MemorySearchRequest): Promise<MemorySearchResult[]> {
    const workspaceId = request.scope?.workspaceId ?? this.workspaceDir;
    const recordHits = searchMemoryRecords({
        query: request.query,
        visibleToSessionKey: request.scope?.sessionKey,
        unscopedSessionOnly: request.scope?.sessionKey == null,
        visibleToProjectId: request.scope?.projectId,
        unscopedProjectOnly: request.scope?.projectId == null,
        providerId: this.id,
        kinds: request.kinds,
        maxResults: request.maxResults,
        minScore: request.minScore,
      })
      .filter((result) => this.canReadRecord(result.record, request.scope))
      .sort((left, right) => right.score - left.score)
      .slice(0, request.maxResults ?? 5);
    if (recordHits.length > 0) {
      return recordHits;
    }

    const results = await memorySearch(this.workspaceDir, request.query, {
      maxResults: request.maxResults,
      minScore: request.minScore,
      memoriesDir: this.store.memoriesDir,
      userMemoryPath: this.store.userMemoryPath,
    });
    return results.map((entry) => {
      const start = entry.lineNumbers[0] ?? 1;
      const end = entry.lineNumbers[entry.lineNumbers.length - 1] ?? start;
      const id = `${entry.file}#L${start}-L${end}`;
      const kind = inferKindFromPath(entry.file);
      const record = upsertMemoryRecord({
        id,
        providerId: this.id,
        kind,
        sourceAgentId: this.agentId,
        workspaceId,
        content: entry.lines,
        source: {
          provider: this.id,
          path: entry.file,
          lineStart: start,
          lineEnd: end,
        },
        confidence: entry.score,
      });
      return {
        record,
        score: entry.score,
        snippet: entry.lines,
        citation: {
          providerId: this.id,
          recordId: id,
          path: entry.file,
          lineStart: start,
          lineEnd: end,
        },
      };
    });
  }

  async read(request: MemoryReadRequest): Promise<MemoryReadResult | null> {
    if (request.id && !request.path) {
      const existing = getMemoryRecord(request.id);
      if (existing && this.canReadRecord(existing, request.scope)) {
        return { record: existing };
      }
      if (existing) return null;
    }
    const result = memoryGet(
      this.workspaceDir,
      request.path ?? request.id ?? '',
      request.from,
      request.lines,
      this.store.memoriesDir,
      this.store.userMemoryPath,
    );
    if (!result) return null;
    const path = request.path ?? request.id ?? '';
    const record = upsertMemoryRecord({
      id: `${path}#L${result.lineNumbers.start}-L${result.lineNumbers.end}`,
      providerId: this.id,
      kind: inferKindFromPath(path),
      sourceAgentId: this.agentId,
      workspaceId: request.scope?.workspaceId ?? this.workspaceDir,
      content: result.content,
      source: {
        provider: this.id,
        path,
        lineStart: result.lineNumbers.start,
        lineEnd: result.lineNumbers.end,
      },
    });
    return {
      record,
      lineNumbers: result.lineNumbers,
    };
  }

  async get(id: string): Promise<MemoryRecord | null> {
    const parsed = parseLineAddress(id);
    const result = await this.read({
      path: parsed.path,
      from: parsed.lineStart,
      lines: parsed.lineEnd != null ? parsed.lineEnd - parsed.lineStart + 1 : undefined,
    });
    return result?.record ?? null;
  }

  async list(request: MemoryListRequest): Promise<MemoryRecord[]> {
    const records = listMemoryRecords({
      providerId: this.id,
      workspaceId: request.scope?.workspaceId ?? this.workspaceDir,
      visibleToSessionKey: request.scope?.sessionKey,
      visibleToProjectId: request.scope?.projectId,
      kind: request.kind,
      status: request.status,
      canonicalKey: request.canonicalKey,
      limit: 200,
    });
    if (records.length > 0 || request.kind || request.status || request.canonicalKey) {
      return request.target
        ? records.filter((record) => targetForKind(record.kind) === request.target)
        : records;
    }

    const target = request.target ?? (request.kind === 'user_profile' ? 'user' : 'memory');
    return this.store.getLiveEntries(target).map((content, index) =>
      upsertMemoryRecord({
        id: `curated:${target}:${index + 1}`,
        providerId: this.id,
        kind: target === 'user' ? 'user_profile' : 'curated_note',
        sourceAgentId: this.agentId,
        workspaceId: request.scope?.workspaceId ?? this.workspaceDir,
        content,
        source: {
          provider: this.id,
          path: sourcePathForTarget(target),
        },
      }),
    );
  }

  async write(request: MemoryWriteRequest): Promise<MemoryWriteResult> {
    const target = request.target ?? (request.kind === 'user_profile' ? 'user' : 'memory');
    if (request.status === 'candidate') {
      const record = upsertMemoryRecord({
        providerId: this.id,
        kind: request.kind,
        sourceAgentId: this.agentId,
        workspaceId: request.scope?.workspaceId ?? this.workspaceDir,
        sessionKey: request.scope?.sessionKey,
        projectId: request.scope?.projectId,
        content: request.content,
        source: {
          provider: this.id,
          ...(request.source ?? {}),
        },
        confidence: request.confidence,
        tags: request.tags,
        status: 'candidate',
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
        message: 'Memory candidate added to inbox',
        record,
      };
    }
    const result = await this.store.add(target, request.content);
    if (!result.success) return { success: false, error: result.error };
    return {
      success: true,
      message: result.message,
      record: upsertMemoryRecord({
        id: `curated:${target}:${Date.now()}`,
        providerId: this.id,
        kind: request.kind,
        sourceAgentId: this.agentId,
        workspaceId: request.scope?.workspaceId ?? this.workspaceDir,
        sessionKey: request.scope?.sessionKey,
        content: request.content,
        source: {
          provider: this.id,
          path: sourcePathForTarget(target),
          ...(request.source ?? {}),
        },
        tags: request.tags,
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
      }),
    };
  }

  async update(request: MemoryUpdateRequest): Promise<MemoryWriteResult> {
    const target = request.target ?? 'memory';
    const result = await this.store.replace(target, request.matchText ?? request.id ?? '', request.content);
    if (!result.success) return { success: false, error: result.error };
    if (request.id) {
      const existing = getMemoryRecord(request.id);
      upsertMemoryRecord({
        id: request.id,
        providerId: this.id,
        kind: existing?.kind ?? (target === 'user' ? 'user_profile' : 'curated_note'),
        sourceAgentId: existing?.provenance.sourceAgentId ?? this.agentId,
        workspaceId: existing?.scope.workspaceId ?? request.scope?.workspaceId ?? this.workspaceDir,
        sessionKey: existing?.scope.sessionKey ?? request.scope?.sessionKey,
        content: request.content,
        source: existing?.source ?? { provider: this.id, path: sourcePathForTarget(target) },
        tags: existing?.tags,
      });
    } else if (request.matchText) {
      for (const existing of listMemoryRecords({
        providerId: this.id,
        workspaceId: request.scope?.workspaceId ?? this.workspaceDir,
        kind: target === 'user' ? 'user_profile' : 'curated_note',
        limit: 200,
      })) {
        if (!existing.content.includes(request.matchText)) continue;
        upsertMemoryRecord({
          id: existing.id,
          providerId: this.id,
          kind: existing.kind,
          sourceAgentId: existing.provenance.sourceAgentId,
          workspaceId: existing.scope.workspaceId,
          sessionKey: existing.scope.sessionKey,
          content: request.content,
          source: existing.source,
          tags: existing.tags,
        });
      }
    }
    return { success: true, message: result.message };
  }

  async delete(request: MemoryDeleteRequest): Promise<MemoryWriteResult> {
    const target = request.target ?? 'memory';
    const result = await this.store.remove(target, request.matchText ?? request.id ?? '');
    if (!result.success) return { success: false, error: result.error };
    if (request.id) {
      deleteMemoryRecord(request.id);
    } else if (request.matchText) {
      for (const existing of listMemoryRecords({
        providerId: this.id,
        workspaceId: request.scope?.workspaceId ?? this.workspaceDir,
        kind: target === 'user' ? 'user_profile' : 'curated_note',
        limit: 200,
      })) {
        if (existing.content.includes(request.matchText)) {
          deleteMemoryRecord(existing.id);
        }
      }
    }
    return { success: true, message: result.message };
  }

  sync(event: MemorySyncEvent): void {
    if (event.type !== 'signal') return;
    appendMemorySignal({
      signal: event.signal,
      providerId: this.id,
      sourceAgentId: this.agentId,
      workspaceId: this.workspaceDir,
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
    return true;
  }
}

function inferKindFromPath(path: string): MemoryRecord['kind'] {
  const normalized = path.replace(/\\/g, '/');
  if (normalized === 'user/MEMORY.md' || normalized.endsWith('/user/MEMORY.md')) return 'user_profile';
  if (/^memory\/\d{4}-\d{2}-\d{2}\.md$/.test(normalized)) return 'daily_note';
  if (normalized.endsWith('MEMORY.md')) return 'curated_note';
  return 'workspace_fact';
}

function targetForKind(kind: MemoryRecord['kind']): 'memory' | 'user' {
  return kind === 'user_profile' || kind === 'preference' || kind === 'relationship' ||
    kind === 'routine' || kind === 'personal_logistics'
    ? 'user'
    : 'memory';
}

function sourcePathForTarget(target: 'memory' | 'user'): string {
  return target === 'user' ? 'user/MEMORY.md' : 'MEMORY.md';
}

function parseLineAddress(id: string): { path: string; lineStart?: number; lineEnd?: number } {
  const match = /^(.*)#L(\d+)(?:-L(\d+))?$/.exec(id);
  if (!match) return { path: id };
  const lineStart = Number.parseInt(match[2] ?? '1', 10);
  const lineEnd = Number.parseInt(match[3] ?? match[2] ?? '1', 10);
  return {
    path: match[1] ?? id,
    lineStart: Number.isFinite(lineStart) ? lineStart : undefined,
    lineEnd: Number.isFinite(lineEnd) ? lineEnd : undefined,
  };
}
