/**
 * Session Lifecycle Manager
 * 
 * Manages ACP session initialization, closing, and state persistence.
 */

import type { Config } from "../../config/schema.js";
import { createLogger } from "../../utils/logger.js";
import { AcpRuntimeError, withAcpRuntimeErrorBoundary } from "../runtime/errors.js";
import {
  createIdentityFromEnsure,
  mergeSessionIdentity,
  resolveSessionIdentityFromMeta,
} from "../runtime/session-identity.js";
import type { AcpRuntime, SessionAcpMeta } from "../runtime/types.js";
import { requireAcpRuntimeBackend } from "../runtime/registry.js";
import type {
  AcpCloseSessionInput,
  AcpCloseSessionResult,
  AcpInitializeSessionInput,
  AcpSessionResolution,
  AcpSessionRuntimeOptions,
  SessionEntry,
} from "./manager.types.js";
import {
  isAcpSessionKey,
  normalizeSessionKey,
  resolveAcpAgentFromSessionKey,
  resolveMissingMetaError,
} from "./manager.utils.js";
import { normalizeRuntimeOptions, validateRuntimeOptionPatch } from "./runtime-options.js";

const logger = createLogger("AcpSessionLifecycleManager");

export interface SessionLifecycleManagerDeps {
  loadEntry: (sessionKey: string) => Promise<SessionEntry | null>;
  saveEntry: (sessionKey: string, entry: SessionEntry) => Promise<void>;
  listEntries: () => Promise<SessionEntry[]>;
  enforceConcurrentLimit: (sessionKey: string) => void;
}

export class SessionLifecycleManager {
  constructor(private readonly deps: SessionLifecycleManagerDeps) {}

  /** Resolve session from cache or persistence */
  async resolveSession(params: {
    sessionKey: string;
    getCachedMeta: (sessionKey: string) => SessionAcpMeta | null;
  }): Promise<AcpSessionResolution> {
    const { sessionKey, getCachedMeta } = params;
    const normalizedKey = normalizeSessionKey(sessionKey);
    if (!normalizedKey) {
      return { kind: "none", sessionKey };
    }

    // Check cache first
    const cached = getCachedMeta(normalizedKey);
    if (cached) {
      return { kind: "ready", sessionKey: normalizedKey, meta: cached };
    }

    // Load from persistence
    const entry = await this.deps.loadEntry(normalizedKey);
    if (entry && entry.acp) {
      return { kind: "ready", sessionKey: normalizedKey, meta: entry.acp };
    }

    // Stale ACP session
    if (isAcpSessionKey(normalizedKey)) {
      return {
        kind: "stale",
        sessionKey: normalizedKey,
        error: resolveMissingMetaError(normalizedKey),
      };
    }

    return { kind: "none", sessionKey: normalizedKey };
  }

  /** Initialize a new session */
  async initializeSession(params: {
    input: AcpInitializeSessionInput;
    onRuntimeCreated: (sessionKey: string, runtime: { runtime: AcpRuntime; handle: { backend: string }; meta: SessionAcpMeta }) => Promise<void>;
  }): Promise<{ runtime: AcpRuntime; meta: SessionAcpMeta }> {
    const { input, onRuntimeCreated } = params;
    const sessionKey = normalizeSessionKey(input.sessionKey);
    if (!sessionKey) {
      throw new AcpRuntimeError("ACP_SESSION_INIT_FAILED", "ACP session key is required.");
    }

    const agent = input.agent.trim();
    this.deps.enforceConcurrentLimit(sessionKey);

    const backend = requireAcpRuntimeBackend(input.backendId || input.cfg.acp?.backend);
    const runtime = backend.runtime;
    const initialRuntimeOptions = validateRuntimeOptionPatch({ cwd: input.cwd });
    const requestedCwd = initialRuntimeOptions.cwd;

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

    const effectiveCwd = (handle.cwd?.trim() || undefined) ?? requestedCwd;
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

    // Persist
    await this.deps.saveEntry(sessionKey, { sessionKey, acp: meta });

    // Notify and return
    await onRuntimeCreated(sessionKey, { runtime, handle, meta });
    return { runtime, meta };
  }

