/**
 * ACP Session Manager
 * 
 * Core manager for ACP session lifecycle, runtime caching, and turn execution.
 */

import type { Config } from "../../config/schema.js";
import { AcpRuntimeError, toAcpRuntimeError, withAcpRuntimeErrorBoundary } from "../runtime/errors.js";
import {
  createIdentityFromEnsure,
  identityEquals,
  isSessionIdentityPending,
  mergeSessionIdentity,
  resolveRuntimeHandleIdentifiersFromIdentity,
  resolveSessionIdentityFromMeta,
} from "../runtime/session-identity.js";
import type {
  AcpRuntime,
  AcpRuntimeCapabilities,
  AcpRuntimeHandle,
  AcpRuntimeStatus,
  AcpRuntimeEvent,
} from "../runtime/types.js";
import { requireAcpRuntimeBackend } from "../runtime/registry.js";
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
  type ActiveTurnState,
  type SessionAcpMeta,
  type SessionEntry,
  type TurnLatencyStats,
} from "./manager.types.js";
import { CachedRuntimeState, RuntimeCache } from "./runtime-cache.js";
import {
  inferRuntimeOptionPatchFromConfigOption,
  mergeRuntimeOptions,
  normalizeRuntimeOptions,
  normalizeText,
  resolveRuntimeOptionsFromMeta,
  runtimeOptionsEqual,
  validateRuntimeConfigOptionInput,
  validateRuntimeModeInput,
  validateRuntimeOptionPatch,
} from "./runtime-options.js";
import { SessionActorQueue } from "./session-actor-queue.js";
import {
  createUnsupportedControlError,
  hasLegacyAcpIdentityProjection,
  isAcpSessionKey,
  normalizeAcpErrorCode,
  normalizeActorKey,
  normalizeSessionKey,
  requireReadySessionMeta,
  resolveAcpAgentFromSessionKey,
  resolveAcpSessionResolutionError,
  resolveMissingMetaError,
  resolveRuntimeIdleTtlMs,
} from "./manager.utils.js";

/** Session Store Interface */
interface SessionStore {
  load(sessionKey: string): Promise<SessionEntry | null>;
  save(sessionKey: string, entry: SessionEntry): Promise<void>;
  list(): Promise<SessionEntry[]>;
  initialize(): Promise<void>;
  delete(sessionKey: string): Promise<void>;
}

import { AcpSessionStore, resolveAcpWorkspace } from "./session-store.js";

export class AcpSessionManager {
  private readonly actorQueue = new SessionActorQueue();
  private readonly runtimeCache = new RuntimeCache();
  private readonly activeTurnBySession = new Map<string, ActiveTurnState>();
  private readonly turnLatencyStats: TurnLatencyStats = {
    completed: 0,
    failed: 0,
    totalMs: 0,
    maxMs: 0,
  };
  private readonly errorCountsByCode = new Map<string, number>();
  private evictedRuntimeCount = 0;
  private lastEvictedAt: number | undefined;
  private readonly sessionStore: SessionStore;

  constructor(private readonly sessionStorePath?: string) {
    const workspace = sessionStorePath || resolveAcpWorkspace({} as Config);
    this.sessionStore = new AcpSessionStore(workspace);
  }

  /** Initialize the session manager */
  async initialize(): Promise<void> {
    await this.sessionStore.initialize();
  }

  /** 解析 Session */
  async resolveSession(params: { cfg: Config; sessionKey: string }): Promise<AcpSessionResolution> {
    const sessionKey = normalizeSessionKey(params.sessionKey);
    if (!sessionKey) {
      return { kind: "none", sessionKey };
    }
    
    // 首先从缓存获取 (运行时状态优先)
    const cached = this.runtimeCache.get(normalizeActorKey(sessionKey));
    if (cached) {
      const meta: SessionAcpMeta = {
        backend: cached.backend,
        agent: cached.agent,
        runtimeSessionName: cached.handle.runtimeSessionName,
        mode: cached.mode,
        cwd: cached.cwd,
        state: "idle",
        lastActivityAt: Date.now(),
      };
      return { kind: "ready", sessionKey, meta };
    }
    
    // 从持久化存储获取
    const entry = await this.sessionStore.load(sessionKey);
    if (entry && entry.acp) {
      return { kind: "ready", sessionKey, meta: entry.acp };
    }
    
    // 如果是 ACP session key 但没有元数据，说明是 stale
    if (isAcpSessionKey(sessionKey)) {
      return {
        kind: "stale",
        sessionKey,
        error: resolveMissingMetaError(sessionKey),
      };
    }
    
    return { kind: "none", sessionKey };
  }

