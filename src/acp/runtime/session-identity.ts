/**
 * ACP Session Identity
 * 
 * Session identity management for ACP runtime.
 */

import type {
  AcpRuntimeHandle,
  AcpRuntimeStatus,
  SessionIdentity,
  SessionIdentitySource,
  SessionAcpMeta,
} from "./types.js";

/** 标准化文本值 */
function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

/** 标准化身份来源 */
function normalizeIdentitySource(value: unknown): SessionIdentitySource | undefined {
  if (value !== "ensure" && value !== "status" && value !== "event") {
    return undefined;
  }
  return value;
}

/** 标准化身份状态 */
function normalizeIdentityState(value: unknown): "resolved" | "pending" | undefined {
  if (value !== "resolved" && value !== "pending") {
    return undefined;
  }
  return value;
}

/** 标准化身份对象 */
function normalizeIdentity(identity: SessionIdentity | undefined): SessionIdentity | undefined {
  if (!identity) {
    return undefined;
  }

  const state = normalizeIdentityState(identity.state);
  const source = normalizeIdentitySource(identity.source);
  const acpxRecordId = normalizeText(identity.acpxRecordId);
  const acpxSessionId = normalizeText(identity.acpxSessionId);
  const agentSessionId = normalizeText(identity.agentSessionId);
  const lastUpdatedAt =
    typeof identity.lastUpdatedAt === "number" && Number.isFinite(identity.lastUpdatedAt)
      ? identity.lastUpdatedAt
      : undefined;

  const hasAnyId = Boolean(acpxRecordId || acpxSessionId || agentSessionId);
  if (!state && !source && !hasAnyId && lastUpdatedAt === undefined) {
    return undefined;
  }

  // 如果有 acpxSessionId 或 agentSessionId，则认为已 resolved
  const resolved = Boolean(acpxSessionId || agentSessionId);
  const normalizedState = state ?? (resolved ? "resolved" : "pending");

  return {
    state: normalizedState,
    ...(acpxRecordId ? { acpxRecordId } : {}),
    ...(acpxSessionId ? { acpxSessionId } : {}),
    ...(agentSessionId ? { agentSessionId } : {}),
    source: source ?? "status",
    lastUpdatedAt: lastUpdatedAt ?? Date.now(),
  };
}

/** 从 Ensure 结果创建身份 */
export function createIdentityFromEnsure(params: {
  handle: AcpRuntimeHandle;
  now: number;
}): SessionIdentity | undefined {
  const { handle, now } = params;
  
  const acpxRecordId = normalizeText(handle.acpxRecordId);
  const acpxSessionId = normalizeText(handle.backendSessionId);
  const agentSessionId = normalizeText(handle.agentSessionId);

  if (!acpxRecordId && !acpxSessionId && !agentSessionId) {
    return undefined;
  }

  // 如果有 acpxSessionId 或 agentSessionId，则为 resolved
  const resolved = Boolean(acpxSessionId || agentSessionId);

  return {
    state: resolved ? "resolved" : "pending",
    ...(acpxRecordId ? { acpxRecordId } : {}),
    ...(acpxSessionId ? { acpxSessionId } : {}),
    ...(agentSessionId ? { agentSessionId } : {}),
    source: "ensure",
    lastUpdatedAt: now,
  };
}

/** 从 Status 结果创建身份 */
export function createIdentityFromStatus(params: {
  status: AcpRuntimeStatus | undefined;
  now: number;
}): SessionIdentity | undefined {
  if (!params.status) {
    return undefined;
  }

  const details = params.status.details;
  
  const acpxRecordId =
    normalizeText(params.status.acpxRecordId) ??
    normalizeText(details?.acpxRecordId);
  const acpxSessionId =
    normalizeText(params.status.backendSessionId) ??
    normalizeText(details?.backendSessionId) ??
    normalizeText(details?.acpxSessionId);
  const agentSessionId =
    normalizeText(params.status.agentSessionId) ??
    normalizeText(details?.agentSessionId);

  if (!acpxRecordId && !acpxSessionId && !agentSessionId) {
    return undefined;
  }

  const resolved = Boolean(acpxSessionId || agentSessionId);

  return {
    state: resolved ? "resolved" : "pending",
    ...(acpxRecordId ? { acpxRecordId } : {}),
    ...(acpxSessionId ? { acpxSessionId } : {}),
    ...(agentSessionId ? { agentSessionId } : {}),
    source: "status",
    lastUpdatedAt: params.now,
  };
}

