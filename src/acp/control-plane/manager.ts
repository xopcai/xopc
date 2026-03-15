/**
 * ACP Session Manager
 * 
 * Core manager for ACP session lifecycle, runtime caching, and turn execution.
 * Refactored to delegate to specialized managers.
 */

import type { Config } from "../../config/schema.js";
import { createLogger } from "../../utils/logger.js";
import { AcpRuntimeError, withAcpRuntimeErrorBoundary } from "../runtime/errors.js";
import { formatAcpErrorText, toAcpErrorText } from "../runtime/error-text.js";
import { SessionRateLimiter } from "../../infra/rate-limit.js";
import {
  isSessionIdentityPending,
  resolveSessionIdentityFromMeta,
} from "../runtime/session-identity.js";
import type { AcpRuntime, AcpRuntimeHandle } from "../runtime/types.js";
import {
  type AcpCloseSessionInput,
  type AcpCloseSessionResult,
  type AcpInitializeSessionInput,
  type AcpManagerObservabilitySnapshot,
  type AcpRunTurnInput,
  type AcpSessionResolution,
  type AcpSessionRuntimeOptions,
  type AcpSessionStatus,
  type AcpStartupIdentityReconcileResult,
  type CachedRuntimeState,
  type SessionAcpMeta,
  type SessionEntry,
} from "./manager.types.js";
import { reconcileRuntimeSessionIdentifiers } from "./identity-reconcile.js";
import {
  createUnsupportedControlError,
  normalizeAcpErrorCode,
  normalizeActorKey,
  normalizeSessionKey,
  requireReadySessionMeta,
  resolveAcpSessionResolutionError,
  resolveRuntimeIdleTtlMs,
} from "./manager.utils.js";
import {
  inferRuntimeOptionPatchFromConfigOption,
  resolveRuntimeOptionsFromMeta,
  validateRuntimeConfigOptionInput,
  validateRuntimeModeInput,
} from "./runtime-options.js";
import { SessionActorQueue } from "./session-actor-queue.js";
import { AcpSessionStore, resolveAcpWorkspace } from "./session-store.js";
import { TurnManager } from "./turn-manager.js";
import { RuntimeCacheManager } from "./runtime-cache-manager.js";
import { SessionLifecycleManager } from "./session-lifecycle-manager.js";

/** Session Store Interface */
interface SessionStore {
  load(sessionKey: string): Promise<SessionEntry | null>;
  save(sessionKey: string, entry: SessionEntry): Promise<void>;
  list(): Promise<SessionEntry[]>;
  initialize(): Promise<void>;
  delete(sessionKey: string): Promise<void>;
}

export class AcpSessionManager {
  private readonly actorQueue = new SessionActorQueue();
  private readonly turnManager = new TurnManager();
  private readonly cacheManager: RuntimeCacheManager;
  private readonly lifecycleManager: SessionLifecycleManager;
  private readonly sessionStore: SessionStore;
  private readonly rateLimiter: SessionRateLimiter;
  private readonly logger = createLogger("AcpSessionManager");
  private readonly errorCountsByCode = new Map<string, number>();

  constructor(private readonly sessionStorePath?: string) {
    const workspace = sessionStorePath || resolveAcpWorkspace({} as Config);
    this.sessionStore = new AcpSessionStore(workspace);

    // Initialize rate limiter with defaults (will be updated when config is available)
    this.rateLimiter = new SessionRateLimiter({
      maxRequests: 100,
      windowMs: 60 * 1000, // 1 minute
    });

    this.cacheManager = new RuntimeCacheManager({
      persistMeta: async (sessionKey, meta) => {
        await this.sessionStore.save(sessionKey, { sessionKey, acp: meta });
      },
      enforceConcurrentLimit: (sessionKey) => this.enforceConcurrentSessionLimit(sessionKey),
    });

    this.lifecycleManager = new SessionLifecycleManager({
      loadEntry: (key) => this.sessionStore.load(key),
      saveEntry: (key, entry) => this.sessionStore.save(key, entry),
      listEntries: () => this.sessionStore.list(),
      enforceConcurrentLimit: (key) => this.enforceConcurrentSessionLimit(key),
    });
  }

  /** Initialize the session manager */
  async initialize(): Promise<void> {
    await this.sessionStore.initialize();
  }