  /** 获取可观测性快照 */
  getObservabilitySnapshot(_cfg: Config): AcpManagerObservabilitySnapshot {
    const completedTurns = this.turnLatencyStats.completed + this.turnLatencyStats.failed;
    const averageLatencyMs =
      completedTurns > 0 ? Math.round(this.turnLatencyStats.totalMs / completedTurns) : 0;
    
    return {
      runtimeCache: {
        activeSessions: this.runtimeCache.size(),
        idleTtlMs: 0,
        evictedTotal: this.evictedRuntimeCount,
        ...(this.lastEvictedAt ? { lastEvictedAt: this.lastEvictedAt } : {}),
      },
      turns: {
        active: this.activeTurnBySession.size,
        queueDepth: this.actorQueue.getTotalPendingCount(),
        completed: this.turnLatencyStats.completed,
        failed: this.turnLatencyStats.failed,
        averageLatencyMs,
        maxLatencyMs: this.turnLatencyStats.maxMs,
      },
      errorsByCode: Object.fromEntries(
        [...this.errorCountsByCode.entries()].toSorted(([a], [b]) => a.localeCompare(b)),
      ),
    };
  }

  /** 初始化 Session */
  async initializeSession(input: AcpInitializeSessionInput): Promise<{
    runtime: AcpRuntime;
    handle: AcpRuntimeHandle;
    meta: SessionAcpMeta;
  }> {
    const sessionKey = normalizeSessionKey(input.sessionKey);
    if (!sessionKey) {
      throw new AcpRuntimeError("ACP_SESSION_INIT_FAILED", "ACP session key is required.");
    }
    
    const agent = input.agent.trim();
    await this.evictIdleRuntimeHandles({ cfg: input.cfg });
    
    return await this.withSessionActor(sessionKey, async () => {
      const backend = requireAcpRuntimeBackend(input.backendId || input.cfg.acp?.backend);
      const runtime = backend.runtime;
      const initialRuntimeOptions = validateRuntimeOptionPatch({ cwd: input.cwd });
      const requestedCwd = initialRuntimeOptions.cwd;
      
      this.enforceConcurrentSessionLimit({
        cfg: input.cfg,
        sessionKey,
      });
      
      const handle = await withAcpRuntimeErrorBoundary({
        run: async () =>
          await runtime.ensureSession({
            sessionKey,
            agent,
            mode: input.mode,
            resumeSessionId: input.resumeSessionId,
            cwd: requestedCwd,
          }),
        fallbackCode: "ACP_SESSION_INIT_FAILED",
        fallbackMessage: "Could not initialize ACP session runtime.",
      });
      
      const effectiveCwd = normalizeText(handle.cwd) ?? requestedCwd;
      const effectiveRuntimeOptions = normalizeRuntimeOptions({
        ...initialRuntimeOptions,
        ...(effectiveCwd ? { cwd: effectiveCwd } : {}),
      });
      
      const identityNow = Date.now();
      const initializedIdentity =
        mergeSessionIdentity({
          current: undefined,
          incoming: createIdentityFromEnsure({ handle, now: identityNow }),
          now: identityNow,
        }) ??
        ({ state: "pending" as const, source: "ensure", lastUpdatedAt: identityNow });
      
      const meta: SessionAcpMeta = {
        backend: handle.backend || backend.id,
        agent,
        runtimeSessionName: handle.runtimeSessionName,
        identity: initializedIdentity,
        mode: input.mode,
        ...(Object.keys(effectiveRuntimeOptions).length > 0
          ? { runtimeOptions: effectiveRuntimeOptions }
          : {}),
        cwd: effectiveCwd,
        state: "idle",
        lastActivityAt: Date.now(),
      };
      
      // 持久化
      await this.sessionStore.save(sessionKey, { sessionKey, acp: meta });
      
      this.setCachedRuntimeState(sessionKey, {
        runtime,
        handle,
        backend: handle.backend || backend.id,
        agent,
        mode: input.mode,
        cwd: effectiveCwd,
      });
      
      return { runtime, handle, meta };
    });
  }

