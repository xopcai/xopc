/**
 * ACP Control Plane Types
 * 
 * Type definitions for ACP session management.
 */

import type { Config } from "../../config/schema.js";
import type {
  AcpRuntime,
  AcpRuntimeHandle,
  AcpRuntimeCapabilities,
  AcpRuntimeStatus,
  AcpRuntimeSessionMode,
  AcpRuntimeEvent,
  AcpRuntimeTurnAttachment,
  AcpRuntimePromptMode,
} from "../runtime/types.js";
import type { AcpRuntimeError } from "../runtime/errors.js";

// Re-export types from runtime for convenience
export type {
  SessionAcpMeta,
  SessionIdentity,
  AcpSessionResolution,
  AcpSessionRuntimeOptions,
  AcpSessionStatus,
} from "../runtime/types.js";

/** Session Entry (简化版，避免循环依赖) */
export type SessionEntry = {
  sessionId?: string;
  sessionKey?: string;
  acp?: SessionAcpMeta;
  [key: string]: unknown;
};

/** ACP Initialize Session Input */
export type AcpInitializeSessionInput = {
  cfg: Config;
  sessionKey: string;
  agent: string;
  mode: AcpRuntimeSessionMode;
  resumeSessionId?: string;
  cwd?: string;
  backendId?: string;
};

/** ACP Run Turn Input */
export type AcpRunTurnInput = {
  cfg: Config;
  sessionKey: string;
  text: string;
  attachments?: AcpRuntimeTurnAttachment[];
  mode: AcpRuntimePromptMode;
  requestId: string;
  signal?: AbortSignal;
  onEvent?: (event: AcpRuntimeEvent) => Promise<void> | void;
};

/** ACP Close Session Input */
export type AcpCloseSessionInput = {
  cfg: Config;
  sessionKey: string;
  reason: string;
  requireAcpSession?: boolean;
  clearMeta?: boolean;
  allowBackendUnavailable?: boolean;
};

/** ACP Close Session Result */
export type AcpCloseSessionResult = {
  runtimeClosed: boolean;
  runtimeNotice?: string;
  metaCleared: boolean;
};

/** ACP Session Runtime Options */
export type { AcpSessionRuntimeOptions } from "../runtime/types.js";

/** Active Turn State */
export type ActiveTurnState = {
  runtime: AcpRuntime;
  handle: AcpRuntimeHandle;
  abortController: AbortController;
  cancelPromise?: Promise<void>;
};

/** Turn Latency Stats */
export type TurnLatencyStats = {
  completed: number;
  failed: number;
  totalMs: number;
  maxMs: number;
};

/** ACP Manager Observability Snapshot */
export type AcpManagerObservabilitySnapshot = {
  runtimeCache: {
    activeSessions: number;
    idleTtlMs: number;
    evictedTotal: number;
    lastEvictedAt?: number;
  };
  turns: {
    active: number;
    queueDepth: number;
    completed: number;
    failed: number;
    averageLatencyMs: number;
    maxLatencyMs: number;
  };
  errorsByCode: Record<string, number>;
};

/** ACP Startup Identity Reconcile Result */
export type AcpStartupIdentityReconcileResult = {
  checked: number;
  resolved: number;
  failed: number;
};

/** Session ACP Meta with Entry */
export type SessionEntryWithAcp = SessionEntry & {
  acp: SessionAcpMeta;
};

/** ACP Session Manager Dependencies */
export type AcpSessionManagerDeps = {
  requireRuntimeBackend: (id?: string) => { id: string; runtime: AcpRuntime };
  readSessionEntry: (params: { cfg: Config; sessionKey: string }) => SessionEntry | undefined;
  upsertSessionMeta: (params: {
    cfg: Config;
    sessionKey: string;
    mutate: (
      current: SessionAcpMeta | undefined,
      entry: SessionEntry | undefined,
    ) => SessionAcpMeta | null | undefined;
  }) => Promise<SessionEntry | null>;
  listAcpSessions: (params: { cfg: Config }) => Promise<SessionEntry[]>;
};

/** Cached Runtime State */
export type CachedRuntimeState = {
  runtime: AcpRuntime;
  handle: AcpRuntimeHandle;
  backend: string;
  agent: string;
  mode: AcpRuntimeSessionMode;
  cwd?: string;
  appliedControlSignature?: string;
  lastTouchedAt: number;
};

/** Default Dependencies (will be implemented in manager.ts) */
export const DEFAULT_DEPS: AcpSessionManagerDeps = {
  requireRuntimeBackend: () => {
    throw new Error("ACP runtime backend not configured");
  },
  readSessionEntry: () => undefined,
  upsertSessionMeta: async () => null,
  listAcpSessions: async () => [],
};