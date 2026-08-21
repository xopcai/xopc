import type { AgentTool } from '@earendil-works/pi-agent-core';

import { appendMemoryTraceEvent, attachMemoryEvidence, setKnowledgeSourceItemSynthesisStatus } from '../../storage/sqlite/index.js';
import { createLogger } from '../../utils/logger.js';
import type { MemoryRuntime, MemorySource } from '../../agent-runtime/memory-runtime.js';
import type { MemoryProvider, MemoryProviderInitOptions } from './provider.js';
import { UserUnderstandingService } from './understanding/service.js';
import type { UnderstandingCandidate } from './understanding/types.js';
import type {
  MemoryDeleteRequest,
  MemoryListRequest,
  MemoryReadRequest,
  MemoryReadResult,
  MemorySearchRequest,
  MemorySearchResult,
  MemorySyncEvent,
  MemoryUpdateRequest,
  MemoryWriteRequest,
  MemoryWriteResult,
  MemoryRecord,
  MemorySignal,
  MemoryKind,
} from './types.js';

const log = createLogger('MemoryManager');

export type MemorySearchStrategy = 'local-first' | 'external-first' | 'fanout' | 'local-only' | 'external-only';
export type MemoryWriteStrategy = 'local-first' | 'external-first' | 'write-through' | 'local-only' | 'external-only';

export interface MemoryRoutingOptions {
  searchStrategy?: MemorySearchStrategy;
  writeStrategy?: MemoryWriteStrategy;
  replicateTo?: string[];
}

export interface MemoryManagerOptions extends MemoryRoutingOptions {
  loadProviders?: () => Promise<MemoryProvider[]>;
  writePolicy?: MemoryWritePolicy;
  memoryRuntime?: MemoryRuntime;
}

export interface MemoryWritePolicy {
  allowExternalWrites?: boolean;
  allowedProviderIds?: string[];
  autoWriteKinds?: MemoryKind[];
}

export class MemoryManager {
  private providers: MemoryProvider[] = [];
  private toolToProvider = new Map<string, MemoryProvider>();
  private readonly routing: Required<MemoryRoutingOptions>;
  private readonly loadProviders?: () => Promise<MemoryProvider[]>;
  private readonly writePolicy: Required<Pick<MemoryWritePolicy, 'allowExternalWrites'>> &
    Omit<MemoryWritePolicy, 'allowExternalWrites'>;
  private pluginProvidersLoaded = false;
  private readonly understanding: UserUnderstandingService;
  private readonly memoryRuntime?: MemoryRuntime;
  private readonly lastTurnSourceItem = new Map<string, string>();
  private readonly sessionContexts = new Map<string, MemoryProviderInitOptions>();

  constructor(options: MemoryManagerOptions = {}) {
    this.routing = {
      searchStrategy: options.searchStrategy ?? 'fanout',
      writeStrategy: options.writeStrategy ?? 'local-first',
      replicateTo: options.replicateTo ?? [],
    };
    this.loadProviders = options.loadProviders;
    this.memoryRuntime = options.memoryRuntime;
    this.writePolicy = {
      allowExternalWrites: options.writePolicy?.allowExternalWrites ?? false,
      allowedProviderIds: options.writePolicy?.allowedProviderIds,
      autoWriteKinds: options.writePolicy?.autoWriteKinds,
    };
    this.understanding = new UserUnderstandingService({
      write: (request) => this.write(request),
      list: (canonicalKey, scope) => this.list({ canonicalKey, scope }),
      attachEvidence: (recordId, evidence) => {
        attachMemoryEvidence({
          recordId,
          sourceItemId: evidence.sourceItemId,
          relation: evidence.relation,
          sessionKey: evidence.sessionKey,
          turnId: evidence.turnId,
          toolCallId: evidence.toolCallId,
          excerpt: evidence.sourceText,
          confidence: evidence.confidence,
          observedAt: evidence.observedAt,
        });
      },
    });
  }

  addProvider(provider: MemoryProvider): void {
    this.providers.push(provider);

    for (const schema of provider.getToolSchemas?.() ?? []) {
      const toolName = schema.name;
      if (!toolName) {
        continue;
      }
      if (!this.toolToProvider.has(toolName)) {
        this.toolToProvider.set(toolName, provider);
      } else {
        log.warn(
          { toolName, existing: this.toolToProvider.get(toolName)?.id, ignored: provider.id },
          'Memory tool name conflict',
        );
      }
    }

    log.info(
      { id: provider.id, toolCount: provider.getToolSchemas?.().length ?? 0, capabilities: provider.capabilities },
      'Memory provider registered',
    );
  }

