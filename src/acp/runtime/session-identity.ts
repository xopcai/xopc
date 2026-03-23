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

/** Normalize string text */
function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

/** Normalize identity source */
function normalizeIdentitySource(value: unknown): SessionIdentitySource | undefined {
  if (value !== "ensure" && value !== "status" && value !== "event") {
    return undefined;
  }
  return value;
}

/** Normalize identity state */
function normalizeIdentityState(value: unknown): "resolved" | "pending" | undefined {
  if (value !== "resolved" && value !== "pending") {
    return undefined;
  }
  return value;
}

/** Normalize identity object */
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

/** Build identity from ensure handle */
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

/** Build identity from runtime status */
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

/** Merge two identity snapshots */
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

/** Whether identity has a stable session id */
export function identityHasStableSessionId(identity: SessionIdentity | undefined): boolean {
  const normalized = normalizeIdentity(identity);
  return Boolean(normalized?.acpxSessionId || normalized?.agentSessionId);
}

/** Equality for normalized identities */
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

/** Whether identity is missing or pending */
export function isSessionIdentityPending(identity: SessionIdentity | undefined): boolean {
  const normalized = normalizeIdentity(identity);
  if (!normalized) {
    return true;
  }
  return normalized.state === "pending";
}

/** Read identity from session meta */
export function resolveSessionIdentityFromMeta(meta: SessionAcpMeta | undefined): SessionIdentity | undefined {
  if (!meta) {
    return undefined;
  }
  return normalizeIdentity(meta.identity);
}

/** Map identity to backend/agent session ids for handles */
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