  /** 运行 Turn */
  async runTurn(input: AcpRunTurnInput): Promise<void> {
    const sessionKey = normalizeSessionKey(input.sessionKey);
    if (!sessionKey) {
      throw new AcpRuntimeError("ACP_SESSION_INIT_FAILED", "ACP session key is required.");
    }
    
    await this.evictIdleRuntimeHandles({ cfg: input.cfg });
    
    await this.withSessionActor(sessionKey, async () => {
      const resolution = await this.resolveSession({ cfg: input.cfg, sessionKey });
      if (resolution.kind !== "ready") {
        throw resolveAcpSessionResolutionError(resolution);
      }
      
      const { runtime, handle, meta } = await this.ensureRuntimeHandle({
        cfg: input.cfg,
        sessionKey,
        meta: resolution.meta,
      });
      
      const turnStartedAt = Date.now();
      const actorKey = normalizeActorKey(sessionKey);
      
      await this.setSessionState({
        cfg: input.cfg,
        sessionKey,
        state: "running",
        clearLastError: true,
      });
      
      const internalAbortController = new AbortController();
      const onCallerAbort = () => {
        internalAbortController.abort();
      };
      
      if (input.signal?.aborted) {
        internalAbortController.abort();
      } else if (input.signal) {
        input.signal.addEventListener("abort", onCallerAbort, { once: true });
      }
      
      const activeTurn: ActiveTurnState = {
        runtime,
        handle,
        abortController: internalAbortController,
      };
      this.activeTurnBySession.set(actorKey, activeTurn);
      
      let streamError: AcpRuntimeError | null = null;
      
      try {
        const combinedSignal =
          input.signal && typeof AbortSignal.any === "function"
            ? AbortSignal.any([input.signal, internalAbortController.signal])
            : internalAbortController.signal;
        
        for await (const event of runtime.runTurn({
          handle,
          text: input.text,
          attachments: input.attachments,
          mode: input.mode,
          requestId: input.requestId,
          signal: combinedSignal,
        })) {
          if (event.type === "error") {
            streamError = new AcpRuntimeError(
              normalizeAcpErrorCode(event.code),
              event.message?.trim() || "ACP turn failed before completion.",
            );
          }
          if (input.onEvent) {
            await input.onEvent(event);
          }
        }
        
        if (streamError) {
          throw streamError;
        }
        
        this.recordTurnCompletion({ startedAt: turnStartedAt });
        await this.setSessionState({
          cfg: input.cfg,
          sessionKey,
          state: "idle",
          clearLastError: true,
        });
      } catch (error) {
        const acpError = toAcpRuntimeError({
          error,
          fallbackCode: "ACP_TURN_FAILED",
          fallbackMessage: "ACP turn failed before completion.",
        });
        
        this.recordTurnCompletion({
          startedAt: turnStartedAt,
          errorCode: acpError.code,
        });
        
        await this.setSessionState({
          cfg: input.cfg,
          sessionKey,
          state: "error",
          lastError: acpError.message,
        });
        
        throw acpError;
      } finally {
        if (input.signal) {
          input.signal.removeEventListener("abort", onCallerAbort);
        }
        if (this.activeTurnBySession.get(actorKey) === activeTurn) {
          this.activeTurnBySession.delete(actorKey);
        }
        
        if (meta.mode === "oneshot") {
          try {
            await runtime.close({ handle, reason: "oneshot-complete" });
          } catch {
            // Ignore close errors
          } finally {
            this.clearCachedRuntimeState(sessionKey);
          }
        }
      }
    });
  }