  get providersList(): MemoryProvider[] {
    return [...this.providers];
  }

  /** Static instructions contributed by external memory providers. */
  buildExternalSystemPrompt(): string {
    const blocks: string[] = [];
    for (const p of this.providers) {
      if (p.capabilities.local) {
        continue;
      }
      try {
        const block = p.systemPromptBlock?.();
        if (block?.trim()) {
          blocks.push(block.trim());
        }
      } catch (err) {
        log.warn({ err, id: p.id }, 'systemPromptBlock failed');
      }
    }
    return blocks.join('\n\n');
  }

  queuePrefetchAll(query: string, options?: { sessionId?: string }): void {
    for (const p of this.providers) {
      try {
        p.queuePrefetch?.(query, options);
      } catch (err) {
        log.debug({ err, id: p.id }, 'queuePrefetch failed (non-fatal)');
      }
    }
  }

  async syncAll(userContent: string, assistantContent: string, options?: { sessionId?: string }): Promise<void> {
    await this.captureTurnUnderstanding(userContent, assistantContent, options);
    await this.syncProvidersForTurn(userContent, assistantContent, options);
  }

  async captureTurnUnderstanding(
    userContent: string,
    assistantContent: string,
    options?: { agentId?: string; sessionId?: string; workspaceId?: string; projectId?: string; correctionTargetRecordIds?: string[] },
  ): Promise<import('./understanding/types.js').UnderstandingReviewResult> {
    const sessionContext = options?.sessionId ? this.sessionContexts.get(options.sessionId) : undefined;
    const review = await this.understanding.reviewTurn({
      agentId: options?.agentId ?? sessionContext?.agentId,
      userContent,
      assistantContent,
      sessionKey: options?.sessionId,
      workspaceId: options?.workspaceId ?? sessionContext?.workspace ?? sessionContext?.agentWorkspace,
      projectId: options?.projectId,
      correctionTargetRecordIds: options?.correctionTargetRecordIds,
    });
    if (options?.sessionId && review.sourceItemId) {
      this.lastTurnSourceItem.set(options.sessionId, review.sourceItemId);
    }
    return review;
  }

  async syncProvidersForTurn(
    userContent: string,
    assistantContent: string,
    options?: { sessionId?: string },
  ): Promise<void> {
    const event: MemorySyncEvent = {
      type: 'turn',
      userContent,
      assistantContent,
      sessionId: options?.sessionId,
    };
    for (const p of this.providers) {
      const started = Date.now();
      try {
        await p.sync?.(event);
        this.trace('sync', p.id, event, {
          resultCount: 1,
          durationMs: Date.now() - started,
          sessionKey: options?.sessionId,
        });
      } catch (err) {
        this.trace('sync', p.id, event, {
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - started,
          sessionKey: options?.sessionId,
        });
        log.warn({ err, id: p.id }, 'memory sync failed');
      }
    }
  }

  async applyUnderstandingCandidates(
    candidates: UnderstandingCandidate[],
    context: {
      agentId?: string;
      sessionKey?: string;
      workspaceId?: string;
      projectId?: string;
      sourceItemId?: string;
      sourceItemIds?: string[];
      sourceText?: string;
      source?: MemoryRecord['source'];
      reviewSource?: 'turn' | 'background';
    } = {},
  ): Promise<import('./understanding/types.js').UnderstandingReviewResult> {
    const sessionContext = context.sessionKey ? this.sessionContexts.get(context.sessionKey) : undefined;
    const sourceItemId = context.sourceItemId ?? (context.sessionKey
      ? this.lastTurnSourceItem.get(context.sessionKey)
      : undefined);
    const result = await this.understanding.applyCandidates(candidates, {
      ...context,
      agentId: context.agentId ?? sessionContext?.agentId,
      workspaceId: context.workspaceId ?? sessionContext?.workspace ?? sessionContext?.agentWorkspace,
      sourceItemId,
    });
    const sourceItemIds = [...new Set([...(sourceItemId ? [sourceItemId] : []), ...(context.sourceItemIds ?? [])])];
    if (sourceItemIds.length) {
      setKnowledgeSourceItemSynthesisStatus(sourceItemIds, 'completed');
    }
    return { ...result, ...(sourceItemId ? { sourceItemId } : {}) };
  }

