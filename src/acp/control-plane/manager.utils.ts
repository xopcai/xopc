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

/** 标准化 Actor Key */
export function normalizeActorKey(sessionKey: string): string {
  return sessionKey.trim().toLowerCase();
}

/** 标准化 Session Key */
export function normalizeSessionKey(sessionKey: string): string {
  return sessionKey.trim();
}

/** 检查是否为 ACP Session Key */
export function isAcpSessionKey(sessionKey: string): boolean {
  return sessionKey.includes(":acp:");
}

/** 从 Session Key 解析 ACP Agent */
export function resolveAcpAgentFromSessionKey(
  sessionKey: string,
  defaultAgent: string,
): string {
  // 格式: agent:xxx:acp:uuid
  const parts = sessionKey.split(":");
  if (parts.length >= 2 && parts[0] === "agent") {
    return parts[1];
  }
  return defaultAgent;
}

/** 解析 Runtime Idle TTL (毫秒) */
export function resolveRuntimeIdleTtlMs(cfg: Config): number {
  const ttlMinutes = cfg.acp?.runtime?.ttlMinutes;
  if (typeof ttlMinutes !== "number" || !Number.isFinite(ttlMinutes)) {
    return 0;
  }
  return Math.max(0, ttlMinutes * 60 * 1000);
}

/** 要求 Ready Session Meta */
export function requireReadySessionMeta(resolution: AcpSessionResolution): SessionAcpMeta {
  if (resolution.kind !== "ready") {
    throw resolveAcpSessionResolutionError(resolution);
  }
  return resolution.meta;
}

/** 解析 ACP Session Resolution 错误 */
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

/** 解析缺失的 Meta 错误 */
export function resolveMissingMetaError(sessionKey: string): Error {
  return new AcpRuntimeError(
    "ACP_SESSION_INIT_FAILED",
    `ACP session metadata not found for ${sessionKey}`,
  );
}

/** 检查是否有 Legacy ACP Identity Projection */
export function hasLegacyAcpIdentityProjection(_meta: SessionAcpMeta): boolean {
  // 检查是否需要迁移旧的 identity 格式
  return false;
}

/** 创建不支持的 Control 错误 */
export { createUnsupportedControlError } from "../runtime/errors.js";

/** 标准化文本 */
export { normalizeText } from "./runtime-options.js";