  /** Close a session */
  async closeSession(params: {
    input: AcpCloseSessionInput;
    resolveSession: (sessionKey: string) => Promise<AcpSessionResolution>;
    getRuntime: (sessionKey: string, meta: SessionAcpMeta) => Promise<{ runtime: AcpRuntime; handle: { backend: string } }>;
    clearCached: (sessionKey: string) => void;
  }): Promise<AcpCloseSessionResult> {
    const { input, resolveSession, getRuntime, clearCached } = params;
    const sessionKey = normalizeSessionKey(input.sessionKey);
    if (!sessionKey) {
      throw new AcpRuntimeError("ACP_SESSION_INIT_FAILED", "ACP session key is required.");
    }

    const resolution = await resolveSession(sessionKey);

    let runtimeClosed = false;
    let runtimeNotice: string | undefined;

    if (resolution.kind === "ready") {
      const meta = resolution.meta;

      try {
        const { runtime, handle } = await getRuntime(sessionKey, meta);

        await withAcpRuntimeErrorBoundary({
          run: async () => await runtime.close({ handle, reason: input.reason }),
          fallbackCode: "ACP_TURN_FAILED",
          fallbackMessage: "ACP close failed before completion.",
        });

        runtimeClosed = true;
        clearCached(sessionKey);
      } catch (error) {
        const acpError =
          error instanceof AcpRuntimeError
            ? error
            : new AcpRuntimeError("ACP_TURN_FAILED", error instanceof Error ? error.message : "Unknown error");

        if (
          input.allowBackendUnavailable &&
          (acpError.code === "ACP_BACKEND_MISSING" || acpError.code === "ACP_BACKEND_UNAVAILABLE")
        ) {
          clearCached(sessionKey);
          runtimeNotice = acpError.message;
        } else {
          throw acpError;
        }
      }
    } else if (input.requireAcpSession ?? true) {
      const error =
        resolution.kind === "stale"
          ? resolution.error
          : new AcpRuntimeError("ACP_SESSION_INIT_FAILED", `ACP session not found: ${sessionKey}`);
      throw error;
    }

    let metaCleared = false;
    if (input.clearMeta) {
      await this.deps.saveEntry(sessionKey, { sessionKey });
      metaCleared = true;
    }

    return { runtimeClosed, runtimeNotice, metaCleared };
  }

  /** Set session state */
  async setSessionState(params: {
    sessionKey: string;
    state: SessionAcpMeta["state"];
    lastError?: string;
    clearLastError?: boolean;
  }): Promise<void> {
    const { sessionKey, state, lastError, clearLastError } = params;
    const entry = await this.deps.loadEntry(sessionKey);
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
      state,
      lastActivityAt: Date.now(),
      ...(base.lastError ? { lastError: base.lastError } : {}),
    };

    if (lastError?.trim()) {
      nextMeta.lastError = lastError.trim();
    } else if (clearLastError) {
      delete nextMeta.lastError;
    }

    await this.deps.saveEntry(sessionKey, { sessionKey, acp: nextMeta });
  }

  /** Update runtime options */
  async updateRuntimeOptions(params: {
    sessionKey: string;
    options: AcpSessionRuntimeOptions;
    clearCacheIfCwdChanged: (sessionKey: string, newCwd?: string) => void;
  }): Promise<void> {
    const { sessionKey, options, clearCacheIfCwdChanged } = params;
    const normalized = normalizeRuntimeOptions(options);
    const hasOptions = Object.keys(normalized).length > 0;

    const entry = await this.deps.loadEntry(sessionKey);
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

    await this.deps.saveEntry(sessionKey, { sessionKey, acp: nextMeta });

    clearCacheIfCwdChanged(sessionKey, normalized.cwd);
  }

  /** List all ACP sessions */
  async listSessions(): Promise<SessionEntry[]> {
    const entries = await this.deps.listEntries();
    return entries.filter((entry) => entry.acp != null);
  }
}