/** 合并 Session 身份 */
export function mergeSessionIdentity(params: {
  current: SessionIdentity | undefined;
  incoming: SessionIdentity | undefined;
  now: number;
}): SessionIdentity | undefined {
  const current = normalizeIdentity(params.current);
  const incoming = normalizeIdentity(params.incoming);

  if (!current) {
    if (!incoming) {
      return undefined;
    }
    return { ...incoming, lastUpdatedAt: params.now };
  }

  if (!incoming) {
    return current;
  }

  const currentResolved = current.state === "resolved";
  const incomingResolved = incoming.state === "resolved";
  
  // 如果 incoming 是 resolved，使用 incoming 的值
  // 如果 current 是 resolved，保留 current 的 resolved 状态
  const allowIncomingValue = !currentResolved || incomingResolved;
  
  const nextAcpxRecordId =
    allowIncomingValue && incoming.acpxRecordId ? incoming.acpxRecordId : current.acpxRecordId;
  const nextAcpxSessionId =
    allowIncomingValue && incoming.acpxSessionId ? incoming.acpxSessionId : current.acpxSessionId;
  const nextAgentSessionId =
    allowIncomingValue && incoming.agentSessionId ? incoming.agentSessionId : current.agentSessionId;

  const nextResolved = Boolean(nextAcpxSessionId || nextAgentSessionId);
  const nextState: SessionIdentity["state"] = nextResolved
    ? "resolved"
    : currentResolved
      ? "resolved"
      : incoming.state;
      
  const nextSource = allowIncomingValue ? incoming.source : current.source;

  const next: SessionIdentity = {
    state: nextState,
    ...(nextAcpxRecordId ? { acpxRecordId: nextAcpxRecordId } : {}),
    ...(nextAcpxSessionId ? { acpxSessionId: nextAcpxSessionId } : {}),
    ...(nextAgentSessionId ? { agentSessionId: nextAgentSessionId } : {}),
    source: nextSource,
    lastUpdatedAt: params.now,
  };

  return next;
}

/** 检查身份是否有稳定的 session ID */
export function identityHasStableSessionId(identity: SessionIdentity | undefined): boolean {
  const normalized = normalizeIdentity(identity);
  return Boolean(normalized?.acpxSessionId || normalized?.agentSessionId);
}

/** 检查身份是否相等 */
export function identityEquals(
  a: SessionIdentity | undefined,
  b: SessionIdentity | undefined,
): boolean {
  const normalizedA = normalizeIdentity(a);
  const normalizedB = normalizeIdentity(b);

  if (!normalizedA && !normalizedB) {
    return true;
  }
  if (!normalizedA || !normalizedB) {
    return false;
  }

  return (
    normalizedA.state === normalizedB.state &&
    normalizedA.acpxRecordId === normalizedB.acpxRecordId &&
    normalizedA.acpxSessionId === normalizedB.acpxSessionId &&
    normalizedA.agentSessionId === normalizedB.agentSessionId &&
    normalizedA.source === normalizedB.source
  );
}

/** 检查 Session 身份是否为 pending */
export function isSessionIdentityPending(identity: SessionIdentity | undefined): boolean {
  const normalized = normalizeIdentity(identity);
  if (!normalized) {
    return true;
  }
  return normalized.state === "pending";
}

/** 从元数据解析 Session 身份 */
export function resolveSessionIdentityFromMeta(meta: SessionAcpMeta | undefined): SessionIdentity | undefined {
  if (!meta) {
    return undefined;
  }
  return normalizeIdentity(meta.identity);
}

/** 从身份解析 Runtime Handle 标识符 */
export function resolveRuntimeHandleIdentifiersFromIdentity(identity: SessionIdentity | undefined): {
  backendSessionId?: string;
  agentSessionId?: string;
} {
  const normalized = normalizeIdentity(identity);
  if (!normalized) {
    return {};
  }
  return {
    ...(normalized.acpxSessionId ? { backendSessionId: normalized.acpxSessionId } : {}),
    ...(normalized.agentSessionId ? { agentSessionId: normalized.agentSessionId } : {}),
  };
}
