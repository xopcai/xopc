import { randomUUID } from 'node:crypto';
import { validateConversationId } from '@xopcai/gateway-contract';

import { AgentCatalogRepository } from '../agent-catalog/repository.js';
import {
  listAgentEntries,
  resolveAgentIdByWorkspacePath,
  resolveDefaultAgentId,
} from '../agent/agent-scope.js';
import {
  normalizeAgentId,
} from './agent-session-key.js';

function agentExists(agentId: string): boolean {
  const id = normalizeAgentId(agentId);
  return listAgentEntries().some(
    (entry) => entry.enabled !== false && normalizeAgentId(entry.id) === id,
  );
}

export function resolveDefaultTuiAgentId(): string {
  const configured = new AgentCatalogRepository().snapshot().surfaceDefaults.tui?.trim();
  if (configured && agentExists(configured)) {
    return normalizeAgentId(configured);
  }
  return resolveDefaultAgentId();
}

export function resolveTuiConversationId(params: {
  raw?: string;
}): string {
  return validateConversationId(params.raw?.trim() || randomUUID());
}

export function resolveInitialTuiAgentId(params: {
  fallbackAgentId: string;
  explicitAgentId?: string;
  cwd?: string;
}): string {
  if (params.explicitAgentId?.trim()) {
    return normalizeAgentId(params.explicitAgentId);
  }

  const inferredFromWorkspace = resolveAgentIdByWorkspacePath(
    params.cwd ?? process.cwd(),
  );
  if (inferredFromWorkspace) {
    return inferredFromWorkspace;
  }

  return normalizeAgentId(params.fallbackAgentId);
}

/** Resolve TUI startup conversation identity and initial agent from CLI options and config. */
export function resolveTuiStartupConversationId(params: {
  sessionOption?: string;
  agentOption?: string;
  cwd?: string;
  createId?: () => string;
}): { conversationId: string; agentId: string } {
  const sessionOption = (params.sessionOption ?? '').trim();
  const agentId = resolveInitialTuiAgentId({
    fallbackAgentId: resolveDefaultTuiAgentId(),
    explicitAgentId: params.agentOption,
    cwd: params.cwd ?? process.cwd(),
  });
  const conversationId = resolveTuiConversationId({
    raw: sessionOption || (params.createId ?? randomUUID)(),
  });
  return { conversationId, agentId };
}
