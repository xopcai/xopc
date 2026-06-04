import type { Config } from '../config/schema.js';
import {
  resolveAgentIdByWorkspacePath,
  resolveDefaultAgentId,
} from '../agent/agent-scope.js';
import {
  buildAgentMainSessionKey,
  normalizeAgentId,
  normalizeMainKey,
  parseAgentSessionKey,
} from './agent-session-key.js';
import { normalizeLowercaseStringOrEmpty } from '../utils/string-coerce.js';

export type SessionScope = 'per-sender' | 'global';

export function resolveTuiSessionKey(params: {
  raw?: string;
  sessionScope: SessionScope;
  currentAgentId: string;
  sessionMainKey: string;
}): string {
  const trimmed = (params.raw ?? '').trim();
  if (!trimmed) {
    if (params.sessionScope === 'global') {
      return 'global';
    }
    return buildAgentMainSessionKey({
      agentId: params.currentAgentId,
      mainKey: params.sessionMainKey,
    });
  }
  if (trimmed === 'global' || trimmed === 'unknown') {
    return trimmed;
  }
  if (trimmed.startsWith('agent:')) {
    return normalizeLowercaseStringOrEmpty(trimmed);
  }
  return `agent:${params.currentAgentId}:${normalizeLowercaseStringOrEmpty(trimmed)}`;
}

export function resolveInitialTuiAgentId(params: {
  cfg: Config;
  fallbackAgentId: string;
  initialSessionInput?: string;
  cwd?: string;
}): string {
  const parsed = parseAgentSessionKey((params.initialSessionInput ?? '').trim());
  if (parsed?.agentId) {
    return normalizeAgentId(parsed.agentId);
  }

  const inferredFromWorkspace = resolveAgentIdByWorkspacePath(
    params.cfg,
    params.cwd ?? process.cwd(),
  );
  if (inferredFromWorkspace) {
    return inferredFromWorkspace;
  }

  return normalizeAgentId(params.fallbackAgentId);
}

/** Resolve TUI startup session key from CLI options and config. */
export function resolveTuiStartupSessionKey(params: {
  cfg: Config;
  sessionOption?: string;
  cwd?: string;
}): { sessionKey: string; agentId: string; sessionScope: SessionScope; sessionMainKey: string } {
  const sessionScope = (params.cfg.session?.scope ?? 'per-sender') as SessionScope;
  const sessionMainKey = normalizeMainKey(params.cfg.session?.mainKey);
  const agentId = resolveInitialTuiAgentId({
    cfg: params.cfg,
    fallbackAgentId: resolveDefaultAgentId(params.cfg),
    initialSessionInput: (params.sessionOption ?? '').trim(),
    cwd: params.cwd ?? process.cwd(),
  });
  const sessionKey = resolveTuiSessionKey({
    raw: params.sessionOption,
    sessionScope,
    currentAgentId: agentId,
    sessionMainKey,
  });
  return { sessionKey, agentId, sessionScope, sessionMainKey };
}