  /** Resolve Session */
  async resolveSession(params: { cfg: Config; sessionKey: string }): Promise<AcpSessionResolution> {
    return this.lifecycleManager.resolveSession({
      sessionKey: params.sessionKey,
      getCachedMeta: (key) => {
        const cached = this.cacheManager.get(key);
        return cached
          ? {
              backend: cached.backend,
              agent: cached.agent,
              runtimeSessionName: cached.handle.runtimeSessionName,
              mode: cached.mode,
              cwd: cached.cwd,
              state: "idle",
              lastActivityAt: Date.now(),
            }
          : null;
      },
    });
  }

  /** Get observability snapshot */
  getObservabilitySnapshot(_cfg: Config): AcpManagerObservabilitySnapshot {
    const latencyStats = this.turnManager.getLatencyStats();
    const completedTurns = latencyStats.completed + latencyStats.failed;
    const averageLatencyMs =
      completedTurns > 0 ? Math.round(latencyStats.totalMs / completedTurns) : 0;
    const evictionStats = this.cacheManager.getEvictionStats();

    return {
      runtimeCache: {
        activeSessions: this.cacheManager.size(),
        idleTtlMs: 0,
        evictedTotal: evictionStats.evictedTotal,
        ...(evictionStats.lastEvictedAt ? { lastEvictedAt: evictionStats.lastEvictedAt } : {}),
      },
      turns: {
        active: this.turnManager.getActiveTurnCount(),
        queueDepth: this.actorQueue.getTotalPendingCount(),
        completed: latencyStats.completed,
        failed: latencyStats.failed,
        averageLatencyMs,
        maxLatencyMs: latencyStats.maxMs,
      },
      errorsByCode: Object.fromEntries(
        [...this.errorCountsByCode.entries()].toSorted(([a], [b]) => a.localeCompare(b)),
      ),
    };
  }

  /** Reconciliation: recover pending session identities at startup */
  async reconcilePendingSessionIdentities(params: {
    cfg: Config;
  }): Promise<AcpStartupIdentityReconcileResult> {
    const result: AcpStartupIdentityReconcileResult = {
      checked: 0,
      resolved: 0,
      failed: 0,
    };

    const sessions = await this.lifecycleManager.listSessions();

    for (const session of sessions) {
      if (!session.acp || !session.sessionKey) continue;

      const currentIdentity = resolveSessionIdentityFromMeta(session.acp);
      if (!isSessionIdentityPending(currentIdentity)) continue;

      result.checked += 1;

      try {
        const becameResolved = await this.withSessionActor(session.sessionKey, async () => {
          const resolution = await this.resolveSession({
            cfg: params.cfg,
            sessionKey: session.sessionKey!,
          });

          if (resolution.kind !== "ready") return false;

          const { runtime, handle, meta } = await this.cacheManager.ensureHandle({
            cfg: params.cfg,
            sessionKey: session.sessionKey!,
            meta: resolution.meta,
          });

          const reconciled = await reconcileRuntimeSessionIdentifiers({
            cfg: params.cfg,
            sessionKey: session.sessionKey!,
            runtime,
            handle,
            meta,
            failOnStatusError: false,
            setCachedHandle: (key, h) => {
              this.cacheManager.clear(key);
            },
            writeSessionMeta: async ({ sessionKey, mutate }) => {
              const entry = await this.sessionStore.load(sessionKey);
              const current = entry?.acp;
              const result = mutate(current, entry);
              if (result) {
                await this.sessionStore.save(sessionKey, { sessionKey, acp: result });
                return { sessionKey, acp: result };
              }
              return null;
            },
          });

          return !isSessionIdentityPending(resolveSessionIdentityFromMeta(reconciled.meta));
        });

        if (becameResolved) result.resolved += 1;
      } catch (error) {
        result.failed += 1;
        this.logger.warn({ sessionKey: session.sessionKey, error }, "Failed to reconcile ACP session identity");
      }
    }

    return result;
  }

