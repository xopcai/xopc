import type { SessionInfo } from '@/features/chat/chat.types';
import type { SessionInitialAgentConfig } from '@xopcai/gateway-contract';
import {
  pickReusableEmptyShell,
  isReusableEmptyShell,
} from '@/features/chat/session/reusable-empty-shell';
import { readWebchatEmptyShellCache } from '@/features/chat/session/webchat-empty-shell-cache';
import type { SessionManager } from '@/features/chat/session/session-manager';
import { normalizeAgentId } from '@/lib/agent-id';

export type NewChatResolution =
  | { kind: 'noop'; sessionKey: string }
  | { kind: 'reuse'; sessionKey: string; session: SessionInfo }
  | { kind: 'create'; sessionKey: string; session: SessionInfo };

function findSessionRow(sessions: SessionInfo[], key: string): SessionInfo | undefined {
  const k = key.trim();
  return sessions.find((s) => s.key.trim() === k);
}

function mergeOptimisticEmptyShells(
  server: SessionInfo[],
  cached: SessionInfo[] | null,
  agentId: string,
  projectId?: string | null,
): SessionInfo[] {
  if (!cached?.length) return server;
  const byKey = new Map(server.map((s) => [s.key.trim(), s]));
  for (const row of cached) {
    const key = row.key.trim();
    if (!key || byKey.has(key)) continue;
    if (!isReusableEmptyShell(row, { agentId, projectId })) continue;
    byKey.set(key, row);
  }
  return [...byKey.values()].toSorted(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

async function loadAllWebchatSessions(
  sessionMgr: SessionManager,
  agentId: string,
  projectId?: string | null,
): Promise<SessionInfo[]> {
  const cached = readWebchatEmptyShellCache();
  try {
    const server = await sessionMgr.loadSessions();
    return mergeOptimisticEmptyShells(server, cached, agentId, projectId);
  } catch {
    return cached?.filter((row) => isReusableEmptyShell(row, { agentId, projectId })) ?? [];
  }
}

export async function resolveNewChatTarget(opts: {
  sessionMgr: SessionManager;
  agentId: string;
  projectId?: string | null;
  currentSessionKey?: string | null;
  forceNew?: boolean;
  temporary?: boolean;
  initialAgentConfig?: SessionInitialAgentConfig;
}): Promise<NewChatResolution> {
  const agentId = normalizeAgentId(opts.agentId);
  const projectId = opts.projectId?.trim() || undefined;
  const current = opts.currentSessionKey?.trim() || null;

  if (opts.forceNew || opts.temporary) {
    const session = await opts.sessionMgr.createSession({
      agentId,
      ...(projectId ? { projectId } : {}),
      ...(opts.temporary ? { temporary: true } : {}),
      ...(opts.initialAgentConfig ? { initialAgentConfig: opts.initialAgentConfig } : {}),
    });
    return { kind: 'create', sessionKey: session.key, session };
  }

  const sessions = await loadAllWebchatSessions(opts.sessionMgr, agentId, projectId);

  if (current) {
    const row = findSessionRow(sessions, current);
    if (row && isReusableEmptyShell(row, { agentId, projectId })) {
      return { kind: 'noop', sessionKey: current };
    }
  }

  const reusable = pickReusableEmptyShell(sessions, { agentId, projectId });
  if (reusable && reusable.key.trim() !== current) {
    return { kind: 'reuse', sessionKey: reusable.key, session: reusable };
  }

  const session = await opts.sessionMgr.createSession({
    agentId,
    projectId,
    ...(opts.initialAgentConfig ? { initialAgentConfig: opts.initialAgentConfig } : {}),
  });
  return { kind: 'create', sessionKey: session.key, session };
}
