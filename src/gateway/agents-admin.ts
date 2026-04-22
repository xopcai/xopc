/**
 * Gateway REST helpers for multi-agent management.
 */

import { mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { join, resolve as pathResolve } from 'node:path';

import {
  DEFAULT_AGENT_ID,
  listAgentEntries,
  normalizeAgentId,
  resolveAgentBootstrapDir,
  resolveAgentDir,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
  resolveUserPath,
} from '../agent/agent-scope.js';
import { BOOTSTRAP_FILES } from '../agent/context/workspace.js';
import { seedWorkspaceBootstrapFiles } from '../agent/context/workspace-seed.js';
import {
  applyAgentConfig,
  findAgentEntryIndex,
  pruneAgentConfig,
  removeAgentDirsFromDisk,
} from '../commands/agents.config.js';
import type { Config } from '../config/schema.js';
import { WORKSPACE_FILES } from '../config/paths.js';
import { resolveEffectiveAgentProfile } from '../config/agent-profile.js';
import { GATEWAY_BUILTIN_TOOL_IDS } from './agent-builtin-tools.js';
import { isPathUnderWorkspace, resolveWorkspaceSafePath } from './workspace-editor-path.js';

const EDITABLE_BOOTSTRAP_NAMES = new Set<string>([
  ...BOOTSTRAP_FILES,
  WORKSPACE_FILES.BOOTSTRAP,
  WORKSPACE_FILES.CONTEXT,
  WORKSPACE_FILES.SKILLS,
]);

export type GatewayAgentRow = {
  id: string;
  name?: string;
  description?: string;
  workspace: string;
  bootstrapDir: string;
  model?: { primary?: string; fallbacks?: string[] };
  isDefault: boolean;
  skills: {
    defaults: string[];
    entry?: string[];
    effectiveAllowlist?: string[];
  };
  tools: {
    defaultsDisable: string[];
    entryDisable: string[];
    effectiveDisable: string[];
  };
};

export type GatewayAgentsListResponse = {
  defaultId: string;
  agents: GatewayAgentRow[];
  builtinToolIds: string[];
};

function collectAgentIdsForList(cfg: Config): string[] {
  const entries = listAgentEntries(cfg).filter((e) => e.enabled !== false);
  const defaultId = resolveDefaultAgentId(cfg);
  if (entries.length === 0) {
    return [defaultId];
  }
  const ids = new Set<string>();
  for (const e of entries) {
    ids.add(normalizeAgentId(e.id));
  }
  ids.add(defaultId);
  return [...ids];
}

export function listGatewayAgents(cfg: Config): GatewayAgentsListResponse {
  const defaultId = resolveDefaultAgentId(cfg);
  const agents: GatewayAgentRow[] = [];
  const defaultsSkills = cfg.agents?.defaults?.skills;
  const defaultsDisable = cfg.agents?.defaults?.tools?.disable ?? [];
  for (const id of collectAgentIdsForList(cfg)) {
    const profile = resolveEffectiveAgentProfile(cfg, id);
    const entry = listAgentEntries(cfg).find((e) => normalizeAgentId(e.id) === id);
    const model =
      profile.primaryModelRef || profile.fallbacks.length > 0
        ? {
            ...(profile.primaryModelRef ? { primary: profile.primaryModelRef } : {}),
            ...(profile.fallbacks.length > 0 ? { fallbacks: profile.fallbacks } : {}),
          }
        : undefined;
    const entrySkills = entry?.skills;
    const entryDisable = entry?.tools?.disable ?? [];
    agents.push({
      id,
      ...(entry?.name?.trim() ? { name: entry.name.trim() } : {}),
      ...(entry?.description?.trim() ? { description: entry.description.trim() } : {}),
      workspace: profile.resolvedWorkspacePath,
      bootstrapDir: resolveAgentBootstrapDir(cfg, id),
      ...(model ? { model } : {}),
      isDefault: id === defaultId,
      skills: {
        defaults: defaultsSkills ? [...defaultsSkills] : [],
        ...(entrySkills !== undefined ? { entry: [...entrySkills] } : {}),
        ...(profile.skillsAllowlist !== undefined
          ? { effectiveAllowlist: [...profile.skillsAllowlist] }
          : {}),
      },
      tools: {
        defaultsDisable: [...defaultsDisable],
        entryDisable: [...entryDisable],
        effectiveDisable: [...profile.tools.disable].sort((a, b) => a.localeCompare(b)),
      },
    });
  }
  agents.sort((a, b) => a.id.localeCompare(b.id));
  return { defaultId, agents, builtinToolIds: [...GATEWAY_BUILTIN_TOOL_IDS] };
}

export type CreateAgentBody = {
  /** Display name stored on the agent entry. */
  name: string;
  /** Optional id seed; normalized agent id defaults from `name` when omitted. */
  id?: string;
  workspace: string;
  model?: string;
  agentDir?: string;
  description?: string;
};

export type AgentAdminHttpStatus = 400 | 404 | 409;

export type AgentAdminResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: AgentAdminHttpStatus };

