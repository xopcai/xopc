/**
 * ACP Identity Reconciliation
 * 
 * Handles reconciliation of pending session identities at startup.
 * Based on OpenClaw's ACP implementation.
 */

import { createLogger } from '../../utils/logger.js';
import type { Config } from '../../config/schema.js';
import { AcpRuntimeError, withAcpRuntimeErrorBoundary } from '../runtime/errors.js';
import {
  createIdentityFromStatus,
  identityEquals,
  mergeSessionIdentity,
  resolveRuntimeHandleIdentifiersFromIdentity,
  resolveSessionIdentityFromMeta,
} from '../runtime/session-identity.js';
import type { AcpRuntime, AcpRuntimeHandle, AcpRuntimeStatus, SessionAcpMeta } from '../runtime/types.js';
import type { SessionEntry } from './manager.types.js';
import { hasLegacyAcpIdentityProjection } from './manager.utils.js';
import type { CachedRuntimeState } from './runtime-cache.js';

const log = createLogger('AcpIdentityReconcile');

export interface ReconcileParams {
  cfg: Config;
  sessionKey: string;
  runtime: AcpRuntime;
  handle: AcpRuntimeHandle;
  meta: SessionAcpMeta;
  runtimeStatus?: AcpRuntimeStatus;
  failOnStatusError: boolean;
  setCachedHandle: (sessionKey: string, handle: AcpRuntimeHandle) => void;
  writeSessionMeta: (params: {
    cfg: Config;
    sessionKey: string;
    mutate: (
      current: SessionAcpMeta | undefined,
      entry: SessionEntry | undefined,
    ) => SessionAcpMeta | null | undefined;
    failOnError?: boolean;
  }) => Promise<SessionEntry | null>;
}

export interface ReconcileResult {
  handle: AcpRuntimeHandle;
  meta: SessionAcpMeta;
  runtimeStatus?: AcpRuntimeStatus;
}

/**
 * Reconcile runtime session identifiers from status
 * 
 * This function is called to refresh session identity from runtime status,
 * useful when starting up with pending identities that need to be resolved.
 */
export async function reconcileRuntimeSessionIdentifiers(
  params: ReconcileParams,
): Promise<ReconcileResult> {
  let runtimeStatus = params.runtimeStatus;
  
  // Try to get status if not provided
  if (!runtimeStatus && params.runtime.getStatus) {
    try {
      runtimeStatus = await withAcpRuntimeErrorBoundary({
        run: async () =>
          await params.runtime.getStatus!({
            handle: params.handle,
          }),
        fallbackCode: "ACP_TURN_FAILED",
        fallbackMessage: "Could not read ACP runtime status.",
      });
    } catch (error) {
      if (params.failOnStatusError) {
        throw error;
      }
      log.warn(
        { sessionKey: params.sessionKey, error },
        "Failed to refresh ACP runtime status during reconciliation",
      );
      return {
        handle: params.handle,
        meta: params.meta,
        runtimeStatus,
      };
    }
  }

  const now = Date.now();
  const currentIdentity = resolveSessionIdentityFromMeta(params.meta);
  
  // Create new identity from status
  const incomingIdentity = createIdentityFromStatus({
    status: runtimeStatus,
    now,
  });
  
  // Merge with current identity
  const nextIdentity = mergeSessionIdentity({
    current: currentIdentity,
    incoming: incomingIdentity,
    now,
  }) ?? currentIdentity;
  
  // Resolve handle identifiers from identity
  const handleIdentifiers = resolveRuntimeHandleIdentifiersFromIdentity(nextIdentity);
  
  // Check if handle needs updating
  const handleChanged =
    handleIdentifiers.backendSessionId !== params.handle.backendSessionId ||
    handleIdentifiers.agentSessionId !== params.handle.agentSessionId;
    
  const nextHandle: AcpRuntimeHandle = handleChanged
    ? {
        ...params.handle,
        ...(handleIdentifiers.backendSessionId
          ? { backendSessionId: handleIdentifiers.backendSessionId }
          : {}),
        ...(handleIdentifiers.agentSessionId
          ? { agentSessionId: handleIdentifiers.agentSessionId }
          : {}),
      }
    : params.handle;
      
  if (handleChanged) {
    params.setCachedHandle(params.sessionKey, nextHandle);
  }

  // Check if metadata needs updating
  const metaChanged =
    !identityEquals(currentIdentity, nextIdentity) || hasLegacyAcpIdentityProjection(params.meta);
    
  if (!metaChanged) {
    return {
      handle: nextHandle,
      meta: params.meta,
      runtimeStatus,
    };
  }

  // Build next metadata
  const nextMeta: SessionAcpMeta = {
    backend: params.meta.backend,
    agent: params.meta.agent,
    runtimeSessionName: params.meta.runtimeSessionName,
    ...(nextIdentity ? { identity: nextIdentity } : {}),
    mode: params.meta.mode,
    ...(params.meta.runtimeOptions ? { runtimeOptions: params.meta.runtimeOptions } : {}),
    ...(params.meta.cwd ? { cwd: params.meta.cwd } : {}),
    lastActivityAt: now,
    state: params.meta.state,
    ...(params.meta.lastError ? { lastError: params.meta.lastError } : {}),
  };

  // Log identity changes
  if (!identityEquals(currentIdentity, nextIdentity)) {
    const currentAgentSessionId = currentIdentity?.agentSessionId ?? "<none>";
    const nextAgentSessionId = nextIdentity?.agentSessionId ?? "<none>";
    const currentAcpxSessionId = currentIdentity?.acpxSessionId ?? "<none>";
    const nextAcpxSessionId = nextIdentity?.acpxSessionId ?? "<none>";
    const currentAcpxRecordId = currentIdentity?.acpxRecordId ?? "<none>";
    const nextAcpxRecordId = nextIdentity?.acpxRecordId ?? "<none>";
    
    log.info(
      {
        sessionKey: params.sessionKey,
        changes: {
          agentSessionId: { from: currentAgentSessionId, to: nextAgentSessionId },
          acpxSessionId: { from: currentAcpxSessionId, to: nextAcpxSessionId },
          acpxRecordId: { from: currentAcpxRecordId, to: nextAcpxRecordId },
        },
      },
      "Session identity updated during reconciliation",
    );
  }

  // Persist updated metadata
  await params.writeSessionMeta({
    cfg: params.cfg,
    sessionKey: params.sessionKey,
    mutate: (current, entry) => {
      if (!entry) {
        return null;
      }
      const base = current ?? entry.acp;
      if (!base) {
        return null;
      }
      return {
        backend: base.backend,
        agent: base.agent,
        runtimeSessionName: base.runtimeSessionName,
        ...(nextIdentity ? { identity: nextIdentity } : {}),
        mode: base.mode,
        ...(base.runtimeOptions ? { runtimeOptions: base.runtimeOptions } : {}),
        ...(base.cwd ? { cwd: base.cwd } : {}),
        state: base.state,
        lastActivityAt: now,
        ...(base.lastError ? { lastError: base.lastError } : {}),
      };
    },
  });

  return {
    handle: nextHandle,
    meta: nextMeta,
    runtimeStatus,
  };
}
