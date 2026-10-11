import { createHash } from 'node:crypto';
import { join } from 'node:path';

import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import {
  createAgentSession,
  DefaultResourceLoader,
  createMcpExtension,
  type LoadedMcpConfig,
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
import { createXopcCodemodeExtension, type CodemodePolicy } from './codemode-extension.js';
import { isCodemodeCoreRead } from '../tools/codemode-permissions.js';
import { deferredToolContract, getXopcToolMetadata } from './tool-metadata.js';
import { createXopcToolSearchExtension, TOOL_DISCOVERY_STATE } from './tool-search-extension.js';
import { getNativePiAgentDir } from '../mcp/native-mcp.js';
import { abortEmbeddedRun } from './runs.js';

const toolContract = (tool: AgentTool) => JSON.stringify([tool.name, tool.parameters, tool.description,
  isCodemodeCoreRead(tool), getXopcToolMetadata(tool)]);

const log = createLogger('EmbeddedSessionRunner');

const DEFAULT_IDLE_TTL_MS = 5 * 60_000;

export type EmbeddedRunnerFingerprintInput = {
  transcriptId: string;
  workspaceDir: string;
  modelRef: string;
  toolNames: readonly string[];
  toolContracts: readonly string[];
  systemPrompt: string;
  thinkingLevel: string;
  credentialRevision: string;
  codemode?: CodemodePolicy;
  mcp?: LoadedMcpConfig;
};

function providerCredentialRevision(providerId: string): string {
  const apiKey = resolveEmbeddedProviderApiKeySync(providerId);
  return apiKey ? createHash('sha256').update(apiKey).digest('base64url') : 'none';
}

export function buildEmbeddedRunnerFingerprint(input: EmbeddedRunnerFingerprintInput): string {
  const tools = [...input.toolNames].sort().join('\0');
  return createHash('sha256').update([
    input.transcriptId,
    input.workspaceDir,
    input.modelRef,
    tools,
    [...input.toolContracts].sort().join('\0'),
    input.systemPrompt,
    input.thinkingLevel,
    input.credentialRevision,
    JSON.stringify(input.codemode ?? null),
    JSON.stringify(input.mcp ?? null),
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
  releaseInvalidations: Array<() => void>;
};

export type AcquireEmbeddedSessionRunnerParams = {
  runtimeId: string;
  transcriptId: string;
  workspaceDir: string;
  model: Model<Api>;
  modelRef: string;
  tools: AgentTool[];
  systemPrompt: string;
  thinkingLevel: ThinkingLevel;
  transcriptRuntime: EmbeddedTranscriptRuntime;
  codemode?: CodemodePolicy;
  mcp?: LoadedMcpConfig;
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
  const sm = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
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
  private readonly shutdowns = new Set<Promise<unknown>>();
  async drainShutdowns(): Promise<void> { await Promise.allSettled([...this.shutdowns]); }

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
    this.evictAll('test_reset');
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
      transcriptId: params.transcriptId,
      workspaceDir: params.workspaceDir,
      modelRef: params.modelRef,
      toolNames: params.tools.map((t) => t.name),
      toolContracts: params.tools.map(toolContract),
      systemPrompt: params.systemPrompt,
      thinkingLevel: params.thinkingLevel ?? 'medium',
      credentialRevision: providerCredentialRevision(params.model.provider),
      codemode: params.codemode,
      mcp: params.mcp,
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
    for (const release of entry.releaseInvalidations) release();
    this.pool.delete(runtimeId);
    this.stats.evictions += 1;
    const shutdown = Promise.resolve(entry.session.abort?.()).catch(err => {
      log.warn({ err, runtimeId }, 'Embedded runner abort failed');
    }).then(async () => {
      try {
        await entry.session.extensionRunner?.emit({ type: 'session_shutdown', reason: 'quit' });
      } finally {
        try { entry.piSm.flushPendingToolResults?.(); }
        finally { entry.session.dispose?.(); }
      }
    }).catch(err => log.warn({ err, runtimeId }, 'Embedded runner disposal failed'));
    this.shutdowns.add(shutdown);
    void shutdown.finally(() => this.shutdowns.delete(shutdown));
    log.debug({ runtimeId, reason }, 'Embedded session runner evicted');
  }

  private async createPooledRunner(params: AcquireEmbeddedSessionRunnerParams): Promise<PooledRunner> {
    const { runtimeId, transcriptId, workspaceDir, model, thinkingLevel, tools, systemPrompt } = params;

    const settingsManager = createEmbeddedSettingsManager(workspaceDir);

    const piSm = guardSessionManager(
      params.transcriptRuntime.openSessionManager(workspaceDir),
      {
        conversationId: params.transcriptRuntime.persistent ? runtimeId : undefined,
        persistCustomTypes: ['codemode-store', TOOL_DISCOVERY_STATE],
        contextWindowTokens: model.contextWindow ?? 128_000,
        transformMessageForPersistence: params.transcriptRuntime.persistent
          ? (message) => transformUserMessageForPersistence(runtimeId, message)
          : undefined,
      },
    );

    const toolDefs = xopcToolsToDefinitions(tools);
    const toolNames = tools.filter(tool => getXopcToolMetadata(tool)?.exposure !== 'deferred').map(tool => tool.name);
    const discoveryState = piSm.getBranch().findLast(entry => entry.type === 'custom' && entry.customType === TOOL_DISCOVERY_STATE);
    const saved = discoveryState?.type === 'custom' ? discoveryState.data as { loaded?: { name: string; contract: string }[] } : undefined;
    const restored = new Map((saved?.loaded ?? []).map(tool => [tool.name, tool.contract]));
    toolNames.push(...tools.filter(tool => getXopcToolMetadata(tool)?.exposure === 'deferred'
      && restored.get(tool.name) === deferredToolContract(tool)).map(tool => tool.name));
    let boundSession: AgentSession | undefined;
    const mcp = params.mcp;
    const hasMcp = Boolean(mcp?.servers.length);
    const usesMcpCodemode = mcp?.servers.some(server => server.config.enabled !== false
      && [server.config.exposure ?? 'codemode', ...Object.values(server.config.toolExposure ?? {})].includes('codemode'));
    const codemode = params.codemode?.enabled ? params.codemode : usesMcpCodemode
      ? { enabled: true, timeoutMs: 60_000, maxConcurrentCalls: 4, maxCalls: 32, maxOutputTokens: 4000 } : undefined;
    if (codemode) toolNames.push('codemode');
    const discovery = hasMcp || tools.some(tool => getXopcToolMetadata(tool)?.exposure === 'deferred');
    if (discovery) toolNames.push('tool_search');

    const modelRuntime = await createEmbeddedModelRuntime(model.provider);

    const resourceLoader = new DefaultResourceLoader({
      cwd: workspaceDir,
      agentDir: getNativePiAgentDir(),
      settingsManager,
      systemPrompt,
      noContextFiles: true,
      noExtensions: true,
      extensionFactories: [
        ...(codemode ? [createXopcCodemodeExtension(codemode, tools, () => boundSession)] : []),
        ...(discovery ? [createXopcToolSearchExtension(tools)] : []),
        ...(mcp ? [createMcpExtension({ loadConfig: () => mcp, logPath: join(getNativePiAgentDir(), 'mcp.log') })] : []),
      ],
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

    });
    boundSession = session;
    session.setActiveToolsByName(toolNames);
    if (codemode || discovery || mcp) await session.bindExtensions({});

    const baseStreamFn = wrapStreamFnForXopcExtensions(session.agent.streamFunction);
    session.agent.streamFunction = baseStreamFn;

    const fingerprint = buildEmbeddedRunnerFingerprint({
      transcriptId,
      workspaceDir,
      modelRef: params.modelRef,
      toolNames: tools.map(tool => tool.name),
      toolContracts: tools.map(toolContract),
      systemPrompt,
      thinkingLevel: thinkingLevel ?? 'medium',
      credentialRevision: providerCredentialRevision(model.provider),
      codemode: params.codemode,
      mcp: params.mcp,
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
      releaseInvalidations: tools.flatMap(tool => {
        const subscribe = getXopcToolMetadata(tool)?.subscribeInvalidation;
        if (!subscribe) return [];
        return [subscribe(() => {
          if (this.pool.get(runtimeId)?.session !== session) return;
          void abortEmbeddedRun(runtimeId);
          this.evict(runtimeId, 'external_tool_catalog_changed');
        })];
      }),
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

export function drainEmbeddedSessionRunnerShutdowns(): Promise<void> {
  return defaultEmbeddedSessionRunnerPool.drainShutdowns();
}