  getExternalToolEntries(): Array<{ providerId: string; tool: AgentTool }> {
    const out: Array<{ providerId: string; tool: AgentTool }> = [];
    const seen = new Set<string>();
    for (const p of this.providers) {
      if (p.capabilities.local) {
        continue;
      }
      try {
        for (const t of p.getToolSchemas?.() ?? []) {
          if (t.name && !seen.has(t.name)) {
            seen.add(t.name);
            out.push({ providerId: p.id, tool: t });
          }
        }
      } catch (err) {
        log.warn({ err, id: p.id }, 'getToolSchemas failed');
      }
    }
    return out;
  }

  async handleToolCall(toolName: string, args: Record<string, unknown>): Promise<string> {
    const provider = this.toolToProvider.get(toolName);
    if (!provider) {
      throw new Error(`No memory provider handles tool '${toolName}'`);
    }
    if (!provider.handleToolCall) {
      throw new Error(`Memory provider '${provider.id}' does not handle tool calls`);
    }
    return provider.handleToolCall(toolName, args);
  }

  async search(request: MemorySearchRequest): Promise<MemorySearchResult[]> {
    const providers = this.providersForSearch();
    const results: MemorySearchResult[] = [];

    for (const p of providers) {
      if (!p.capabilities.search || !p.search) continue;
      const started = Date.now();
      try {
        const providerResults = await p.search(request);
        this.trace('search', p.id, request, {
          resultCount: providerResults.length,
          selectedRecordIds: providerResults.map((result) => result.record.id),
          durationMs: Date.now() - started,
          sessionKey: request.scope?.sessionKey,
        });
        results.push(...providerResults);
        if (providerResults.length > 0 && this.routing.searchStrategy !== 'fanout') {
          break;
        }
      } catch (err) {
        this.trace('search', p.id, request, {
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - started,
          sessionKey: request.scope?.sessionKey,
        });
        log.warn({ err, id: p.id }, 'memory search failed');
      }
    }

    const seen = new Set<string>();
    return results
      .sort((a, b) => b.score - a.score)
      .filter((result) => this.canReadRecord(result.record, request.scope))
      .filter((result) => {
        const key = `${result.citation.providerId}:${result.citation.recordId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, request.maxResults ?? 5);
  }

  async read(request: MemoryReadRequest): Promise<MemoryReadResult | null> {
    for (const p of this.providersForSearch()) {
      if (!p.capabilities.read || !p.read) continue;
      const started = Date.now();
      try {
        const result = await p.read(request);
        this.trace('read', p.id, request, {
          resultCount: result ? 1 : 0,
          selectedRecordIds: result ? [result.record.id] : [],
          durationMs: Date.now() - started,
          sessionKey: request.scope?.sessionKey,
        });
        if (result && this.canReadRecord(result.record, request.scope)) return result;
      } catch (err) {
        this.trace('read', p.id, request, {
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - started,
          sessionKey: request.scope?.sessionKey,
        });
        log.warn({ err, id: p.id }, 'memory read failed');
      }
    }
    return null;
  }

  async get(id: string): Promise<MemoryRecord | null> {
    for (const p of this.providers) {
      if (!p.capabilities.read) continue;
      try {
        const direct = await p.get?.(id);
        if (direct && this.canReadRecord(direct)) return direct;
      } catch (err) {
        log.warn({ err, id: p.id, recordId: id }, 'memory get failed');
      }
    }
    return null;
  }

  async list(request: MemoryListRequest): Promise<MemoryRecord[]> {
    const out: MemoryRecord[] = [];
    for (const p of this.providersForSearch()) {
      if (!p.capabilities.read || !p.list) continue;
      try {
        out.push(...(await p.list(request)).filter((record) => this.canReadRecord(record, request.scope)));
      } catch (err) {
        log.warn({ err, id: p.id }, 'memory list failed');
      }
    }
    return out;
  }

  async write(request: MemoryWriteRequest): Promise<MemoryWriteResult> {
    return this.writeWithStrategy('write', request);
  }

  async update(request: MemoryUpdateRequest): Promise<MemoryWriteResult> {
    return this.writeWithStrategy('update', request);
  }

  async delete(request: MemoryDeleteRequest): Promise<MemoryWriteResult> {
    return this.writeWithStrategy('delete', request);
  }

  private canReadRecord(record: MemoryRecord, scope?: MemorySearchRequest['scope']): boolean {
    if (record.providerId !== 'local') return true;
    if (this.memoryRuntime && !this.memoryRuntime.canRead(memorySourceForRecord(record))) return false;
    if (record.scope.userId && scope?.userId && record.scope.userId !== scope.userId) return false;
    if (record.scope.sessionKey && record.scope.sessionKey !== scope?.sessionKey) return false;
    if (record.scope.projectId && record.scope.projectId !== scope?.projectId) return false;
    if (record.scope.workspaceId && record.scope.workspaceId !== scope?.workspaceId) return false;
    return true;
  }

  recordSignal(signal: MemorySignal): void {
    for (const p of this.providers) {
      const started = Date.now();
      try {
        p.sync?.({ type: 'signal', signal });
        this.trace('sync', p.id, { type: 'signal', signal }, {
          resultCount: 1,
          durationMs: Date.now() - started,
        });
      } catch (err) {
        this.trace('sync', p.id, { type: 'signal', signal }, {
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - started,
        });
        log.debug({ err, id: p.id, source: signal.source }, 'memory signal sync failed');
      }
    }
  }

  async initializeAll(sessionId: string, options?: MemoryProviderInitOptions): Promise<void> {
    if (options) this.sessionContexts.set(sessionId, { ...options });
    await this.loadPluginProvidersOnce();
    for (const p of this.providers) {
      try {
        await p.initialize(sessionId, options);
      } catch (err) {
        log.warn({ err, id: p.id }, 'initialize failed');
      }
    }
  }

  private async loadPluginProvidersOnce(): Promise<void> {
    if (this.pluginProvidersLoaded || !this.loadProviders) return;
    this.pluginProvidersLoaded = true;
    try {
      const providers = await this.loadProviders();
      const existingIds = new Set(this.providers.map((p) => p.id));
      for (const provider of providers) {
        if (existingIds.has(provider.id)) {
          log.warn({ id: provider.id }, 'Skipped duplicate memory provider');
          continue;
        }
        this.addProvider(provider);
        existingIds.add(provider.id);
      }
    } catch (err) {
      log.warn({ err }, 'Memory provider plugin loading failed');
    }
  }

  async shutdownAll(): Promise<void> {
    this.lastTurnSourceItem.clear();
    this.sessionContexts.clear();
    for (const p of [...this.providers].reverse()) {
      try {
        await p.shutdown();
      } catch (err) {
        log.warn({ err, id: p.id }, 'shutdown failed');
      }
    }
  }

  private providersForSearch(): MemoryProvider[] {
    const locals = this.providers.filter((p) => p.capabilities.local);
    const externals = this.providers.filter((p) => !p.capabilities.local);
    switch (this.routing.searchStrategy) {
      case 'local-only':
        return locals;
      case 'external-only':
        return externals;
      case 'external-first':
        return [...externals, ...locals];
      case 'local-first':
      case 'fanout':
      default:
        return [...locals, ...externals];
    }
  }

  private providersForWrite(): MemoryProvider[] {
    const locals = this.providers.filter((p) => p.capabilities.local);
    const externals = this.providers.filter((p) => !p.capabilities.local);
    switch (this.routing.writeStrategy) {
      case 'local-only':
        return locals;
      case 'external-only':
        return externals;
      case 'external-first':
        return [...externals, ...locals];
      case 'write-through':
      case 'local-first':
      default:
        return [...locals, ...externals];
    }
  }

  private async writeWithStrategy(
    operation: 'write' | 'update' | 'delete',
    request: MemoryWriteRequest | MemoryUpdateRequest | MemoryDeleteRequest,
  ): Promise<MemoryWriteResult> {
    const providers =
      operation === 'write' && (request as MemoryWriteRequest).status === 'candidate'
        ? this.providers.filter((provider) => provider.capabilities.local)
        : this.providersForWrite();
    const errors: string[] = [];
    let firstSuccess: MemoryWriteResult | null = null;

    for (const p of providers) {
      const fn = p[operation];
      if (!this.providerAllowedForWrite(p, operation, request)) {
        this.trace(operation, p.id, request, {
          skippedReason: 'policy',
          sessionKey: request.scope?.sessionKey,
        });
        continue;
      }
      const canWrite =
        (operation === 'write' && p.capabilities.write) ||
        (operation === 'update' && p.capabilities.update) ||
        (operation === 'delete' && p.capabilities.delete);
      if (!canWrite || !fn) continue;
      const started = Date.now();
      try {
        const result = await fn.call(p, request as never);
        this.trace(operation, p.id, request, {
          resultCount: result.record ? 1 : 0,
          selectedRecordIds: result.record ? [result.record.id] : [],
          error: result.success ? undefined : result.error,
          durationMs: Date.now() - started,
          sessionKey: request.scope?.sessionKey,
        });
        if (result.success) {
          firstSuccess ??= result;
          if (this.routing.writeStrategy !== 'write-through') {
            return result;
          }
        } else if (result.error) {
          errors.push(`${p.id}: ${result.error}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.trace(operation, p.id, request, {
          error: message,
          durationMs: Date.now() - started,
          sessionKey: request.scope?.sessionKey,
        });
        errors.push(`${p.id}: ${message}`);
        log.warn({ err, id: p.id, operation }, 'memory write operation failed');
      }
    }

    if (firstSuccess) return firstSuccess;
    return { success: false, error: errors.join('; ') || `No provider supports memory ${operation}` };
  }

