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
    name?: string;
    description?: string;
    workspace?: string;
    agentDir?: string;
    model?: string;
  },
): Config {
  const agentId = normalizeAgentId(params.agentId);
  const name = params.name?.trim();
  const list = listAgentEntries(cfg);
  const index = findAgentEntryIndex(list, agentId);
  const base = index >= 0 ? list[index] : { id: agentId, enabled: true as const };
  const nextEntry: AgentEntry = {
    ...base,
    enabled: base.enabled ?? true,
    ...(name ? { name } : {}),
    ...(params.description?.trim() ? { description: params.description.trim() } : {}),
    ...(params.workspace ? { workspace: params.workspace } : {}),
    ...(params.agentDir ? { agentDir: params.agentDir } : {}),
    ...(params.model ? { model: params.model } : {}),
  };
  const nextList = [...list];
  if (index >= 0) {
    nextList[index] = nextEntry;
  } else {
    if (nextList.length === 0 && agentId !== normalizeAgentId(resolveDefaultAgentId(cfg))) {
      nextList.push({ id: resolveDefaultAgentId(cfg), enabled: true });
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

export function pruneAgentConfig(
  cfg: Config,
  agentId: string,
): { config: Config; removedBindings: number } {
  const id = normalizeAgentId(agentId);
  const agents = listAgentEntries(cfg);
  const nextAgentsList = agents.filter((e) => normalizeAgentId(e.id) !== id);
  const nextAgents = nextAgentsList.length > 0 ? nextAgentsList : undefined;

  const bindings = cfg.bindings ?? [];
  const filteredBindings = bindings.filter((b) => normalizeAgentId(b.agentId) !== id);

  return {
    config: {
      ...cfg,
      agents: nextAgents ? { ...cfg.agents, list: nextAgents } : { ...cfg.agents, list: undefined },
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
