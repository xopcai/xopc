import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import type {
  AgentBootstrapFileEntry,
  GatewayAgentRow,
  GatewayAgentsPayload,
  GatewayConfigBinding,
  SkillCatalogRow,
} from './types/agent-gateway';

export type {
  AgentBootstrapFileEntry,
  GatewayAgentRow,
  GatewayAgentsPayload,
  GatewayAgentSkillsInfo,
  GatewayAgentToolsInfo,
  GatewayConfigBinding,
  SkillCatalogRow,
} from './types/agent-gateway';

function normalizeAgentRow(raw: GatewayAgentRow): GatewayAgentRow {
  return {
    ...raw,
    skills: raw.skills ?? { defaults: [] },
    tools: raw.tools ?? { defaultsDisable: [], entryDisable: [], effectiveDisable: [] },
  };
}

export async function fetchGatewayAgents(): Promise<GatewayAgentsPayload> {
  const res = await fetchJson<{ ok?: boolean; payload?: GatewayAgentsPayload }>(apiUrl('/api/agents'));
  const p = res.payload;
  if (!p?.defaultId || !Array.isArray(p.agents)) {
    throw new Error('Invalid /api/agents response');
  }
  const builtinToolIds = Array.isArray(p.builtinToolIds) ? p.builtinToolIds : [];
  return {
    defaultId: p.defaultId,
    agents: p.agents.map(normalizeAgentRow),
    builtinToolIds,
  };
}

export async function createGatewayAgent(body: {
  name: string;
  workspace: string;
  model?: string;
  agentDir?: string;
}): Promise<GatewayAgentsPayload> {
  const res = await fetchJson<{
    ok?: boolean;
    payload?: { agentId?: string; agents: GatewayAgentsPayload };
  }>(apiUrl('/api/agents'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const agents = res.payload?.agents;
  if (!agents?.defaultId || !Array.isArray(agents.agents)) {
    throw new Error('Invalid create agent response');
  }
  return {
    defaultId: agents.defaultId,
    agents: agents.agents.map(normalizeAgentRow),
    builtinToolIds: Array.isArray(agents.builtinToolIds) ? agents.builtinToolIds : [],
  };
}

export async function updateGatewayAgent(
  id: string,
  body: {
    name?: string;
    workspace?: string;
    model?: string | null;
    agentDir?: string | null;
    setDefault?: boolean;
    skills?: string[] | null;
    toolsDisable?: string[] | null;
  },
): Promise<GatewayAgentsPayload> {
  const res = await fetchJson<{ ok?: boolean; payload?: GatewayAgentsPayload }>(
    apiUrl(`/api/agents/${encodeURIComponent(id)}`),
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  const p = res.payload;
  if (!p?.defaultId || !Array.isArray(p.agents)) {
    throw new Error('Invalid update agent response');
  }
  return {
    defaultId: p.defaultId,
    agents: p.agents.map(normalizeAgentRow),
    builtinToolIds: Array.isArray(p.builtinToolIds) ? p.builtinToolIds : [],
  };
}

export async function deleteGatewayAgent(id: string, purge: boolean): Promise<GatewayAgentsPayload> {
  const q = purge ? '?purge=true' : '';
  const res = await fetchJson<{
    ok?: boolean;
    payload?: { agentId?: string; purged?: boolean; agents: GatewayAgentsPayload };
  }>(apiUrl(`/api/agents/${encodeURIComponent(id)}${q}`), { method: 'DELETE' });
  const agents = res.payload?.agents;
  if (!agents?.defaultId || !Array.isArray(agents.agents)) {
    throw new Error('Invalid delete agent response');
  }
  return {
    defaultId: agents.defaultId,
    agents: agents.agents.map(normalizeAgentRow),
    builtinToolIds: Array.isArray(agents.builtinToolIds) ? agents.builtinToolIds : [],
  };
}

export async function fetchGatewayConfigBindings(): Promise<GatewayConfigBinding[]> {
  const res = await fetchJson<{ ok?: boolean; payload?: { config?: { bindings?: unknown } } }>(
    apiUrl('/api/config'),
  );
  const raw = res.payload?.config?.bindings;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw as GatewayConfigBinding[];
}

export async function patchGatewayBindings(bindings: GatewayConfigBinding[]): Promise<void> {
  await fetchJson(apiUrl('/api/config'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bindings }),
  });
}

export async function fetchSkillsCatalog(): Promise<SkillCatalogRow[]> {
  const res = await fetchJson<{
    ok?: boolean;
    payload?: { catalog?: SkillCatalogRow[] };
  }>(apiUrl('/api/skills'));
  const c = res.payload?.catalog;
  return Array.isArray(c) ? c : [];
}

export async function fetchAgentBootstrapFiles(agentId: string): Promise<{
  agentId: string;
  bootstrapDir: string;
  files: AgentBootstrapFileEntry[];
}> {
  const res = await fetchJson<{
    ok?: boolean;
    payload?: { agentId: string; bootstrapDir: string; files: AgentBootstrapFileEntry[] };
  }>(apiUrl(`/api/agents/${encodeURIComponent(agentId)}/files`));
  const p = res.payload;
  if (!p?.files || !p.bootstrapDir) {
    throw new Error('Invalid files list response');
  }
  return p;
}

export async function fetchAgentBootstrapFileContent(
  agentId: string,
  name: string,
): Promise<string> {
  const res = await fetchJson<{ ok?: boolean; payload?: { content?: string } }>(
    apiUrl(`/api/agents/${encodeURIComponent(agentId)}/files/${encodeURIComponent(name)}`),
  );
  const c = res.payload?.content;
  if (typeof c !== 'string') {
    throw new Error('Invalid file content response');
  }
  return c;
}

export async function saveAgentBootstrapFileContent(
  agentId: string,
  name: string,
  content: string,
): Promise<void> {
  await fetchJson(
    apiUrl(`/api/agents/${encodeURIComponent(agentId)}/files/${encodeURIComponent(name)}`),
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    },
  );
}
