import { randomUUID } from 'node:crypto';

import type { AgentMessage, ThinkingLevel } from '@earendil-works/pi-agent-core';

import { InMemoryTranscriptRuntime } from '../../agent/embedded/transcript-runtime.js';
import { evictEmbeddedSessionRunner } from '../../agent/embedded/session-runner.js';
import type { SessionMetadata } from '../../session/types.js';
import { createLogger } from '../../utils/logger.js';
import {
  createSideChatContextSnapshot,
  formatSideChatSelections,
  validateSideChatSelections,
} from './context-snapshot.js';
import type { CreateSideChatInput, SideChatConfig, SideChatStatus, SideChatView } from './types.js';

const DEFAULT_IDLE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_PER_CLIENT = 5;
const DEFAULT_MAX_TOTAL = 50;
const MAX_EXPIRED_RECORDS = 500;
const log = createLogger('Gateway:SideChat');

interface SideChatEntry extends SideChatView {
  runtime: InMemoryTranscriptRuntime;
}

export class SideChatError extends Error {
  constructor(
    message: string,
    readonly code: 'INVALID_REQUEST' | 'NOT_FOUND' | 'PARENT_NOT_FOUND' | 'LIMIT_REACHED' | 'CAPACITY_REACHED' | 'CONFLICT' | 'EXPIRED',
    readonly reason?: 'idle' | 'waiting',
  ) {
    super(message);
  }
}

export interface EphemeralSideChatManagerOptions {
  getParentMetadata: (sessionKey: string) => Promise<SessionMetadata | null>;
  loadParentMessages: (sessionKey: string) => Promise<AgentMessage[]>;
  getDefaultModelRef: (sessionKey: string) => string;
  getWorkspacePath: (metadata: SessionMetadata) => string;
  idleTtlMs?: number;
  maxPerClient?: number;
  maxTotal?: number;
  now?: () => number;
  startSweepTimer?: boolean;
  onBeforeDispose?: (sideChatId: string, clientInstanceId: string) => void | Promise<void>;
  onExpired?: (sideChatId: string, clientInstanceId: string, reason: 'idle' | 'waiting') => void;
}

export class EphemeralSideChatManager {
  private readonly entries = new Map<string, SideChatEntry>();
  private readonly reservations = new Map<string, number>();
  private readonly expired = new Map<string, { clientInstanceId: string; reason: 'idle' | 'waiting'; removeAt: number }>();
  private readonly disposals = new Map<string, { clientInstanceId: string; promise: Promise<boolean> }>();
  private stopped = false;
  private readonly now: () => number;
  private readonly idleTtlMs: number;
  private readonly maxPerClient: number;
  private readonly maxTotal: number;
  private readonly sweepTimer: ReturnType<typeof setInterval> | null;

  constructor(private readonly options: EphemeralSideChatManagerOptions) {
    this.now = options.now ?? Date.now;
    this.idleTtlMs = options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
    this.maxPerClient = options.maxPerClient ?? DEFAULT_MAX_PER_CLIENT;
    this.maxTotal = options.maxTotal ?? DEFAULT_MAX_TOTAL;
    this.sweepTimer = options.startSweepTimer === false
      ? null
      : setInterval(() => {
          void this.sweepExpired().catch((err) => {
            log.warn({ err, phase: 'side_chat_sweep' }, 'Side chat expiry sweep failed');
          });
        }, Math.min(this.idleTtlMs, 60_000));
    this.sweepTimer?.unref();
  }

  async create(input: CreateSideChatInput): Promise<SideChatView> {
    const parentSessionKey = input.parentSessionKey.trim();
    const clientInstanceId = input.clientInstanceId.trim();
    if (!parentSessionKey || !clientInstanceId) {
      throw new SideChatError('parentSessionKey and clientInstanceId are required', 'INVALID_REQUEST');
    }
    await this.sweepExpired();
    if (this.stopped || this.entries.size + [...this.reservations.values()].reduce((a, b) => a + b, 0) >= this.maxTotal) {
      throw new SideChatError('The side chat capacity has been reached', 'CAPACITY_REACHED');
    }
    const activeForClient = [...this.entries.values()].filter((entry) => entry.clientInstanceId === clientInstanceId);
    if (activeForClient.length + (this.reservations.get(clientInstanceId) ?? 0) >= this.maxPerClient) {
      throw new SideChatError(`A client can have at most ${this.maxPerClient} side chats`, 'LIMIT_REACHED');
    }

    this.reservations.set(clientInstanceId, (this.reservations.get(clientInstanceId) ?? 0) + 1);
    try {
      return await this.createEntry({ ...input, parentSessionKey, clientInstanceId });
    } finally {
      const remaining = (this.reservations.get(clientInstanceId) ?? 1) - 1;
      if (remaining) this.reservations.set(clientInstanceId, remaining);
      else this.reservations.delete(clientInstanceId);
    }
  }