  /** 获取 Session 状态 */
  async getSessionStatus(params: {
    cfg: Config;
    sessionKey: string;
    signal?: AbortSignal;
  }): Promise<AcpSessionStatus> {
    const sessionKey = normalizeSessionKey(params.sessionKey);
    if (!sessionKey) {
      throw new AcpRuntimeError("ACP_SESSION_INIT_FAILED", "ACP session key is required.");
    }
    
    this.throwIfAborted(params.signal);
    await this.evictIdleRuntimeHandles({ cfg: params.cfg });
    
    return await this.withSessionActor(
      sessionKey,
      async () => {
        this.throwIfAborted(params.signal);
        
        const resolution = await this.resolveSession({ cfg: params.cfg, sessionKey });
        const resolvedMeta = requireReadySessionMeta(resolution);
        
        const { runtime, handle, meta } = await this.ensureRuntimeHandle({
          cfg: params.cfg,
          sessionKey,
          meta: resolvedMeta,
        });
        
        const capabilities = await this.resolveRuntimeCapabilities({ runtime, handle });
        let runtimeStatus: AcpRuntimeStatus | undefined;
        
        if (runtime.getStatus) {
          runtimeStatus = await withAcpRuntimeErrorBoundary({
            run: async () => {
              this.throwIfAborted(params.signal);
              return await runtime.getStatus!({ handle, signal: params.signal });
            },
            fallbackCode: "ACP_TURN_FAILED",
            fallbackMessage: "Could not read ACP runtime status.",
          });
        }
        
        const identity = resolveSessionIdentityFromMeta(meta);
        
        return {
          sessionKey,
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

  /** 设置 Session Runtime 模式 */
  async setSessionRuntimeMode(params: {
    cfg: Config;
    sessionKey: string;
    runtimeMode: string;
  }): Promise<AcpSessionRuntimeOptions> {
    const sessionKey = normalizeSessionKey(params.sessionKey);
    if (!sessionKey) {
      throw new AcpRuntimeError("ACP_SESSION_INIT_FAILED", "ACP session key is required.");
    }
    
    const runtimeMode = validateRuntimeModeInput(params.runtimeMode);
    await this.evictIdleRuntimeHandles({ cfg: params.cfg });
    
    return await this.withSessionActor(sessionKey, async () => {
      const resolution = await this.resolveSession({ cfg: params.cfg, sessionKey });
      const resolvedMeta = requireReadySessionMeta(resolution);
      
      const { runtime, handle, meta } = await this.ensureRuntimeHandle({
        cfg: params.cfg,
        sessionKey,
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
      
      const nextOptions = mergeRuntimeOptions({
        current: resolveRuntimeOptionsFromMeta(meta),
        patch: { runtimeMode },
      });
      
      await this.persistRuntimeOptions({ cfg: params.cfg, sessionKey, options: nextOptions });
      return nextOptions;
    });
  }

  /** 设置 Session 配置选项 */
  async setSessionConfigOption(params: {
    cfg: Config;
    sessionKey: string;
    key: string;
    value: string;
  }): Promise<AcpSessionRuntimeOptions> {
    const sessionKey = normalizeSessionKey(params.sessionKey);
    if (!sessionKey) {
      throw new AcpRuntimeError("ACP_SESSION_INIT_FAILED", "ACP session key is required.");
    }
    
    const { key, value } = validateRuntimeConfigOptionInput(params.key, params.value);
    await this.evictIdleRuntimeHandles({ cfg: params.cfg });
    
    return await this.withSessionActor(sessionKey, async () => {
      const resolution = await this.resolveSession({ cfg: params.cfg, sessionKey });
      const resolvedMeta = requireReadySessionMeta(resolution);
      
      const { runtime, handle, meta } = await this.ensureRuntimeHandle({
        cfg: params.cfg,
        sessionKey,
        meta: resolvedMeta,
      });
      
      const inferredPatch = inferRuntimeOptionPatchFromConfigOption(key, value);
      const capabilities = await this.resolveRuntimeCapabilities({ runtime, handle });
      
      if (
        !capabilities.controls.includes("session/set_config_option") ||
        !runtime.setConfigOption
      ) {
        throw createUnsupportedControlError({
          backend: handle.backend || meta.backend,
          control: "session/set_config_option",
        });
      }
      
      const advertisedKeys = new Set(
        (capabilities.configOptionKeys ?? [])
          .map((entry) => normalizeText(entry))
          .filter(Boolean) as string[],
      );
      
      if (advertisedKeys.size > 0 && !advertisedKeys.has(key)) {
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
      
      const nextOptions = mergeRuntimeOptions({
        current: resolveRuntimeOptionsFromMeta(meta),
        patch: inferredPatch,
      });
      
      await this.persistRuntimeOptions({ cfg: params.cfg, sessionKey, options: nextOptions });
      return nextOptions;
    });
  }

  /** 取消 Session */
  async cancelSession(params: {
    cfg: Config;
    sessionKey: string;
    reason?: string;
  }): Promise<void> {
    const sessionKey = normalizeSessionKey(params.sessionKey);
    if (!sessionKey) {
      throw new AcpRuntimeError("ACP_SESSION_INIT_FAILED", "ACP session key is required.");
    }
    
    await this.evictIdleRuntimeHandles({ cfg: params.cfg });
    
    const actorKey = normalizeActorKey(sessionKey);
    const activeTurn = this.activeTurnBySession.get(actorKey);
    
    if (activeTurn) {
      activeTurn.abortController.abort();
      if (!activeTurn.cancelPromise) {
        activeTurn.cancelPromise = activeTurn.runtime.cancel({
          handle: activeTurn.handle,
          reason: params.reason,
        });
      }
      await withAcpRuntimeErrorBoundary({
        run: async () => await activeTurn.cancelPromise!,
        fallbackCode: "ACP_TURN_FAILED",
        fallbackMessage: "ACP cancel failed before completion.",
      });
      return;
    }
    
    await this.withSessionActor(sessionKey, async () => {
      const resolution = await this.resolveSession({ cfg: params.cfg, sessionKey });
      const resolvedMeta = requireReadySessionMeta(resolution);
      
      const { runtime, handle } = await this.ensureRuntimeHandle({
        cfg: params.cfg,
        sessionKey,
        meta: resolvedMeta,
      });
      
      try {
        await withAcpRuntimeErrorBoundary({
          run: async () => await runtime.cancel({ handle, reason: params.reason }),
          fallbackCode: "ACP_TURN_FAILED",
          fallbackMessage: "ACP cancel failed before completion.",
        });
        
        await this.setSessionState({
          cfg: params.cfg,
          sessionKey,
          state: "idle",
          clearLastError: true,
        });
      } catch (error) {
        const acpError = toAcpRuntimeError({
          error,
          fallbackCode: "ACP_TURN_FAILED",
          fallbackMessage: "ACP cancel failed before completion.",
        });
        
        await this.setSessionState({
          cfg: params.cfg,
          sessionKey,
          state: "error",
          lastError: acpError.message,
        });
        
        throw acpError;
      }
    });
  }

  /** 关闭 Session */
  async closeSession(input: AcpCloseSessionInput): Promise<AcpCloseSessionResult> {
    const sessionKey = normalizeSessionKey(input.sessionKey);
    if (!sessionKey) {
      throw new AcpRuntimeError("ACP_SESSION_INIT_FAILED", "ACP session key is required.");
    }
    
    await this.evictIdleRuntimeHandles({ cfg: input.cfg });
    
    return await this.withSessionActor(sessionKey, async () => {
      const resolution = await this.resolveSession({ cfg: input.cfg, sessionKey });
      const resolutionError = resolveAcpSessionResolutionError(resolution);
      
      if (resolutionError) {
        if (input.requireAcpSession ?? true) {
          throw resolutionError;
        }
        return { runtimeClosed: false, metaCleared: false };
      }
      
      const meta = requireReadySessionMeta(resolution);
      let runtimeClosed = false;
      let runtimeNotice: string | undefined;
      
      try {
        const { runtime, handle } = await this.ensureRuntimeHandle({
          cfg: input.cfg,
          sessionKey,
          meta,
        });
        
        await withAcpRuntimeErrorBoundary({
          run: async () => await runtime.close({ handle, reason: input.reason }),
          fallbackCode: "ACP_TURN_FAILED",
          fallbackMessage: "ACP close failed before completion.",
        });
        
        runtimeClosed = true;
        this.clearCachedRuntimeState(sessionKey);
      } catch (error) {
        const acpError = toAcpRuntimeError({
          error,
          fallbackCode: "ACP_TURN_FAILED",
          fallbackMessage: "ACP close failed before completion.",
        });
        
        if (
          input.allowBackendUnavailable &&
          (acpError.code === "ACP_BACKEND_MISSING" || acpError.code === "ACP_BACKEND_UNAVAILABLE")
        ) {
          this.clearCachedRuntimeState(sessionKey);
          runtimeNotice = acpError.message;
        } else {
          throw acpError;
        }
      }
      
      let metaCleared = false;
      if (input.clearMeta) {
        await this.sessionStore.save(sessionKey, { sessionKey });
        metaCleared = true;
      }
      
      return { runtimeClosed, runtimeNotice, metaCleared };
    });
  }

  // ============== Private Methods ==============

  private async ensureRuntimeHandle(params: {
    cfg: Config;
    sessionKey: string;
    meta: SessionAcpMeta;
  }): Promise<{ runtime: AcpRuntime; handle: AcpRuntimeHandle; meta: SessionAcpMeta }> {
    const agent =
      params.meta.agent?.trim() ||
      resolveAcpAgentFromSessionKey(params.sessionKey, "main");
    const mode = params.meta.mode;
    const runtimeOptions = resolveRuntimeOptionsFromMeta(params.meta);
    const cwd = runtimeOptions.cwd ?? normalizeText(params.meta.cwd);
    const configuredBackend = (params.meta.backend || params.cfg.acp?.backend || "").trim();
    
    const cached = this.getCachedRuntimeState(params.sessionKey);
    if (cached) {
      const backendMatches = !configuredBackend || cached.backend === configuredBackend;
      const agentMatches = cached.agent === agent;
      const modeMatches = cached.mode === mode;
      const cwdMatches = (cached.cwd ?? "") === (cwd ?? "");
      
      if (backendMatches && agentMatches && modeMatches && cwdMatches) {
        return { runtime: cached.runtime, handle: cached.handle, meta: params.meta };
      }
      this.clearCachedRuntimeState(params.sessionKey);
    }
    
    this.enforceConcurrentSessionLimit({
      cfg: params.cfg,
      sessionKey: params.sessionKey,
    });
    
    const backend = requireAcpRuntimeBackend(configuredBackend || undefined);
    const runtime = backend.runtime;
    
    const ensured = await withAcpRuntimeErrorBoundary({
      run: async () =>
        await runtime.ensureSession({
          sessionKey: params.sessionKey,
          agent,
          mode,
          cwd,
        }),
      fallbackCode: "ACP_SESSION_INIT_FAILED",
      fallbackMessage: "Could not initialize ACP session runtime.",
    });
    
    const previousMeta = params.meta;
    const previousIdentity = resolveSessionIdentityFromMeta(previousMeta);
    const now = Date.now();
    const effectiveCwd = normalizeText(ensured.cwd) ?? cwd;
    const nextRuntimeOptions = normalizeRuntimeOptions({
      ...runtimeOptions,
      ...(effectiveCwd ? { cwd: effectiveCwd } : {}),
    });
    
    const nextIdentity =
      mergeSessionIdentity({
        current: previousIdentity,
        incoming: createIdentityFromEnsure({ handle: ensured, now }),
        now,
      }) ?? previousIdentity;
    
    const nextHandleIdentifiers = resolveRuntimeHandleIdentifiersFromIdentity(nextIdentity);
    const nextHandle: AcpRuntimeHandle = {
      ...ensured,
      ...(nextHandleIdentifiers.backendSessionId
        ? { backendSessionId: nextHandleIdentifiers.backendSessionId }
        : {}),
      ...(nextHandleIdentifiers.agentSessionId
        ? { agentSessionId: nextHandleIdentifiers.agentSessionId }
        : {}),
    };
    
    const nextMeta: SessionAcpMeta = {
      backend: ensured.backend || backend.id,
      agent,
      runtimeSessionName: ensured.runtimeSessionName,
      ...(nextIdentity ? { identity: nextIdentity } : {}),
      mode: params.meta.mode,
      ...(Object.keys(nextRuntimeOptions).length > 0 ? { runtimeOptions: nextRuntimeOptions } : {}),
      ...(effectiveCwd ? { cwd: effectiveCwd } : {}),
      state: previousMeta.state,
      lastActivityAt: now,
      ...(previousMeta.lastError ? { lastError: previousMeta.lastError } : {}),
    };
    
    const shouldPersistMeta =
      previousMeta.backend !== nextMeta.backend ||
      previousMeta.runtimeSessionName !== nextMeta.runtimeSessionName ||
      !identityEquals(previousIdentity, nextIdentity) ||
      previousMeta.agent !== nextMeta.agent ||
      previousMeta.cwd !== nextMeta.cwd ||
      !runtimeOptionsEqual(previousMeta.runtimeOptions, nextMeta.runtimeOptions) ||
      hasLegacyAcpIdentityProjection(previousMeta);
    
    if (shouldPersistMeta) {
      await this.sessionStore.save(params.sessionKey, { sessionKey: params.sessionKey, acp: nextMeta });
    }
    
    this.setCachedRuntimeState(params.sessionKey, {
      runtime,
      handle: nextHandle,
      backend: ensured.backend || backend.id,
      agent,
      mode,
      cwd: effectiveCwd,
    });
    
    return { runtime, handle: nextHandle, meta: nextMeta };
  }

  private async persistRuntimeOptions(params: {
    cfg: Config;
    sessionKey: string;
    options: AcpSessionRuntimeOptions;
  }): Promise<void> {
    const normalized = normalizeRuntimeOptions(params.options);
    const hasOptions = Object.keys(normalized).length > 0;
    
    const entry = await this.sessionStore.load(params.sessionKey);
    const base = entry?.acp;
    
    if (!base) return;
    
    const nextMeta: SessionAcpMeta = {
      backend: base.backend,
      agent: base.agent,
      runtimeSessionName: base.runtimeSessionName,
      ...(base.identity ? { identity: base.identity } : {}),
      mode: base.mode,
      runtimeOptions: hasOptions ? normalized : undefined,
      cwd: normalized.cwd,
      state: base.state,
      lastActivityAt: Date.now(),
      ...(base.lastError ? { lastError: base.lastError } : {}),
    };
    
    await this.sessionStore.save(params.sessionKey, { sessionKey: params.sessionKey, acp: nextMeta });
    
    const cached = this.getCachedRuntimeState(params.sessionKey);
    if (cached && (cached.cwd ?? "") !== (normalized.cwd ?? "")) {
      this.clearCachedRuntimeState(params.sessionKey);
    }
  }

  private enforceConcurrentSessionLimit(params: {
    cfg: Config;
    sessionKey: string;
  }): void {
    const configuredLimit = params.cfg.acp?.maxConcurrentSessions;
    if (typeof configuredLimit !== "number" || !Number.isFinite(configuredLimit)) {
      return;
    }
    
    const limit = Math.max(1, Math.floor(configuredLimit));
    const actorKey = normalizeActorKey(params.sessionKey);
    
    if (this.runtimeCache.has(actorKey)) {
      return;
    }
    
    const activeCount = this.runtimeCache.size();
    if (activeCount >= limit) {
      throw new AcpRuntimeError(
        "ACP_SESSION_INIT_FAILED",
        `ACP max concurrent sessions reached (${activeCount}/${limit}).`,
      );
    }
  }

  private recordTurnCompletion(params: {
    startedAt: number;
    errorCode?: AcpRuntimeError["code"];
  }): void {
    const durationMs = Math.max(0, Date.now() - params.startedAt);
    this.turnLatencyStats.totalMs += durationMs;
    this.turnLatencyStats.maxMs = Math.max(this.turnLatencyStats.maxMs, durationMs);
    
    if (params.errorCode) {
      this.turnLatencyStats.failed += 1;
      this.recordErrorCode(params.errorCode);
    } else {
      this.turnLatencyStats.completed += 1;
    }
  }

  private recordErrorCode(code: string): void {
    const normalized = normalizeAcpErrorCode(code);
    this.errorCountsByCode.set(normalized, (this.errorCountsByCode.get(normalized) ?? 0) + 1);
  }

  private async evictIdleRuntimeHandles(params: { cfg: Config }): Promise<void> {
    const idleTtlMs = resolveRuntimeIdleTtlMs(params.cfg);
    if (idleTtlMs <= 0 || this.runtimeCache.size() === 0) {
      return;
    }
    
    const now = Date.now();
    const candidates = this.runtimeCache.collectIdleCandidates({ maxIdleMs: idleTtlMs, now });
    
    if (candidates.length === 0) return;
    
    for (const candidate of candidates) {
      await this.actorQueue.run(candidate.actorKey, async () => {
        if (this.activeTurnBySession.has(candidate.actorKey)) return;
        
        const lastTouchedAt = this.runtimeCache.getLastTouchedAt(candidate.actorKey);
        if (lastTouchedAt == null || now - lastTouchedAt < idleTtlMs) return;
        
        const cached = this.runtimeCache.peek(candidate.actorKey);
        if (!cached) return;
        
        this.runtimeCache.clear(candidate.actorKey);
        this.evictedRuntimeCount += 1;
        this.lastEvictedAt = Date.now();
        
        try {
          await cached.runtime.close({ handle: cached.handle, reason: "idle-evicted" });
        } catch {
          // Ignore close errors
        }
      });
    }
  }

  private async resolveRuntimeCapabilities(params: {
    runtime: AcpRuntime;
    handle: AcpRuntimeHandle;
  }): Promise<AcpRuntimeCapabilities> {
    if (params.runtime.getCapabilities) {
      return await Promise.resolve(params.runtime.getCapabilities({ handle: params.handle }));
    }
    return { controls: [] };
  }

  private async setSessionState(params: {
    cfg: Config;
    sessionKey: string;
    state: SessionAcpMeta["state"];
    lastError?: string;
    clearLastError?: boolean;
  }): Promise<void> {
    const entry = await this.sessionStore.load(params.sessionKey);
    const base = entry?.acp;
    
    if (!base) return;
    
    const nextMeta: SessionAcpMeta = {
      backend: base.backend,
      agent: base.agent,
      runtimeSessionName: base.runtimeSessionName,
      ...(base.identity ? { identity: base.identity } : {}),
      mode: base.mode,
      ...(base.runtimeOptions ? { runtimeOptions: base.runtimeOptions } : {}),
      ...(base.cwd ? { cwd: base.cwd } : {}),
      state: params.state,
      lastActivityAt: Date.now(),
      ...(base.lastError ? { lastError: base.lastError } : {}),
    };
    
    if (params.lastError?.trim()) {
      nextMeta.lastError = params.lastError.trim();
    } else if (params.clearLastError) {
      delete nextMeta.lastError;
    }
    
    await this.sessionStore.save(params.sessionKey, { sessionKey: params.sessionKey, acp: nextMeta });
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

  private getCachedRuntimeState(sessionKey: string): CachedRuntimeState | null {
    return this.runtimeCache.get(normalizeActorKey(sessionKey));
  }

  private setCachedRuntimeState(
    sessionKey: string,
    state: Omit<CachedRuntimeState, "lastTouchedAt">,
  ): void {
    this.runtimeCache.set(normalizeActorKey(sessionKey), state);
  }

  private clearCachedRuntimeState(sessionKey: string): void {
    this.runtimeCache.clear(normalizeActorKey(sessionKey));
  }
}

// Singleton
let ACP_SESSION_MANAGER_SINGLETON: AcpSessionManager | null = null;
let ACP_SESSION_MANAGER_INIT_PROMISE: Promise<void> | null = null;

export function getAcpSessionManager(): AcpSessionManager {
  if (!ACP_SESSION_MANAGER_SINGLETON) {
    ACP_SESSION_MANAGER_SINGLETON = new AcpSessionManager();
    // Start initialization in background
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