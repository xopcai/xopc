import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SettingsManager,
  type AgentSession,
} from '@earendil-works/pi-coding-agent';
import type { Model, Api } from '@earendil-works/pi-ai';

import { createLogger } from '../../utils/logger.js';
import { guardSessionManager, type GuardedPiTranscriptManager } from './session-tool-result-guard.js';
import { transformUserMessageForPersistence } from '../inbound/attachment-pipeline.js';
import { openSqliteHydratingSessionManager } from './sqlite-hydrating-session-manager.js';
import { applyXopcProviderApiKey, createEmbeddedCredentialStore } from './xopc-auth-storage.js';
import { wrapStreamFnForXopcExtensions } from './xopc-stream-bridge.js';
import { xopcToolsToDefinitions } from './xopc-tools-bridge.js';
import { applySystemPromptOverrideToSession } from './system-prompt-override.js';

const log = createLogger('EmbeddedSessionRunner');

const DEFAULT_IDLE_TTL_MS = 5 * 60_000;

export type EmbeddedRunnerFingerprintInput = {
  sessionId: string;
  workspaceDir: string;
  modelRef: string;
  toolNames: readonly string[];
  systemPrompt: string;
  thinkingLevel: string;
};

export function buildEmbeddedRunnerFingerprint(input: EmbeddedRunnerFingerprintInput): string {
  const tools = [...input.toolNames].sort().join('\0');
  const promptMarker = `${input.systemPrompt.length}:${input.systemPrompt.slice(0, 128)}`;
  return [
    input.sessionId,
    input.workspaceDir,
    input.modelRef,
    tools,
    promptMarker,
    input.thinkingLevel,
  ].join('');
}

type PooledRunner = {
  sessionKey: string;
  fingerprint: string;
  session: AgentSession;
  piSm: GuardedPiTranscriptManager;
  settingsManager: SettingsManager;
  baseStreamFn: AgentSession['agent']['streamFn'];
  lastUsedAt: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
};

export type AcquireEmbeddedSessionRunnerParams = {
  sessionKey: string;
  sessionId: string;
  workspaceDir: string;
  model: Model<Api>;
  modelRef: string;
  tools: AgentTool[];
  systemPrompt: string;
  thinkingLevel: ThinkingLevel;
};

export type AcquiredEmbeddedSessionRunner = {
  session: AgentSession;
  piSm: GuardedPiTranscriptManager;
  reused: boolean;
  release: () => void;
};

export interface EmbeddedSessionRunnerPoolStats {
  acquires: number;
  reuses: number;
  creates: number;
  evictions: number;
  pooled: number;
}

export function isEmbeddedSessionRunnerEnabled(): boolean {
  const raw = process.env.XOPC_SESSION_RUNNER?.trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off') {
    return false;
  }
  return true;
}