  private async createEntry(input: CreateSideChatInput): Promise<SideChatView> {
    const { parentSessionKey, clientInstanceId } = input;
    const metadata = await this.options.getParentMetadata(parentSessionKey);
    if (!metadata || !metadata.sessionId) throw new SideChatError('Parent session not found', 'PARENT_NOT_FOUND');
    const parentMessages = await this.options.loadParentMessages(parentSessionKey);
    if (this.stopped) throw new SideChatError('Gateway is stopping', 'CAPACITY_REACHED');
    let selections;
    try {
      selections = validateSideChatSelections(input.selections);
    } catch (error) {
      throw new SideChatError(error instanceof Error ? error.message : 'Invalid selections', 'INVALID_REQUEST');
    }
    const now = this.now();
    const createdAt = new Date(now).toISOString();
    const id = randomUUID();
    const runtime = new InMemoryTranscriptRuntime({
      runtimeId: `${parentSessionKey}:side-chat:${id}`,
      cwd: this.options.getWorkspacePath(metadata),
      initialMessages: structuredClone(parentMessages),
    });
    const selectionContext = formatSideChatSelections(selections);
    if (selectionContext) {
      runtime.openSessionManager(this.options.getWorkspacePath(metadata)).appendCustomMessageEntry(
        'side-chat-selection',
        selectionContext,
        false,
      );
    }
    runtime.captureBaseline();
    const config: SideChatConfig = {
      modelRef: normalizeOptionalString(input.config?.modelRef) || this.options.getDefaultModelRef(parentSessionKey),
      thinkingLevel: input.config?.thinkingLevel,
    };
    const entry: SideChatEntry = {
      id,
      parentSessionKey,
      clientInstanceId,
      status: 'idle',
      createdAt,
      lastActiveAt: createdAt,
      lastSeenAt: createdAt,
      expiresAt: new Date(now + this.idleTtlMs).toISOString(),
      messageCount: 0,
      context: createSideChatContextSnapshot({
        parentSessionKey,
        parentSessionId: metadata.sessionId,
        parentMessages,
        selections,
        createdAt,
      }),
      config,
      runtime,
    };
    this.entries.set(id, entry);
    return this.toView(entry);
  }

  get(id: string, clientInstanceId: string): SideChatView {
    return this.toView(this.requireEntry(id, clientInstanceId));
  }

  getRuntime(id: string, clientInstanceId: string): InMemoryTranscriptRuntime {
    return this.requireEntry(id, clientInstanceId).runtime;
  }

  getMessages(id: string, clientInstanceId: string): AgentMessage[] {
    const entry = this.requireEntry(id, clientInstanceId);
    const messages = entry.runtime.loadConversationMessages();
    entry.messageCount = messages.length;
    return structuredClone(messages);
  }

  updateConfig(id: string, clientInstanceId: string, patch: Partial<SideChatConfig>): SideChatView {
    const entry = this.requireEntry(id, clientInstanceId);
    if (entry.status !== 'idle') throw new SideChatError('Cannot change config while a run is active', 'CONFLICT');
    const modelRef = patch.modelRef === undefined ? entry.config.modelRef : normalizeOptionalString(patch.modelRef);
    if (!modelRef) throw new SideChatError('modelRef cannot be empty', 'INVALID_REQUEST');
    entry.config = {
      modelRef,
      thinkingLevel: patch.thinkingLevel === undefined ? entry.config.thinkingLevel : patch.thinkingLevel,
    };
    return this.toView(entry);
  }

  heartbeat(id: string, clientInstanceId: string): SideChatView {
    const entry = this.requireEntry(id, clientInstanceId);
    entry.lastSeenAt = new Date(this.now()).toISOString();
    return this.toView(entry);
  }

  extend(id: string, clientInstanceId: string): SideChatView {
    const entry = this.requireEntry(id, clientInstanceId);
    this.touchEntry(entry);
    return this.toView(entry);
  }

  setStatus(id: string, clientInstanceId: string, status: SideChatStatus, runId?: string): SideChatView {
    const entry = this.requireEntry(id, clientInstanceId);
    entry.status = status;
    if (runId) entry.runId = runId;
    if (status === 'idle') entry.runId = undefined;
    if (status === 'idle' || status === 'running') entry.clarification = undefined;
    this.touchEntry(entry);
    return this.toView(entry);
  }

  waitForInput(id: string, clientInstanceId: string, clarification: NonNullable<SideChatView['clarification']>, status: 'waiting-input' | 'waiting-approval' = 'waiting-input'): void {
    this.setStatus(id, clientInstanceId, status);
    this.requireEntry(id, clientInstanceId).clarification = clarification;
  }

