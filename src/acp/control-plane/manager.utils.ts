/**
 * Manager Utilities
 * 
 * Utility functions for ACP session manager.
 */

import type { Config } from "../../config/schema.js";
import { AcpRuntimeError } from "../runtime/errors.js";
import type { SessionAcpMeta, AcpSessionResolution } from "../runtime/types.js";

// Re-export normalizeAcpErrorCode for use in manager
export { normalizeAcpErrorCode } from "../runtime/errors.js";

/** Normalize actor key */
export function normalizeActorKey(sessionKey: string): string {
  return sessionKey.trim().toLowerCase();
}

/** Normalize session key string */
export function normalizeSessionKey(sessionKey: string): string {
  return sessionKey.trim();
}

/** Whether key looks like an ACP session */
export function isAcpSessionKey(sessionKey: string): boolean {
  return sessionKey.includes(":acp:");
}

/** Parse agent id from agent-prefixed session keys */
export function resolveAcpAgentFromSessionKey(
  sessionKey: string,
  defaultAgent: string,
): string {
  // e.g. `agent:<id>:acp:<uuid>`
  const parts = sessionKey.split(":");
  if (parts.length >= 2 && parts[0] === "agent") {
    return parts[1];
  }
  return defaultAgent;
}

/** Resolve idle TTL in ms from config */
export function resolveRuntimeIdleTtlMs(cfg: Config): number {
  const ttlMinutes = cfg.acp?.runtime?.ttlMinutes;
  if (typeof ttlMinutes !== "number" || !Number.isFinite(ttlMinutes)) {
    return 0;
  }
  return Math.max(0, ttlMinutes * 60 * 1000);
}

/** Require `ready` resolution or throw */
export function requireReadySessionMeta(resolution: AcpSessionResolution): SessionAcpMeta {
  if (resolution.kind !== "ready") {
    throw resolveAcpSessionResolutionError(resolution);
  }
  return resolution.meta;
}

/** Map resolution to a thrown `AcpRuntimeError` */
export function resolveAcpSessionResolutionError(
  resolution: AcpSessionResolution,
): AcpRuntimeError {
  if (resolution.kind === "ready") {
    return new AcpRuntimeError("ACP_SESSION_INIT_FAILED", "Session is ready.");
  }
  if (resolution.kind === "stale") {
    return resolution.error instanceof AcpRuntimeError
      ? resolution.error
      : new AcpRuntimeError("ACP_SESSION_INIT_FAILED", resolution.error.message);
  }
  return new AcpRuntimeError(
    "ACP_SESSION_INIT_FAILED",
    `ACP session not found: ${resolution.sessionKey}`,
  );
}

/** Error when session meta is missing */
export function resolveMissingMetaError(sessionKey: string): Error {
  return new AcpRuntimeError(
    "ACP_SESSION_INIT_FAILED",
    `ACP session metadata not found for ${sessionKey}`,
  );
}

/** Legacy ACP identity projection hook (unused) */
export function hasLegacyAcpIdentityProjection(_meta: SessionAcpMeta): boolean {
  return false;
}

/** Re-export */
export { createUnsupportedControlError } from "../runtime/errors.js";

/** Re-export text normalizer */
export { normalizeText } from "./runtime-options.js";