function requireNonMain(id: string): AgentAdminResult<never> | null {
  if (normalizeAgentId(id) === DEFAULT_AGENT_ID) {
    return { ok: false, error: `"${DEFAULT_AGENT_ID}" is reserved`, status: 400 };
  }
  return null;
}

export function prepareCreateAgent(
  cfg: Config,
  body: CreateAgentBody,
): AgentAdminResult<{ nextConfig: Config; agentId: string; workspace: string }> {
  const name = body.name?.trim() ?? '';
  if (!name) {
    return { ok: false, error: 'name is required', status: 400 };
  }
  const workspace = body.workspace?.trim() ?? '';
  if (!workspace) {
    return { ok: false, error: 'workspace is required', status: 400 };
  }
  const idSeed = body.id?.trim() || name;
  const agentId = normalizeAgentId(idSeed);
  const reserved = requireNonMain(agentId);
  if (reserved) {
    return reserved;
  }
  if (findAgentEntryIndex(listAgentEntries(cfg), agentId) >= 0) {
    return { ok: false, error: `agent "${agentId}" already exists`, status: 409 };
  }
  const wsAbs = resolveUserPath(workspace);
  let next = applyAgentConfig(cfg, {
    agentId,
    name,
    workspace: wsAbs,
    ...(body.model?.trim() ? { model: body.model.trim() } : {}),
    ...(body.agentDir?.trim() ? { agentDir: body.agentDir.trim() } : {}),
    ...(body.description?.trim() ? { description: body.description.trim() } : {}),
  });
  return { ok: true, data: { nextConfig: next, agentId, workspace: wsAbs } };
}

export async function finalizeCreateAgentDirs(cfg: Config, agentId: string): Promise<void> {
  const wsPath = resolveAgentWorkspaceDir(cfg, agentId);
  const adPath = resolveAgentDir(cfg, agentId);
  const bootstrapPath = resolveAgentBootstrapDir(cfg, agentId);
  await mkdir(wsPath, { recursive: true });
  await mkdir(adPath, { recursive: true });
  await mkdir(join(adPath, 'credentials'), { recursive: true });
  await mkdir(bootstrapPath, { recursive: true });
  const id = normalizeAgentId(agentId);
  const entry = listAgentEntries(cfg).find((e) => normalizeAgentId(e.id) === id);
  const displayName = entry?.name?.trim() || id;
  seedWorkspaceBootstrapFiles(bootstrapPath, { displayName });
}

export type UpdateAgentBody = {
  name?: string;
  description?: string | null;
  workspace?: string;
  model?: string | null;
  agentDir?: string | null;
  setDefault?: boolean;
  /** Replace `agents.list[].skills`; `null` removes the key (inherit defaults). */
  skills?: string[] | null;
  /** Replace `agents.list[].tools.disable`; `null` clears entry-level disables. */
  toolsDisable?: string[] | null;
};

export function prepareUpdateAgent(
  cfg: Config,
  agentIdRaw: string,
  body: UpdateAgentBody,
): AgentAdminResult<{ nextConfig: Config }> {
  const agentId = normalizeAgentId(agentIdRaw);
  let list = [...listAgentEntries(cfg)];
  let idx = findAgentEntryIndex(list, agentId);
  if (idx < 0 && agentId === resolveDefaultAgentId(cfg)) {
    list = [...list, { id: agentId, enabled: true as const }];
    idx = list.length - 1;
  }
  if (idx < 0) {
    return { ok: false, error: `agent "${agentId}" not found`, status: 404 };
  }

  type Entry = (typeof list)[number];
  const entry: Entry = { ...list[idx] };

  if (body.name !== undefined) {
    const n = body.name.trim();
    if (n) {
      entry.name = n;
    }
  }
  if (body.description !== undefined) {
    if (body.description === null || String(body.description).trim() === '') {
      delete entry.description;
    } else {
      entry.description = String(body.description).trim();
    }
  }
  if (body.workspace !== undefined) {
    const w = body.workspace.trim();
    if (w) {
      entry.workspace = resolveUserPath(w);
    }
  }
  if (body.model !== undefined) {
    if (body.model === null || String(body.model).trim() === '') {
      delete entry.model;
    } else {
      entry.model = String(body.model).trim() as Entry['model'];
    }
  }
  if (body.agentDir !== undefined) {
    if (body.agentDir === null || String(body.agentDir).trim() === '') {
      delete entry.agentDir;
    } else {
      entry.agentDir = String(body.agentDir).trim();
    }
  }

  if (body.skills !== undefined) {
    if (body.skills === null) {
      delete entry.skills;
    } else {
      const next = body.skills.map((s) => String(s).trim()).filter(Boolean);
      if (next.length === 0) {
        entry.skills = [];
      } else {
        entry.skills = next;
      }
    }
  }

  if (body.toolsDisable !== undefined) {
    if (body.toolsDisable === null) {
      if (entry.tools) {
        delete entry.tools.disable;
        if (Object.keys(entry.tools).length === 0) {
          delete entry.tools;
        }
      }
    } else {
      const next = body.toolsDisable.map((s) => String(s).trim()).filter(Boolean);
      entry.tools = { ...entry.tools, disable: next };
    }
  }

  list[idx] = entry;
  let next: Config = {
    ...cfg,
    agents: {
      ...cfg.agents,
      list,
    },
  };

  if (body.setDefault === true) {
    next = {
      ...next,
      agents: {
        ...next.agents,
        default: agentId,
      },
    };
  }
  return { ok: true, data: { nextConfig: next } };
}