  async dispose(id: string, clientInstanceId: string): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry) {
      const pending = this.disposals.get(id);
      return pending?.clientInstanceId === clientInstanceId ? pending.promise : false;
    }
    if (entry.clientInstanceId !== clientInstanceId) return false;
    entry.status = 'closing';
    this.entries.delete(id);
    const cleanup = (async () => {
      try {
        await this.runBeforeDispose(id, clientInstanceId);
        await evictEmbeddedSessionRunner(entry.runtime.runtimeId, 'side_chat_dispose');
        return true;
      } finally {
        this.disposals.delete(id);
      }
    })();
    this.disposals.set(id, { clientInstanceId, promise: cleanup });
    return cleanup;
  }

  async disposeClient(clientInstanceId: string): Promise<number> {
    const ids = [...this.entries.values()]
      .filter((entry) => entry.clientInstanceId === clientInstanceId)
      .map((entry) => entry.id);
    await Promise.all(ids.map((id) => this.dispose(id, clientInstanceId)));
    return ids.length;
  }

  async sweepExpired(at = this.now()): Promise<number> {
    this.pruneExpiredRecords(at);
    const expired = [...this.entries.values()].filter((entry) => this.isExpired(entry, at));
    await Promise.all(expired.map((entry) => this.expireEntry(entry)));
    return expired.length;
  }

  async disposeAll(): Promise<void> {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.stopped = true;
    const entries = [...this.entries.values()];
    await Promise.all(entries.map((entry) => this.dispose(entry.id, entry.clientInstanceId)));
    await Promise.all([...this.disposals.values()].map((entry) => entry.promise));
    this.expired.clear();
  }

  private requireEntry(id: string, clientInstanceId: string): SideChatEntry {
    const entry = this.entries.get(id);
    if (entry && entry.clientInstanceId !== clientInstanceId) throw new SideChatError('Side chat not found', 'NOT_FOUND');
    if (entry && this.isExpired(entry, this.now())) {
      void this.expireEntry(entry).catch((err) => log.warn({ err, sideChatId: id }, 'Side chat expiry cleanup failed'));
    } else if (entry) return entry;
    this.pruneExpiredRecords(this.now());
    const expired = this.expired.get(id);
    if (expired?.clientInstanceId === clientInstanceId) throw new SideChatError('Side chat expired', 'EXPIRED', expired.reason);
    throw new SideChatError('Side chat not found', 'NOT_FOUND');
  }

  private isExpired(entry: SideChatEntry, at: number): boolean {
    return entry.status !== 'running' && entry.expiresAt !== null && Date.parse(entry.expiresAt) <= at;
  }

  private expireEntry(entry: SideChatEntry): Promise<boolean> {
    const reason = entry.status.startsWith('waiting-') ? 'waiting' : 'idle';
    this.expired.set(entry.id, { clientInstanceId: entry.clientInstanceId, reason, removeAt: this.now() + DEFAULT_IDLE_TTL_MS });
    this.pruneExpiredRecords(this.now());
    const cleanup = this.dispose(entry.id, entry.clientInstanceId);
    try {
      this.options.onExpired?.(entry.id, entry.clientInstanceId, reason);
    } catch (err) {
      log.warn({ err, sideChatId: entry.id }, 'Side chat expiry notification failed');
    }
    return cleanup;
  }

  private pruneExpiredRecords(at: number): void {
    for (const [id, entry] of this.expired) if (entry.removeAt <= at) this.expired.delete(id);
    while (this.expired.size > MAX_EXPIRED_RECORDS) this.expired.delete(this.expired.keys().next().value!);
  }

  private toView(entry: SideChatEntry): SideChatView {
    const { runtime: _runtime, ...view } = entry;
    return structuredClone({ ...view, serverNow: new Date(this.now()).toISOString() });
  }

  private touchEntry(entry: SideChatEntry): void {
    const now = this.now();
    entry.lastActiveAt = new Date(now).toISOString();
    entry.expiresAt = entry.status === 'running' ? null : new Date(now + this.idleTtlMs).toISOString();
  }

  private async runBeforeDispose(id: string, clientInstanceId: string): Promise<void> {
    try {
      await this.options.onBeforeDispose?.(id, clientInstanceId);
    } catch (err) {
      log.warn({ err, sideChatId: id, phase: 'side_chat_abort' }, 'Side chat run cleanup failed');
    }
  }
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function parseThinkingLevel(value: unknown): ThinkingLevel | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const levels = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
  if (typeof value !== 'string' || !levels.has(value)) {
    throw new SideChatError('Invalid thinkingLevel', 'INVALID_REQUEST');
  }
  return value as ThinkingLevel;
}