export function getEmbeddedSessionRunnerIdleTtlMs(): number {
  const raw = process.env.XOPC_SESSION_RUNNER_TTL_MS?.trim();
  if (!raw) {
    return DEFAULT_IDLE_TTL_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_IDLE_TTL_MS;
}

function createEmbeddedSettingsManager(cwd: string): SettingsManager {
  const sm = SettingsManager.inMemory({ compaction: { enabled: false } });
  sm.setCompactionEnabled(false);
  void cwd;
  return sm;
}

export interface EmbeddedSessionRunnerPoolOptions {
  /** Override for the env-driven enable flag (testing). */
  isEnabled?: () => boolean;
  /** Override for the env-driven idle TTL (testing). */
  getIdleTtlMs?: () => number;
}

/**
 * Owns the per-session pool of pi `AgentSession` runners. The class is the supported,
 * injectable owner; {@link defaultEmbeddedSessionRunnerPool} keeps the historic
 * module-level free functions working until every caller is migrated to DI.
 */
export class EmbeddedSessionRunnerPool {
  private readonly pool = new Map<string, PooledRunner>();
  private readonly isEnabledFn: () => boolean;
  private readonly getIdleTtlMsFn: () => number;

  private stats: Omit<EmbeddedSessionRunnerPoolStats, 'pooled'> = {
    acquires: 0,
    reuses: 0,
    creates: 0,
    evictions: 0,
  };

  constructor(opts: EmbeddedSessionRunnerPoolOptions = {}) {
    this.isEnabledFn = opts.isEnabled ?? isEmbeddedSessionRunnerEnabled;
    this.getIdleTtlMsFn = opts.getIdleTtlMs ?? getEmbeddedSessionRunnerIdleTtlMs;
  }

  getStats(): Readonly<EmbeddedSessionRunnerPoolStats> {
    return { ...this.stats, pooled: this.pool.size };
  }

  resetForTest(): void {
    for (const entry of this.pool.values()) {
      this.clearIdleTimer(entry);
    }
    this.pool.clear();
    this.stats = { acquires: 0, reuses: 0, creates: 0, evictions: 0 };
  }

  evict(sessionKey: string, reason = 'explicit'): void {
    const entry = this.pool.get(sessionKey);
    if (!entry) {
      return;
    }
    this.disposePooledRunner(sessionKey, entry, reason);
  }

  evictAll(reason = 'dispose_all'): void {
    for (const sessionKey of [...this.pool.keys()]) {
      this.evict(sessionKey, reason);
    }
  }

  async acquire(params: AcquireEmbeddedSessionRunnerParams): Promise<AcquiredEmbeddedSessionRunner> {
    this.stats.acquires += 1;

    const fingerprint = buildEmbeddedRunnerFingerprint({
      sessionId: params.sessionId,
      workspaceDir: params.workspaceDir,
      modelRef: params.modelRef,
      toolNames: params.tools.map((t) => t.name),
      systemPrompt: params.systemPrompt,
      thinkingLevel: params.thinkingLevel ?? 'medium',
    });

    const reuseEnabled = this.isEnabledFn();
    const existing = this.pool.get(params.sessionKey);

    let entry: PooledRunner;
    let reused = false;

    if (reuseEnabled && existing && existing.fingerprint === fingerprint) {
      this.clearIdleTimer(existing);
      entry = existing;
      entry.lastUsedAt = Date.now();
      reused = true;
      this.stats.reuses += 1;
      applySystemPromptOverrideToSession(entry.session, params.systemPrompt);
      entry.session.agent.streamFn = entry.baseStreamFn;
      log.debug({ sessionKey: params.sessionKey }, 'Reusing pooled embedded session runner');
    } else {
      if (existing) {
        this.disposePooledRunner(params.sessionKey, existing, 'fingerprint_mismatch');
      }
      entry = await this.createPooledRunner(params);
      this.pool.set(params.sessionKey, entry);
      this.stats.creates += 1;
      log.debug({ sessionKey: params.sessionKey }, 'Created embedded session runner');
    }

    return {
      session: entry.session,
      piSm: entry.piSm,
      reused,
      release: () => {
        if (!this.isEnabledFn()) {
          this.disposePooledRunner(params.sessionKey, entry, 'runner_disabled');
          return;
        }
        entry.lastUsedAt = Date.now();
        this.scheduleIdleEviction(params.sessionKey, entry);
      },
    };
  }

  private clearIdleTimer(entry: PooledRunner): void {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
  }

  private scheduleIdleEviction(sessionKey: string, entry: PooledRunner): void {
    this.clearIdleTimer(entry);
    const ttlMs = this.getIdleTtlMsFn();
    entry.idleTimer = setTimeout(() => {
      const current = this.pool.get(sessionKey);
      if (current === entry) {
        this.disposePooledRunner(sessionKey, entry, 'idle_ttl');
      }
    }, ttlMs);
    entry.idleTimer.unref?.();
  }

  private disposePooledRunner(sessionKey: string, entry: PooledRunner, reason: string): void {
    this.clearIdleTimer(entry);
    this.pool.delete(sessionKey);
    this.stats.evictions += 1;
    try {
      entry.piSm.flushPendingToolResults?.();
    } catch {
      /* ignore */
    }
    log.debug({ sessionKey, reason }, 'Embedded session runner evicted');
  }

  private async createPooledRunner(params: AcquireEmbeddedSessionRunnerParams): Promise<PooledRunner> {
    const { sessionKey, sessionId, workspaceDir, model, thinkingLevel, tools, systemPrompt } = params;

    const settingsManager = createEmbeddedSettingsManager(workspaceDir);

    const piSm = guardSessionManager(
      openSqliteHydratingSessionManager({
        sessionKey,
        sessionId,
        cwd: workspaceDir,
      }),
      {
        sessionKey,
        contextWindowTokens: model.contextWindow ?? 128_000,
        transformMessageForPersistence: (message) =>
          transformUserMessageForPersistence(sessionKey, message),
      },
    );

    const toolDefs = xopcToolsToDefinitions(tools);
    const toolNames = tools.map((t) => t.name);

    const modelRuntime = await ModelRuntime.create({
      credentials: createEmbeddedCredentialStore(),
    });
    await applyXopcProviderApiKey(modelRuntime, model.provider);

    const resourceLoader = new DefaultResourceLoader({
      cwd: workspaceDir,
      agentDir: getAgentDir(),
      settingsManager,
      noContextFiles: true,
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd: workspaceDir,
      model,
      thinkingLevel: thinkingLevel ?? 'medium',
      sessionManager: piSm,
      settingsManager,
      modelRuntime,
      resourceLoader,
      noTools: 'builtin',
      customTools: toolDefs,
      tools: toolNames,
    });

    applySystemPromptOverrideToSession(session, systemPrompt);
    const baseStreamFn = wrapStreamFnForXopcExtensions(session.agent.streamFn);
    session.agent.streamFn = baseStreamFn;

    const fingerprint = buildEmbeddedRunnerFingerprint({
      sessionId,
      workspaceDir,
      modelRef: params.modelRef,
      toolNames,
      systemPrompt,
      thinkingLevel: thinkingLevel ?? 'medium',
    });

    return {
      sessionKey,
      fingerprint,
      session,
      piSm,
      settingsManager,
      baseStreamFn,
      lastUsedAt: Date.now(),
      idleTimer: null,
    };
  }
}

export const defaultEmbeddedSessionRunnerPool = new EmbeddedSessionRunnerPool();

export function getEmbeddedSessionRunnerStats(): Readonly<EmbeddedSessionRunnerPoolStats> {
  return defaultEmbeddedSessionRunnerPool.getStats();
}

export function resetEmbeddedSessionRunnerForTest(): void {
  defaultEmbeddedSessionRunnerPool.resetForTest();
}

export function evictEmbeddedSessionRunner(sessionKey: string, reason = 'explicit'): void {
  defaultEmbeddedSessionRunnerPool.evict(sessionKey, reason);
}

export function evictAllEmbeddedSessionRunners(reason = 'dispose_all'): void {
  defaultEmbeddedSessionRunnerPool.evictAll(reason);
}

export function acquireEmbeddedSessionRunner(
  params: AcquireEmbeddedSessionRunnerParams,
): Promise<AcquiredEmbeddedSessionRunner> {
  return defaultEmbeddedSessionRunnerPool.acquire(params);
}

/** Resolve session identity used by embedded runner acquire and turn execution. */
export async function resolveEmbeddedTranscriptInputs(
  sessionStore: import('../../session/store.js').SessionStore,
  sessionKey: string,
): Promise<{
  sessionId: string;
  sessionKey: string;
}> {
  return sessionStore.resolveTranscriptPath(sessionKey);
}