export function prepareDeleteAgent(
  cfg: Config,
  agentIdRaw: string,
): AgentAdminResult<{ nextConfig: Config; agentId: string }> {
  const agentId = normalizeAgentId(agentIdRaw);
  const reserved = requireNonMain(agentId);
  if (reserved) {
    return reserved;
  }
  if (findAgentEntryIndex(listAgentEntries(cfg), agentId) < 0) {
    return { ok: false, error: `agent "${agentId}" not found`, status: 404 };
  }
  const { config: pruned } = pruneAgentConfig(cfg, agentId);
  return { ok: true, data: { nextConfig: pruned, agentId } };
}

export async function runAfterDeletePurge(cfg: Config, agentId: string): Promise<void> {
  await removeAgentDirsFromDisk(cfg, agentId);
}

export type AgentFileEntry = {
  name: string;
  missing: boolean;
  size?: number;
  updatedAtMs?: number;
};

async function bootstrapRootReal(cfg: Config, agentId: string): Promise<string> {
  const dir = resolveAgentBootstrapDir(cfg, agentId);
  await mkdir(dir, { recursive: true });
  try {
    return await realpath(dir);
  } catch {
    return pathResolve(dir);
  }
}

function assertAllowedFile(name: string): AgentAdminResult<never> | null {
  if (!name || name.includes('/') || name.includes('\\') || !EDITABLE_BOOTSTRAP_NAMES.has(name)) {
    return { ok: false, error: `unsupported file "${name}"`, status: 400 };
  }
  return null;
}

export async function listAgentBootstrapFiles(
  cfg: Config,
  agentId: string,
): Promise<AgentAdminResult<{ agentId: string; bootstrapDir: string; files: AgentFileEntry[] }>> {
  const id = normalizeAgentId(agentId);
  if (collectAgentIdsForList(cfg).every((x) => x !== id)) {
    return { ok: false, error: `agent "${id}" not found`, status: 404 };
  }
  const root = await bootstrapRootReal(cfg, id);
  const names = [...EDITABLE_BOOTSTRAP_NAMES];
  const files: AgentFileEntry[] = [];
  for (const name of names.sort((a, b) => a.localeCompare(b))) {
    const abs = resolveWorkspaceSafePath(root, name);
    if (!abs) {
      continue;
    }
    try {
      const st = await stat(abs);
      if (!st.isFile()) {
        continue;
      }
      files.push({
        name,
        missing: false,
        size: st.size,
        updatedAtMs: st.mtimeMs,
      });
    } catch {
      files.push({ name, missing: true });
    }
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, data: { agentId: id, bootstrapDir: root, files } };
}

export async function readAgentBootstrapFile(
  cfg: Config,
  agentId: string,
  name: string,
): Promise<AgentAdminResult<{ agentId: string; content: string; path: string }>> {
  const bad = assertAllowedFile(name);
  if (bad) {
    return bad;
  }
  const id = normalizeAgentId(agentId);
  if (collectAgentIdsForList(cfg).every((x) => x !== id)) {
    return { ok: false, error: `agent "${id}" not found`, status: 404 };
  }
  const root = await bootstrapRootReal(cfg, id);
  const abs = resolveWorkspaceSafePath(root, name);
  if (!abs) {
    return { ok: false, error: 'invalid path', status: 400 };
  }
  try {
    const content = await readFile(abs, 'utf-8');
    return { ok: true, data: { agentId: id, content, path: abs } };
  } catch {
    return { ok: false, error: 'file not found', status: 404 };
  }
}

export async function writeAgentBootstrapFile(
  cfg: Config,
  agentId: string,
  name: string,
  content: string,
): Promise<AgentAdminResult<{ agentId: string; path: string }>> {
  const bad = assertAllowedFile(name);
  if (bad) {
    return bad;
  }
  const id = normalizeAgentId(agentId);
  if (collectAgentIdsForList(cfg).every((x) => x !== id)) {
    return { ok: false, error: `agent "${id}" not found`, status: 404 };
  }
  const root = await bootstrapRootReal(cfg, id);
  const abs = resolveWorkspaceSafePath(root, name);
  if (!abs) {
    return { ok: false, error: 'invalid path', status: 400 };
  }
  const rootReal = await bootstrapRootReal(cfg, id);
  if (!isPathUnderWorkspace(rootReal, abs)) {
    return { ok: false, error: 'path escapes bootstrap root', status: 400 };
  }
  await writeFile(abs, content, 'utf-8');
  return { ok: true, data: { agentId: id, path: abs } };
}
