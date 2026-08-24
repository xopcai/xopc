import { createHash } from 'node:crypto';

import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SettingsManager,
  type AgentSession,
} from '@earendil-works/pi-coding-agent';
import type { Model, Api } from '@earendil-works/pi-ai';

import { createLogger } from '../../utils/logger.js';
import { guardSessionManager, type GuardedPiTranscriptManager } from './session-tool-result-guard.js';
import { transformUserMessageForPersistence } from '../inbound/attachment-pipeline.js';
import type { EmbeddedTranscriptRuntime } from './transcript-runtime.js';
import {
  createEmbeddedModelRuntime,
  resolveEmbeddedProviderApiKeySync,
} from './model-runtime.js';
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
  credentialRevision: string;
};

function providerCredentialRevision(providerId: string): string {
  const apiKey = resolveEmbeddedProviderApiKeySync(providerId);
  return apiKey ? createHash('sha256').update(apiKey).digest('base64url') : 'none';
}

export function buildEmbeddedRunnerFingerprint(input: EmbeddedRunnerFingerprintInput): string {
  const tools = [...input.toolNames].sort().join('\0');
  return createHash('sha256').update([
    input.sessionId,
    input.workspaceDir,
    input.modelRef,
    tools,
    input.systemPrompt,
    input.thinkingLevel,
    input.credentialRevision,
  ].join('\0')).digest('base64url');
}

type PooledRunner = {
  runtimeId: string;
  fingerprint: string;
  session: AgentSession;
  piSm: GuardedPiTranscriptManager;
  settingsManager: SettingsManager;
  baseStreamFn: AgentSession['agent']['streamFunction'];
  lastUsedAt: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
};

export type AcquireEmbeddedSessionRunnerParams = {
  runtimeId: string;
  sessionId: string;
  workspaceDir: string;
  model: Model<Api>;
  modelRef: string;
  tools: AgentTool[];
  systemPrompt: string;
  thinkingLevel: ThinkingLevel;
  transcriptRuntime: EmbeddedTranscriptRuntime;
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
 * Owns the per-runtime pool of pi `AgentSession` runners.
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

  evict(runtimeId: string, reason = 'explicit'): void {
    const entry = this.pool.get(runtimeId);
    if (!entry) {
      return;
    }
    this.disposePooledRunner(runtimeId, entry, reason);
  }

  evictAll(reason = 'dispose_all'): void {
    for (const runtimeId of [...this.pool.keys()]) {
      this.evict(runtimeId, reason);
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
      credentialRevision: providerCredentialRevision(params.model.provider),
    });

    const reuseEnabled = this.isEnabledFn();
    const existing = this.pool.get(params.runtimeId);

    let entry: PooledRunner;
    let reused = false;

    if (reuseEnabled && existing && existing.fingerprint === fingerprint) {
      this.clearIdleTimer(existing);
      entry = existing;
      entry.lastUsedAt = Date.now();
      reused = true;
      this.stats.reuses += 1;
      applySystemPromptOverrideToSession(entry.session, params.systemPrompt);
      entry.session.agent.streamFunction = entry.baseStreamFn;
      log.debug({ runtimeId: params.runtimeId }, 'Reusing pooled embedded session runner');
    } else {
      if (existing) {
        this.disposePooledRunner(params.runtimeId, existing, 'fingerprint_mismatch');
      }
      entry = await this.createPooledRunner(params);
      this.pool.set(params.runtimeId, entry);
      this.stats.creates += 1;
      log.debug({ runtimeId: params.runtimeId }, 'Created embedded session runner');
    }

    return {
      session: entry.session,
      piSm: entry.piSm,
      reused,
      release: () => {
        if (!this.isEnabledFn()) {
          this.disposePooledRunner(params.runtimeId, entry, 'runner_disabled');
          return;
        }
        entry.lastUsedAt = Date.now();
        this.scheduleIdleEviction(params.runtimeId, entry);
      },
    };
  }

  private clearIdleTimer(entry: PooledRunner): void {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
  }

  private scheduleIdleEviction(runtimeId: string, entry: PooledRunner): void {
    this.clearIdleTimer(entry);
    const ttlMs = this.getIdleTtlMsFn();
    entry.idleTimer = setTimeout(() => {
      const current = this.pool.get(runtimeId);
      if (current === entry) {
        this.disposePooledRunner(runtimeId, entry, 'idle_ttl');
      }
    }, ttlMs);
    entry.idleTimer.unref?.();
  }

  private disposePooledRunner(runtimeId: string, entry: PooledRunner, reason: string): void {
    this.clearIdleTimer(entry);
    this.pool.delete(runtimeId);
    this.stats.evictions += 1;
    try {
      entry.piSm.flushPendingToolResults?.();
    } catch {
      /* ignore */
    }
    log.debug({ runtimeId, reason }, 'Embedded session runner evicted');
  }

  private async createPooledRunner(params: AcquireEmbeddedSessionRunnerParams): Promise<PooledRunner> {
    const { runtimeId, sessionId, workspaceDir, model, thinkingLevel, tools, systemPrompt } = params;

    const settingsManager = createEmbeddedSettingsManager(workspaceDir);

    const piSm = guardSessionManager(
      params.transcriptRuntime.openSessionManager(workspaceDir),
      {
        sessionKey: params.transcriptRuntime.persistent ? runtimeId : undefined,
        contextWindowTokens: model.contextWindow ?? 128_000,
        transformMessageForPersistence: params.transcriptRuntime.persistent
          ? (message) => transformUserMessageForPersistence(runtimeId, message)
          : undefined,
      },
    );

    const toolDefs = xopcToolsToDefinitions(tools);
    const toolNames = tools.map((t) => t.name);

    const modelRuntime = await createEmbeddedModelRuntime(model.provider);

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
    const baseStreamFn = wrapStreamFnForXopcExtensions(session.agent.streamFunction);
    session.agent.streamFunction = baseStreamFn;

    const fingerprint = buildEmbeddedRunnerFingerprint({
      sessionId,
      workspaceDir,
      modelRef: params.modelRef,
      toolNames,
      systemPrompt,
      thinkingLevel: thinkingLevel ?? 'medium',
      credentialRevision: providerCredentialRevision(model.provider),
    });

    return {
      runtimeId,
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

export function evictEmbeddedSessionRunner(runtimeId: string, reason = 'explicit'): void {
  defaultEmbeddedSessionRunnerPool.evict(runtimeId, reason);
}

export function evictAllEmbeddedSessionRunners(reason = 'dispose_all'): void {
  defaultEmbeddedSessionRunnerPool.evictAll(reason);
}

export function acquireEmbeddedSessionRunner(
  params: AcquireEmbeddedSessionRunnerParams,
): Promise<AcquiredEmbeddedSessionRunner> {
  return defaultEmbeddedSessionRunnerPool.acquire(params);
}
