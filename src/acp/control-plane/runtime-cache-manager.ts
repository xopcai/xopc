/**
 * Runtime Cache Manager
 * 
 * Manages runtime handle caching, eviction, and handle lifecycle.
 */

import type { Config } from "../../config/schema.js";
import { AcpRuntimeError, withAcpRuntimeErrorBoundary } from "../runtime/errors.js";
import {
  createIdentityFromEnsure,
  identityEquals,
  mergeSessionIdentity,
  resolveRuntimeHandleIdentifiersFromIdentity,
  resolveSessionIdentityFromMeta,
} from "../runtime/session-identity.js";
import type { AcpRuntime, AcpRuntimeHandle, SessionAcpMeta } from "../runtime/types.js";
import { requireAcpRuntimeBackend } from "../runtime/registry.js";
import type { CachedRuntimeState } from "./manager.types.js";
import { RuntimeCache } from "./runtime-cache.js";
import {
  hasLegacyAcpIdentityProjection,
  normalizeActorKey,
  normalizeSessionKey,
  normalizeText,
  resolveAcpAgentFromSessionKey,
  resolveRuntimeIdleTtlMs,
} from "./manager.utils.js";
import {
  normalizeRuntimeOptions,
  resolveRuntimeOptionsFromMeta,
  runtimeOptionsEqual,
} from "./runtime-options.js";

export interface RuntimeCacheManagerDeps {
  persistMeta: (sessionKey: string, meta: SessionAcpMeta) => Promise<void>;
  enforceConcurrentLimit: (sessionKey: string) => void;
}

export class RuntimeCacheManager {
  private readonly cache = new RuntimeCache();
  private evictedRuntimeCount = 0;
  private lastEvictedAt: number | undefined;

  constructor(private readonly deps: RuntimeCacheManagerDeps) {}

  /** Get cached runtime state */
  get(sessionKey: string): CachedRuntimeState | null {
    return this.cache.get(normalizeActorKey(sessionKey));
  }

  /** Check if session is cached */
  has(sessionKey: string): boolean {
    return this.cache.has(normalizeActorKey(sessionKey));
  }

  /** Get cache size */
  size(): number {
    return this.cache.size();
  }

  /** Clear cached runtime state */
  clear(sessionKey: string): void {
    this.cache.clear(normalizeActorKey(sessionKey));
  }

  /** Ensure runtime handle exists (create or reuse cached) */
  async ensureHandle(params: {
    cfg: Config;
    sessionKey: string;
    meta: SessionAcpMeta;
  }): Promise<{ runtime: AcpRuntime; handle: AcpRuntimeHandle; meta: SessionAcpMeta }> {
    const { cfg, sessionKey, meta } = params;
    const normalizedKey = normalizeSessionKey(sessionKey);
    if (!normalizedKey) {
      throw new AcpRuntimeError("ACP_SESSION_INIT_FAILED", "ACP session key is required.");
    }

    const agent = meta.agent?.trim() || resolveAcpAgentFromSessionKey(normalizedKey, "main");
    const mode = meta.mode;
    const runtimeOptions = resolveRuntimeOptionsFromMeta(meta);
    const cwd = runtimeOptions.cwd ?? normalizeText(meta.cwd);
    const configuredBackend = (meta.backend || cfg.acp?.backend || "").trim();

    // Check cache first
    const cached = this.get(normalizedKey);
    if (cached) {
      const backendMatches = !configuredBackend || cached.backend === configuredBackend;
      const agentMatches = cached.agent === agent;
      const modeMatches = cached.mode === mode;
      const cwdMatches = (cached.cwd ?? "") === (cwd ?? "");

      if (backendMatches && agentMatches && modeMatches && cwdMatches) {
        return { runtime: cached.runtime, handle: cached.handle, meta };
      }
      this.clear(normalizedKey);
    }

    this.deps.enforceConcurrentLimit(normalizedKey);

    const backend = requireAcpRuntimeBackend(configuredBackend || undefined);
    const runtime = backend.runtime;

    const ensured = await withAcpRuntimeErrorBoundary({
      run: async () =>
        await runtime.ensureSession({
          sessionKey: normalizedKey,
          agent,
          mode,
          cwd,
        }),
      fallbackCode: "ACP_SESSION_INIT_FAILED",
      fallbackMessage: "Could not initialize ACP session runtime.",
    });

    const previousMeta = meta;
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
      mode: meta.mode,
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
      await this.deps.persistMeta(normalizedKey, nextMeta);
    }

    this.set(normalizedKey, {
      runtime,
      handle: nextHandle,
      backend: ensured.backend || backend.id,
      agent,
      mode,
      cwd: effectiveCwd,
    });

    return { runtime, handle: nextHandle, meta: nextMeta };
  }

  /** Evict idle runtime handles based on TTL */
  async evictIdle(params: {
    cfg: Config;
    hasActiveTurn: (sessionKey: string) => boolean;
    onEvict: (state: CachedRuntimeState) => Promise<void>;
  }): Promise<void> {
    const { cfg, hasActiveTurn, onEvict } = params;
    const idleTtlMs = resolveRuntimeIdleTtlMs(cfg);
    if (idleTtlMs <= 0 || this.cache.size() === 0) {
      return;
    }

    const now = Date.now();
    const candidates = this.cache.collectIdleCandidates({ maxIdleMs: idleTtlMs, now });

    if (candidates.length === 0) return;

    for (const candidate of candidates) {
      if (hasActiveTurn(candidate.actorKey)) continue;

      const lastTouchedAt = this.cache.getLastTouchedAt(candidate.actorKey);
      if (lastTouchedAt == null || now - lastTouchedAt < idleTtlMs) continue;

      const cached = this.cache.peek(candidate.actorKey);
      if (!cached) continue;

      this.cache.clear(candidate.actorKey);
      this.evictedRuntimeCount += 1;
      this.lastEvictedAt = Date.now();

      try {
        await onEvict(cached);
      } catch {
        // Ignore close errors
      }
    }
  }

  /** Get eviction statistics */
  getEvictionStats(): { evictedTotal: number; lastEvictedAt?: number } {
    return {
      evictedTotal: this.evictedRuntimeCount,
      lastEvictedAt: this.lastEvictedAt,
    };
  }

  private set(
    sessionKey: string,
    state: Omit<CachedRuntimeState, "lastTouchedAt">,
  ): void {
    this.cache.set(normalizeActorKey(sessionKey), state);
  }
}