  /** Initialize Session */
  async initializeSession(input: AcpInitializeSessionInput): Promise<{
    runtime: AcpRuntime;
    handle: AcpRuntimeHandle;
    meta: SessionAcpMeta;
  }> {
    await this.evictIdleRuntimeHandles({ cfg: input.cfg });

    return await this.withSessionActor(input.sessionKey, async () => {
      const { runtime, meta } = await this.lifecycleManager.initializeSession({
        input,
        onRuntimeCreated: async (sessionKey, rt) => {
          this.cacheManager.clear(sessionKey);
        },
      });

      // Ensure handle and cache it
      const { handle } = await this.cacheManager.ensureHandle({
        cfg: input.cfg,
        sessionKey: input.sessionKey,
        meta,
      });

      return { runtime, handle, meta };
    });
  }

  /** Run Turn */
  async runTurn(input: AcpRunTurnInput): Promise<void> {
    // Check rate limit
    const rateLimit = this.rateLimiter.consume(input.sessionKey);
    if (!rateLimit.allowed) {
      throw new AcpRuntimeError(
        "ACP_TURN_FAILED",
        `Rate limit exceeded. Retry after ${Math.ceil(rateLimit.retryAfterMs / 1000)}s.`
      );
    }

    await this.evictIdleRuntimeHandles({ cfg: input.cfg });

    await this.withSessionActor(input.sessionKey, async () => {
      const resolution = await this.resolveSession({ cfg: input.cfg, sessionKey: input.sessionKey });
      if (resolution.kind !== "ready") {
        throw resolveAcpSessionResolutionError(resolution);
      }

      const { runtime, handle, meta } = await this.cacheManager.ensureHandle({
        cfg: input.cfg,
        sessionKey: input.sessionKey,
        meta: resolution.meta,
      });

      await this.turnManager.executeTurn({
        input,
        runtime: { runtime, handle, meta },
        onStateChange: async (state, lastError) => {
          await this.lifecycleManager.setSessionState({
            sessionKey: input.sessionKey,
            state,
            lastError,
            clearLastError: !lastError,
          });
        },
      });
    });
  }

  /** Get Session Status */
  async getSessionStatus(params: {
    cfg: Config;
    sessionKey: string;
    signal?: AbortSignal;
  }): Promise<AcpSessionStatus> {
    this.throwIfAborted(params.signal);
    await this.evictIdleRuntimeHandles({ cfg: params.cfg });

    return await this.withSessionActor(
      params.sessionKey,
      async () => {
        this.throwIfAborted(params.signal);

        const resolution = await this.resolveSession({ cfg: params.cfg, sessionKey: params.sessionKey });
        const resolvedMeta = requireReadySessionMeta(resolution);

        const { runtime, handle, meta } = await this.cacheManager.ensureHandle({
          cfg: params.cfg,
          sessionKey: params.sessionKey,
          meta: resolvedMeta,
        });

        const capabilities = await this.resolveRuntimeCapabilities({ runtime, handle });
        let runtimeStatus = await this.getRuntimeStatusSafe(runtime, handle, params.signal);
        const identity = resolveSessionIdentityFromMeta(meta);

        return {
          sessionKey: params.sessionKey,
          backend: handle.backend || meta.backend,
          agent: meta.agent,
          ...(identity ? { identity } : {}),
          state: meta.state,
          mode: meta.mode,
          runtimeOptions: resolveRuntimeOptionsFromMeta(meta),
          capabilities,
          runtimeStatus,
          lastActivityAt: meta.lastActivityAt,
          lastError: meta.lastError,
        };
      },
      params.signal,
    );
  }

  /** Set Session Runtime Mode */
  async setSessionRuntimeMode(params: {
    cfg: Config;
    sessionKey: string;
    runtimeMode: string;
  }): Promise<AcpSessionRuntimeOptions> {
    const runtimeMode = validateRuntimeModeInput(params.runtimeMode);
    await this.evictIdleRuntimeHandles({ cfg: params.cfg });

    return await this.withSessionActor(params.sessionKey, async () => {
      const resolution = await this.resolveSession({ cfg: params.cfg, sessionKey: params.sessionKey });
      const resolvedMeta = requireReadySessionMeta(resolution);

      const { runtime, handle, meta } = await this.cacheManager.ensureHandle({
        cfg: params.cfg,
        sessionKey: params.sessionKey,
        meta: resolvedMeta,
      });

      const capabilities = await this.resolveRuntimeCapabilities({ runtime, handle });

      if (!capabilities.controls.includes("session/set_mode") || !runtime.setMode) {
        throw createUnsupportedControlError({
          backend: handle.backend || meta.backend,
          control: "session/set_mode",
        });
      }

      await withAcpRuntimeErrorBoundary({
        run: async () => await runtime.setMode!({ handle, mode: runtimeMode }),
        fallbackCode: "ACP_TURN_FAILED",
        fallbackMessage: "Could not update ACP runtime mode.",
      });

      const nextOptions = await this.updateAndPersistOptions(params.sessionKey, { runtimeMode });
      return nextOptions;
    });
  }

