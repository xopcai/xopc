import { randomUUID } from 'node:crypto';
import { validateConversationId } from '@xopcai/gateway-contract';

import type { Config } from '../config/schema.js';
import {
  listAgentEntries,
  resolveAgentIdByWorkspacePath,
  resolveDefaultAgentId,
} from '../agent/agent-scope.js';
import {
  normalizeAgentId,
} from './agent-session-key.js';

function agentExists(cfg: Config, agentId: string): boolean {
  const id = normalizeAgentId(agentId);
  return listAgentEntries(cfg).some(
    (entry) => entry.enabled !== false && normalizeAgentId(entry.id) === id,
  );
}

export function resolveDefaultTuiAgentId(cfg: Config): string {
  const configured = cfg.tui?.defaultAgent?.trim();
  if (configured && agentExists(cfg, configured)) {
    return normalizeAgentId(configured);
  }
  return resolveDefaultAgentId(cfg);
}

export function resolveTuiConversationId(params: {
  raw?: string;
}): string {
  return validateConversationId(params.raw?.trim() || randomUUID());
}

export function resolveInitialTuiAgentId(params: {
  cfg: Config;
  fallbackAgentId: string;
  explicitAgentId?: string;
  cwd?: string;
}): string {
  if (params.explicitAgentId?.trim()) {
    return normalizeAgentId(params.explicitAgentId);
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

/** Resolve TUI startup conversation identity and initial agent from CLI options and config. */
export function resolveTuiStartupConversationId(params: {
  cfg: Config;
  sessionOption?: string;
  agentOption?: string;
  cwd?: string;
  createId?: () => string;
}): { conversationId: string; agentId: string } {
  const sessionOption = (params.sessionOption ?? '').trim();
  const agentId = resolveInitialTuiAgentId({
    cfg: params.cfg,
    fallbackAgentId: resolveDefaultTuiAgentId(params.cfg),
    explicitAgentId: params.agentOption,
    cwd: params.cwd ?? process.cwd(),
  });
  const conversationId = resolveTuiConversationId({
    raw: sessionOption || (params.createId ?? randomUUID)(),
  });
  return { conversationId, agentId };
}
