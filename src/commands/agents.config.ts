/**
 * Mutate `agents.list` / bindings when adding or removing agents.
 */

import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import type { Config } from '../config/schema.js';
import {
  listAgentEntries,
  normalizeAgentId,
  resolveAgentHomeDir,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
  DEFAULT_AGENT_ID,
} from '../agent/agent-scope.js';

type AgentEntry = NonNullable<NonNullable<Config['agents']>['list']>[number];

export { listAgentEntries };

export function findAgentEntryIndex(list: AgentEntry[], agentId: string): number {
  const id = normalizeAgentId(agentId);
  return list.findIndex((e) => normalizeAgentId(e.id) === id);
}

export function applyAgentConfig(
  cfg: Config,
  params: {
    agentId: string;
    /** Used only when creating a previously absent agent entry. */
    identity?: AgentEntry['identity'];
    workspace?: string;
    model?: string;
    models?: AgentEntry['models'];
    skills?: string[];
    tools?: AgentEntry['tools'];
  },
): Config {
  const agentId = normalizeAgentId(params.agentId);
  const list = listAgentEntries(cfg);
  const index = findAgentEntryIndex(list, agentId);
  const nextTools = params.tools;
  const base = index >= 0 ? list[index] : {
    id: agentId,
    enabled: true as const,
    identity: params.identity ?? { name: agentId, role: 'Agent', language: 'en', tone: 'direct' },
    responsibilities: { primary: ['Help the user complete tasks'] },
    workspace: { root: `~/.xopc/workspace/${agentId}` },
    tools: { builtin: {} },
    skills: { mode: 'all' as const },
    memory: { mode: 'confirmWrite' as const, sources: ['session' as const, 'curated' as const], writePolicy: { curated: 'confirm' as const } },
    workflows: {},
    boundaries: { requiresConfirmation: [], forbidden: [], escalation: [] },
  };
  const nextEntry: AgentEntry = {
    ...base,
    enabled: base.enabled ?? true,
    ...(params.workspace ? { workspace: { root: params.workspace } } : {}),
    ...(params.models ? { models: params.models } : {}),
    ...(params.model
      ? {
          models: {
            ...(base.models ?? {}),
            defaultRole: 'deep',
            roles: { ...(base.models?.roles ?? {}), deep: { model: params.model } },
          },
        }
      : {}),
    ...(params.skills ? { skills: { mode: 'allowlist' as const, allow: params.skills } } : {}),
    ...(nextTools ? { tools: nextTools } : {}),
  };
  const nextList = [...list];
  if (index >= 0) {
    nextList[index] = nextEntry;
  } else {
    if (nextList.length === 0 && agentId !== normalizeAgentId(resolveDefaultAgentId(cfg))) {
      nextList.push({
        id: resolveDefaultAgentId(cfg),
        enabled: true,
        identity: { name: resolveDefaultAgentId(cfg), role: 'Agent', language: 'en', tone: 'direct' },
        responsibilities: { primary: ['Help the user complete tasks'] },
        workspace: { root: `~/.xopc/workspace/${resolveDefaultAgentId(cfg)}` },
        tools: { builtin: {} },
        skills: { mode: 'all' },
        memory: { mode: 'confirmWrite', sources: ['session', 'curated'], writePolicy: { curated: 'confirm' } },
        workflows: {},
        boundaries: { requiresConfirmation: [], forbidden: [], escalation: [] },
      });
    }
    nextList.push(nextEntry);
  }
  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      list: nextList,
    },
  };
}

export function getAgentDeleteBlocker(cfg: Config, agentId: string): string | null {
  const id = normalizeAgentId(agentId);
  if (id === DEFAULT_AGENT_ID) {
    return `Agent id "${DEFAULT_AGENT_ID}" is reserved for the primary agent.`;
  }
  if (id === normalizeAgentId(resolveDefaultAgentId(cfg))) {
    return `Agent "${id}" is the global default agent. Change agents.default first.`;
  }
  const tuiDefault = cfg.tui?.defaultAgent?.trim();
  if (tuiDefault && id === normalizeAgentId(tuiDefault)) {
    return `Agent "${id}" is the TUI default agent. Change tui.defaultAgent first.`;
  }
  return null;
}

export function setTuiDefaultAgentConfig(
  cfg: Config,
  agentIdRaw: string,
): { ok: true; config: Config; agentId: string } | { ok: false; message: string } {
  const raw = agentIdRaw.trim();
  if (!raw) {
    return { ok: false, message: 'Agent id is required.' };
  }
  const agentId = normalizeAgentId(raw);
  if (agentId !== raw.toLowerCase()) {
    return { ok: false, message: `Invalid agent id: ${raw}` };
  }
  const entry = listAgentEntries(cfg).find((agent) => normalizeAgentId(agent.id) === agentId);
  if (!entry || entry.enabled === false) {
    return { ok: false, message: `Agent "${agentId}" not found or disabled.` };
  }
  return {
    ok: true,
    agentId,
    config: {
      ...cfg,
      tui: {
        ...cfg.tui,
        defaultAgent: agentId,
      },
    },
  };
}

export function pruneAgentConfig(
  cfg: Config,
  agentId: string,
): { config: Config; removedBindings: number } {
  const id = normalizeAgentId(agentId);
  const blocker = getAgentDeleteBlocker(cfg, id);
  if (blocker) {
    throw new Error(blocker);
  }
  const agents = listAgentEntries(cfg);
  const nextAgentsList = agents.filter((e) => normalizeAgentId(e.id) !== id);
  const nextAgents = nextAgentsList.length > 0 ? nextAgentsList : [];

  const bindings = cfg.bindings ?? [];
  const filteredBindings = bindings.filter((b) => normalizeAgentId(b.agentId) !== id);

  return {
    config: {
      ...cfg,
      agents: { ...cfg.agents, list: nextAgents },
      bindings: filteredBindings,
    },
    removedBindings: bindings.length - filteredBindings.length,
  };
}

export async function removeAgentDirsFromDisk(cfg: Config, id: string): Promise<void> {
  const aid = normalizeAgentId(id);
  if (aid === DEFAULT_AGENT_ID) {
    throw new Error('Refusing to delete the main agent home on disk from this command.');
  }
  const home = resolveAgentHomeDir(cfg, aid);
  const ws = resolveAgentWorkspaceDir(cfg, aid);
  if (existsSync(home)) {
    await rm(home, { recursive: true, force: true });
  }
  if (existsSync(ws) && ws !== home) {
    await rm(ws, { recursive: true, force: true });
  }
}