  /** Set Session Config Option */
  async setSessionConfigOption(params: {
    cfg: Config;
    sessionKey: string;
    key: string;
    value: string;
  }): Promise<AcpSessionRuntimeOptions> {
    const { key, value } = validateRuntimeConfigOptionInput(params.key, params.value);
    await this.evictIdleRuntimeHandles({ cfg: params.cfg });

    return await this.withSessionActor(params.sessionKey, async () => {
      const resolution = await this.resolveSession({ cfg: params.cfg, sessionKey: params.sessionKey });
      const resolvedMeta = requireReadySessionMeta(resolution);

      const { runtime, handle, meta } = await this.cacheManager.ensureHandle({
        cfg: params.cfg,
        sessionKey: params.sessionKey,
        meta: resolvedMeta,
      });

      const inferredPatch = inferRuntimeOptionPatchFromConfigOption(key, value);
      const capabilities = await this.resolveRuntimeCapabilities({ runtime, handle });

      if (!capabilities.controls.includes("session/set_config_option") || !runtime.setConfigOption) {
        throw createUnsupportedControlError({
          backend: handle.backend || meta.backend,
          control: "session/set_config_option",
        });
      }

      const advertisedKeys = new Set(
        (capabilities.configOptionKeys ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean),
      );

      if (advertisedKeys.size > 0 && !advertisedKeys.has(key.toLowerCase())) {
        throw new AcpRuntimeError(
          "ACP_BACKEND_UNSUPPORTED_CONTROL",
          `ACP backend "${handle.backend || meta.backend}" does not accept config key "${key}".`,
        );
      }

      await withAcpRuntimeErrorBoundary({
        run: async () => await runtime.setConfigOption!({ handle, key, value }),
        fallbackCode: "ACP_TURN_FAILED",
        fallbackMessage: "Could not update ACP runtime config option.",
      });

      const nextOptions = await this.updateAndPersistOptions(params.sessionKey, inferredPatch);
      return nextOptions;
    });
  }

  /** Cancel Session */
  async cancelSession(params: { cfg: Config; sessionKey: string; reason?: string }): Promise<void> {
    await this.evictIdleRuntimeHandles({ cfg: params.cfg });

    const actorKey = normalizeActorKey(params.sessionKey);

    // Try cancel active turn first
    const activeTurn = this.turnManager.getActiveTurn(params.sessionKey);
    if (activeTurn) {
      const cancelled = await this.turnManager.cancelTurn({
        sessionKey: params.sessionKey,
        runtime: { runtime: activeTurn.runtime, handle: activeTurn.handle },
        reason: params.reason,
      });
      if (cancelled) return;
    }

    // Otherwise cancel via session actor
    await this.withSessionActor(params.sessionKey, async () => {
      const resolution = await this.resolveSession({ cfg: params.cfg, sessionKey: params.sessionKey });
      const resolvedMeta = requireReadySessionMeta(resolution);

      const { runtime, handle } = await this.cacheManager.ensureHandle({
        cfg: params.cfg,
        sessionKey: params.sessionKey,
        meta: resolvedMeta,
      });

      try {
        await runtime.cancel({ handle, reason: params.reason });
        await this.lifecycleManager.setSessionState({
          sessionKey: params.sessionKey,
          state: "idle",
          clearLastError: true,
        });
      } catch (error) {
        const acpError =
          error instanceof AcpRuntimeError
            ? error
            : new AcpRuntimeError("ACP_TURN_FAILED", error instanceof Error ? error.message : "Cancel failed");

        await this.lifecycleManager.setSessionState({
          sessionKey: params.sessionKey,
          state: "error",
          lastError: acpError.message,
        });
        throw acpError;
      }
    });
  }