  private providerAllowedForWrite(
    provider: MemoryProvider,
    operation: 'write' | 'update' | 'delete',
    request: MemoryWriteRequest | MemoryUpdateRequest | MemoryDeleteRequest,
  ): boolean {
    if (!provider.capabilities.local && !this.writePolicy.allowExternalWrites) {
      return false;
    }
    if (
      !provider.capabilities.local &&
      this.writePolicy.allowedProviderIds &&
      this.writePolicy.allowedProviderIds.length > 0 &&
      !this.writePolicy.allowedProviderIds.includes(provider.id)
    ) {
      return false;
    }
    if (operation === 'write') {
      const writeRequest = request as MemoryWriteRequest;
      if (provider.capabilities.local && this.memoryRuntime) {
        const check = this.memoryRuntime.checkWrite({
          target: writeRequest.writeTarget ?? writeTargetForRecord(writeRequest),
          content: writeRequest.content,
          source: writeRequest.source?.provider ?? 'memory',
          confidence: writeRequest.confidence,
          sensitive: writeRequest.sensitivity != null && writeRequest.sensitivity !== 'normal',
        });
        if (check.decision === 'deny') return false;
        if (check.decision === 'confirm' && writeRequest.status !== 'candidate' && !writeRequest.confirmed) return false;
      }
      if (writeRequest.status === 'candidate' && !provider.capabilities.local) {
        return false;
      }
      if (
        this.writePolicy.autoWriteKinds &&
        this.writePolicy.autoWriteKinds.length > 0 &&
        !this.writePolicy.autoWriteKinds.includes(writeRequest.kind)
      ) {
        return false;
      }
    }
    return true;
  }

