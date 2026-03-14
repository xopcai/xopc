/**
 * ACP Session Identity
 * 
 * Session identity management for ACP runtime.
 */

import type { AcpRuntimeHandle, SessionIdentity, SessionAcpMeta } from "./types.js";

/** 从 Ensure 结果创建身份 */
export function createIdentityFromEnsure(params: {
  handle: AcpRuntimeHandle;
  now: number;
}): SessionIdentity {
  const { handle, now } = params;
  const backendSessionId = handle.backendSessionId?.trim();
  const agentSessionId = handle.agentSessionId?.trim();
  
  if (backendSessionId || agentSessionId) {
    return {
      state: "resolved",
      source: "ensure",
      ...(backendSessionId ? { backendSessionId } : {}),
      ...(agentSessionId ? { agentSessionId } : {}),
      lastUpdatedAt: now,
    };
  }
  
  return {
    state: "pending",
    source: "ensure",
    lastUpdatedAt: now,
  };
}

/** 合并 Session 身份 */
export function mergeSessionIdentity(params: {
  current: SessionIdentity | undefined;
  incoming: SessionIdentity | undefined;
  now: number;
}): SessionIdentity | undefined {
  const { current, incoming, now } = params;
  
  if (!incoming) {
    return current;
  }
  
  if (!current) {
    return incoming;
  }
  
  // 如果 incoming 是 resolved，使用它
  if (incoming.state === "resolved") {
    return {
      ...incoming,
      lastUpdatedAt: now,
    };
  }
  
  // 如果 incoming 是 pending，保留 current 的 resolved 状态
  if (current.state === "resolved") {
    return {
      ...current,
      lastUpdatedAt: now,
    };
  }
  
  // 两个都是 pending
  return {
    state: "pending",
    source: incoming.source || current.source,
    lastUpdatedAt: now,
  };
}

/** 检查身份是否相等 */
export function identityEquals(
  a: SessionIdentity | undefined,
  b: SessionIdentity | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  
  return (
    a.state === b.state &&
    a.backendSessionId === b.backendSessionId &&
    a.agentSessionId === b.agentSessionId
  );
}

/** 检查 Session 身份是否为 pending */
export function isSessionIdentityPending(identity: SessionIdentity | undefined): boolean {
  return identity?.state === "pending";
}

/** 从元数据解析 Session 身份 */
export function resolveSessionIdentityFromMeta(meta: SessionAcpMeta): SessionIdentity | undefined {
  return meta.identity;
}

/** 从身份解析 Runtime Handle 标识符 */
export function resolveRuntimeHandleIdentifiersFromIdentity(identity: SessionIdentity | undefined): {
  backendSessionId?: string;
  agentSessionId?: string;
} {
  if (!identity) {
    return {};
  }
  return {
    ...(identity.backendSessionId ? { backendSessionId: identity.backendSessionId } : {}),
    ...(identity.agentSessionId ? { agentSessionId: identity.agentSessionId } : {}),
  };
}