  /** Close Session */
  async closeSession(input: AcpCloseSessionInput): Promise<AcpCloseSessionResult> {
    await this.evictIdleRuntimeHandles({ cfg: input.cfg });

    return await this.withSessionActor(input.sessionKey, async () => {
      const result = await this.lifecycleManager.closeSession({
        input,
        resolveSession: (key) => this.resolveSession({ cfg: input.cfg, sessionKey: key }),
        getRuntime: async (key, meta) => this.cacheManager.ensureHandle({ cfg: input.cfg, sessionKey: key, meta }),
        clearCached: (key) => this.cacheManager.clear(key),
      });

      if (result.runtimeClosed || result.metaCleared) {
        this.cacheManager.clear(input.sessionKey);
      }

      return result;
    });
  }

  // ============== Private Methods ==============

  private async updateAndPersistOptions(
    sessionKey: string,
    patch: Partial<AcpSessionRuntimeOptions>,
  ): Promise<AcpSessionRuntimeOptions> {
    const entry = await this.sessionStore.load(sessionKey);
    const current = entry?.acp?.runtimeOptions ?? {};
    const nextOptions = { ...current, ...patch };

    await this.lifecycleManager.updateRuntimeOptions({
      sessionKey,
      options: nextOptions,
      clearCacheIfCwdChanged: (key, newCwd) => {
        const cached = this.cacheManager.get(key);
        if (cached && (cached.cwd ?? "") !== (newCwd ?? "")) {
          this.cacheManager.clear(key);
        }
      },
    });

    return nextOptions;
  }

  private async resolveRuntimeCapabilities(params: {
    runtime: AcpRuntime;
    handle: AcpRuntimeHandle;
  }): Promise<{ controls: string[]; configOptionKeys?: string[] }> {
    if (params.runtime.getCapabilities) {
      return await Promise.resolve(params.runtime.getCapabilities({ handle: params.handle }));
    }
    return { controls: [] };
  }

  private async getRuntimeStatusSafe(
    runtime: AcpRuntime,
    handle: AcpRuntimeHandle,
    signal?: AbortSignal,
  ): Promise<{ summary?: string; details?: Record<string, unknown> }> {
    if (!runtime.getStatus) return {};

    try {
      this.throwIfAborted(signal);
      return await runtime.getStatus({ handle, signal });
    } catch {
      return {};
    }
  }

  private async evictIdleRuntimeHandles(params: { cfg: Config }): Promise<void> {
    await this.cacheManager.evictIdle({
      cfg: params.cfg,
      hasActiveTurn: (key) => this.turnManager.hasActiveTurn(key),
      onEvict: async (state) => {
        await state.runtime.close({ handle: state.handle, reason: "idle-evicted" });
      },
    });
  }

  private enforceConcurrentSessionLimit(sessionKey: string): void {
    // This will be called by sub-managers; actual check is in initializeSession/ensureHandle
    // Kept for interface compatibility
  }

  private async withSessionActor<T>(
    sessionKey: string,
    op: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const actorKey = normalizeActorKey(sessionKey);
    return await this.actorQueue.run(actorKey, async () => {
      this.throwIfAborted(signal);
      return await op();
    });
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new AcpRuntimeError("ACP_TURN_FAILED", "ACP operation aborted.");
    }
  }
}

// Singleton
let ACP_SESSION_MANAGER_SINGLETON: AcpSessionManager | null = null;
let ACP_SESSION_MANAGER_INIT_PROMISE: Promise<void> | null = null;

export function getAcpSessionManager(): AcpSessionManager {
  if (!ACP_SESSION_MANAGER_SINGLETON) {
    ACP_SESSION_MANAGER_SINGLETON = new AcpSessionManager();
    ACP_SESSION_MANAGER_INIT_PROMISE = ACP_SESSION_MANAGER_SINGLETON.initialize();
  }
  return ACP_SESSION_MANAGER_SINGLETON;
}

/** Initialize and get the ACP session manager */
export async function getAcpSessionManagerAsync(): Promise<AcpSessionManager> {
  const manager = getAcpSessionManager();
  if (ACP_SESSION_MANAGER_INIT_PROMISE) {
    await ACP_SESSION_MANAGER_INIT_PROMISE;
    ACP_SESSION_MANAGER_INIT_PROMISE = null;
  }
  return manager;
}

export const __testing = {
  resetAcpSessionManagerForTests(): void {
    ACP_SESSION_MANAGER_SINGLETON = null;
  },
};