  private trace(
    phase: 'search' | 'read' | 'write' | 'update' | 'delete' | 'sync' | 'inject' | 'test',
    providerId: string,
    request: unknown,
    meta: {
      sessionKey?: string;
      resultCount?: number;
      selectedRecordIds?: string[];
      skippedReason?: string;
      error?: string;
      durationMs?: number;
    } = {},
  ): void {
    try {
      appendMemoryTraceEvent({
        phase,
        providerId,
        request: sanitizeTraceRequest(request),
        ...meta,
      });
    } catch (err) {
      log.debug({ err, providerId, phase }, 'memory trace append failed');
    }
  }
}

function memorySourceForRecord(record: MemoryRecord): MemorySource {
  if (record.tags?.includes('connected-source') || record.source.provider === 'connected-sources') return 'connectedSources';
  if (record.source.provider === 'agent-profile') return 'agentProfile';
  if (record.source.provider === 'user-profile') return 'userProfile';
  if (record.scope.sessionKey) return 'session';
  if (record.scope.workspaceId || record.kind === 'workspace_fact' || record.kind === 'project_context' || record.kind === 'task_lesson') return 'workspace';
  return 'understanding';
}

function writeTargetForRecord(request: MemoryWriteRequest): 'understanding' | 'workspace' {
  return request.scope?.workspaceId || request.kind === 'workspace_fact' || request.kind === 'project_context' || request.kind === 'task_lesson'
    ? 'workspace'
    : 'understanding';
}

function sanitizeTraceRequest(request: unknown): unknown {
  if (!request || typeof request !== 'object') return request;
  const copy = { ...(request as Record<string, unknown>) };
  if (typeof copy.content === 'string' && copy.content.length > 500) {
    copy.content = `${copy.content.slice(0, 500)}…`;
  }
  return copy;
}
