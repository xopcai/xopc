/**
 * Gateway REST helpers for multi-agent management.
 */

import { cp, mkdir, readdir, readFile, realpath, stat, unlink, writeFile } from 'node:fs/promises';
import { join, resolve as pathResolve } from 'node:path';

import {
  DEFAULT_AGENT_ID,
  listAgentEntries,
  normalizeAgentId,
  resolveAgentDir,
  resolveAgentProfileDir,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
  resolveUserPath,
  validateAgentIdForNewAgent,
} from '../agent/agent-scope.js';
import { AGENT_PROFILE_MARKDOWN_SYSTEM_FILES } from '../agent/context/workspace.js';
import { seedAgentProfileMarkdownFiles } from '../agent/context/workspace-seed.js';
import {
  applyAgentConfig,
  findAgentEntryIndex,
  pruneAgentConfig,
  removeAgentDirsFromDisk,
} from '../commands/agents.config.js';
import type { AgentModelsConfig, Config } from '../config/schema.js';
import { WORKSPACE_FILES } from '../config/paths.js';
import { resolveEffectiveAgentProfile } from '../config/agent-profile.js';
import type { AgentTypedModel } from '../config/schema.js';
import { resolveEffectiveTypedModels } from '../config/agent-typed-models.js';
import { GATEWAY_BUILTIN_TOOL_IDS } from './agent-builtin-tools.js';
import { isPathUnderWorkspace, resolveWorkspaceSafePath } from './workspace-editor-path.js';

const EDITABLE_PROFILE_MARKDOWN_NAMES = new Set<string>([...AGENT_PROFILE_MARKDOWN_SYSTEM_FILES]);

export type GatewayAgentTypedModelsInfo = {
  defaults: AgentTypedModel[];
  entry?: AgentTypedModel[];
  effective: AgentTypedModel[];
};

export type GatewayAgentRow = {
  id: string;
  name?: string;
  description?: string;
  language?: string;
  /** Value from `IDENTITY.md` **Avatar:** line when present (may be URL, `xopc:…`, etc.). */
  avatar?: string;
  workspace: string;
  /** Absolute directory for profile Markdown (`SOUL.md`, …) and gateway avatars: `agents/<id>/profile/`. */
  profileDir: string;
  model?: { primary?: string; fallbacks?: string[] };
  typedModels: GatewayAgentTypedModelsInfo;
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

function rolesToTypedModels(
  roles: Record<string, { model: string; description?: string }> | undefined,
): AgentTypedModel[] {
  return Object.entries(roles ?? {})
    .map(([id, role]) => ({ id, ...role }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Extract `**Avatar:**` value from profile IDENTITY.md (same line shape as the gateway console parser). */
export function extractAvatarFromIdentityMarkdown(content: string): string | undefined {
  return parseIdentityMarkdown(content).avatar || undefined;
}

export function parseIdentityMarkdown(content: string): {
  name?: string;
  description?: string;
  language?: string;
  avatar?: string;
} {
  const out: { name?: string; description?: string; language?: string; avatar?: string } = {};
  for (const line of content.split('\n')) {
    const match = line.match(/^[-*]\s+\*\*(Name|Description|Language|Avatar):\*\*\s*(.*)/i);
    if (match) {
      const key = match[1]?.toLowerCase();
      const v = match[2]?.trim() ?? '';
      if (!v || /^_\(.*\)_$/.test(v)) continue;
      if (key === 'name') out.name = v;
      if (key === 'description') out.description = v;
      if (key === 'language') out.language = v;
      if (key === 'avatar') out.avatar = v;
    }
  }
  return out;
}

export async function listGatewayAgents(
  cfg: Config,
  _options: { locale?: string } = {},
): Promise<GatewayAgentsListResponse> {
  const defaultId = resolveDefaultAgentId(cfg);
  const agents: GatewayAgentRow[] = [];
  const defaultsSkills = cfg.agents?.defaults?.skills;
  const defaultsDisable = cfg.agents?.defaults?.tools?.disable ?? [];
  const defaultsTypedModels = rolesToTypedModels(cfg.agents?.defaults?.models?.roles);
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
    const entryTypedModels = rolesToTypedModels(entry?.models?.roles);
    const effectiveTypedModels = [...resolveEffectiveTypedModels(cfg, id).values()].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    let identity: ReturnType<typeof parseIdentityMarkdown> = {};
    try {
      const identityPath = join(resolveAgentProfileDir(cfg, id), WORKSPACE_FILES.IDENTITY);
      const content = await readFile(identityPath, 'utf-8');
      identity = parseIdentityMarkdown(content);
    } catch {
      /* missing IDENTITY.md or unreadable */
    }
    agents.push({
      id,
      ...(identity.name ? { name: identity.name } : {}),
      ...(identity.description ? { description: identity.description } : {}),
      ...(identity.language ? { language: identity.language } : {}),
      ...(identity.avatar ? { avatar: identity.avatar } : {}),
      workspace: profile.resolvedWorkspacePath,
      profileDir: resolveAgentProfileDir(cfg, id),
      ...(model ? { model } : {}),
      typedModels: {
        defaults: [...defaultsTypedModels],
        ...(entryTypedModels.length > 0 ? { entry: entryTypedModels } : {}),
        effective: effectiveTypedModels,
      },
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
  /** Optional id seed; normalized agent id defaults from `profileFiles["IDENTITY.md"]` name when omitted. */
  id?: string;
  workspace: string;
  models?: AgentModelsConfig;
  agentDir?: string;
  /** Initial `agents.list[].skills` for the new entry. */
  skills?: string[];
  /** Initial `agents.list[].tools` for the new entry. */
  tools?: { disable?: string[] };
  /** Profile markdown files to write after seeding (e.g. `IDENTITY.md`, `SOUL.md`). */
  profileFiles?: Record<string, string>;
  /** Clone from an existing agent id — copies config entry fields and profile directory. */
  cloneFrom?: string;
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
  const workspace = body.workspace?.trim() ?? '';
  if (!workspace) {
    return { ok: false, error: 'workspace is required', status: 400 };
  }
  if (body.profileFiles !== undefined) {
    if (typeof body.profileFiles !== 'object' || body.profileFiles === null || Array.isArray(body.profileFiles)) {
      return { ok: false, error: 'profileFiles must be an object', status: 400 };
    }
    for (const [name, content] of Object.entries(body.profileFiles)) {
      const bad = assertAllowedFile(name);
      if (bad) {
        return bad;
      }
      if (typeof content !== 'string') {
        return { ok: false, error: `profileFiles["${name}"] must be a string`, status: 400 };
      }
    }
  }
  if (!body.cloneFrom && typeof body.profileFiles?.[WORKSPACE_FILES.IDENTITY] !== 'string') {
    return { ok: false, error: `profileFiles["${WORKSPACE_FILES.IDENTITY}"] is required`, status: 400 };
  }

  const identity = body.profileFiles?.[WORKSPACE_FILES.IDENTITY]
    ? parseIdentityMarkdown(body.profileFiles[WORKSPACE_FILES.IDENTITY])
    : {};
  const nameSeed = identity.name ?? body.id ?? '';
  const idRes = validateAgentIdForNewAgent(body.id, nameSeed);
  if (idRes.ok === false) {
    return { ok: false, error: idRes.error, status: 400 };
  }
  const agentId = idRes.agentId;
  if (findAgentEntryIndex(listAgentEntries(cfg), agentId) >= 0) {
    return { ok: false, error: `agent "${agentId}" already exists`, status: 409 };
  }

  // Resolve fields from cloneFrom source when present
  let cloneSourceEntry: ReturnType<typeof listAgentEntries>[number] | undefined;
  if (body.cloneFrom) {
    const srcId = normalizeAgentId(body.cloneFrom);
    cloneSourceEntry = listAgentEntries(cfg).find((e) => normalizeAgentId(e.id) === srcId);
    if (!cloneSourceEntry && srcId !== resolveDefaultAgentId(cfg)) {
      return { ok: false, error: `source agent "${srcId}" not found`, status: 404 };
    }
  }

  const wsAbs = resolveUserPath(workspace);

  const effectiveModels = body.models ?? cloneSourceEntry?.models;

  let next = applyAgentConfig(cfg, {
    agentId,
    workspace: wsAbs,
    ...(effectiveModels ? { models: effectiveModels } : {}),
    ...(body.agentDir?.trim() ? { agentDir: body.agentDir.trim() } : {}),
    ...(body.skills !== undefined
      ? { skills: body.skills.map((s) => String(s).trim()).filter(Boolean) }
      : cloneSourceEntry?.skills !== undefined && body.cloneFrom
        ? { skills: [...cloneSourceEntry.skills] }
        : {}),
  });

  // Resolve tools: explicit body > clone source > none
  const tools = body.tools ?? cloneSourceEntry?.tools;
  if (tools !== undefined) {
    const list = [...listAgentEntries(next)];
    const idx = findAgentEntryIndex(list, agentId);
    if (idx >= 0) {
      type Entry = (typeof list)[number];
      const entry: Entry = { ...list[idx] };
      const disable = tools.disable?.map((s) => String(s).trim()).filter(Boolean) ?? [];
      entry.tools = { ...entry.tools, ...(disable.length > 0 ? { disable } : {}) };

      list[idx] = entry;
      next = {
        ...next,
        agents: {
          ...next.agents,
          list,
        },
      };
    }
  }

  return { ok: true, data: { nextConfig: next, agentId, workspace: wsAbs } };
}

export async function finalizeCreateAgentDirs(
  cfg: Config,
  agentId: string,
  opts?: { profileFiles?: Record<string, string>; cloneFrom?: string },
): Promise<AgentAdminResult<void>> {
  const wsPath = resolveAgentWorkspaceDir(cfg, agentId);
  const profilePath = resolveAgentProfileDir(cfg, agentId);
  const adPath = resolveAgentDir(cfg, agentId);
  await mkdir(wsPath, { recursive: true });
  await mkdir(profilePath, { recursive: true });
  await mkdir(adPath, { recursive: true });
  const id = normalizeAgentId(agentId);
  const displayName = opts?.profileFiles?.[WORKSPACE_FILES.IDENTITY]
    ? (parseIdentityMarkdown(opts.profileFiles[WORKSPACE_FILES.IDENTITY]).name ?? id)
    : id;

  // When cloning, copy the entire source profile directory instead of seeding
  if (opts?.cloneFrom) {
    const srcProfilePath = resolveAgentProfileDir(cfg, normalizeAgentId(opts.cloneFrom));
    try {
      const srcStat = await stat(srcProfilePath);
      if (srcStat.isDirectory()) {
        const srcFiles = await readdir(srcProfilePath);
        for (const fileName of srcFiles) {
          const srcFile = join(srcProfilePath, fileName);
          const dstFile = join(profilePath, fileName);
          try {
            const fileStat = await stat(srcFile);
            if (fileStat.isFile()) {
              await cp(srcFile, dstFile);
            }
          } catch {
            /* skip unreadable files */
          }
        }
      }
    } catch {
      // Source profile dir doesn't exist — fall through to normal seed
      seedAgentProfileMarkdownFiles(profilePath, wsPath, { displayName });
    }
  } else {
    seedAgentProfileMarkdownFiles(profilePath, wsPath, { displayName });
  }

  const profileFiles = opts?.profileFiles;
  if (profileFiles && Object.keys(profileFiles).length > 0) {
    for (const [name, content] of Object.entries(profileFiles)) {
      const written = await writeAgentProfileFile(cfg, agentId, name, content);
      if (written.ok === false) {
        return written;
      }
    }
  }

  return { ok: true, data: undefined };
}

export type UpdateAgentBody = {
  workspace?: string;
  models?: {
    chat?: { primary: string; fallbacks?: string[] } | null;
    roles?: Record<string, { model: string; description?: string }> | null;
  } | null;
  agentDir?: string | null;
  setDefault?: boolean;
  /** Replace `agents.list[].skills`; `null` removes the key (inherit defaults). */
  skills?: string[] | null;
  /** Replace `agents.list[].tools`; `null` removes the key (inherit defaults). */
  tools?: { disable?: string[] | null } | null;
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

  if (body.workspace !== undefined) {
    const w = body.workspace.trim();
    if (w) {
      entry.workspace = resolveUserPath(w);
    }
  }
  if (body.models !== undefined) {
    if (body.models === null) {
      delete entry.models;
    } else {
      if (Object.hasOwn(body.models, 'chat')) {
        if (body.models.chat === null) {
          if (entry.models) {
            delete entry.models.chat;
          }
        } else if (body.models.chat !== undefined) {
          const primary = body.models.chat.primary.trim();
          if (!primary) {
            return { ok: false, error: 'models.chat.primary must be a non-empty string', status: 400 };
          }
          const fallbacks = body.models.chat.fallbacks?.map((s) => s.trim()).filter(Boolean);
          entry.models = {
            ...entry.models,
            chat: {
              primary,
              ...(fallbacks && fallbacks.length > 0 ? { fallbacks } : {}),
            },
          };
        }
      }
      if (Object.hasOwn(body.models, 'roles')) {
        if (body.models.roles === null) {
          if (entry.models) {
            delete entry.models.roles;
          }
        } else if (body.models.roles !== undefined) {
          const roles = Object.fromEntries(
            Object.entries(body.models.roles)
              .map(([id, row]) => ({
                id: id.trim(),
                model: row.model.trim(),
                description: row.description?.trim(),
              }))
              .filter((row) => row.id && row.model)
              .map((row) => [
                row.id,
                row.description ? { model: row.model, description: row.description } : { model: row.model },
              ]),
          );
          entry.models = { ...entry.models, roles };
        }
      }
      if (entry.models && Object.keys(entry.models).length === 0) {
        delete entry.models;
      }
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

  if (body.tools !== undefined) {
    if (body.tools === null) {
      delete entry.tools;
    } else {
      if (Object.hasOwn(body.tools, 'disable')) {
        if (body.tools.disable === null) {
          if (entry.tools) {
            delete entry.tools.disable;
            if (Object.keys(entry.tools).length === 0) {
              delete entry.tools;
            }
          }
        } else if (body.tools.disable !== undefined) {
          const next = body.tools.disable.map((s) => String(s).trim()).filter(Boolean);
          entry.tools = { ...entry.tools, disable: next };
        }
      }
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

async function profileMarkdownRootReal(cfg: Config, agentId: string): Promise<string> {
  const dir = resolveAgentProfileDir(cfg, agentId);
  await mkdir(dir, { recursive: true });
  try {
    return await realpath(dir);
  } catch {
    return pathResolve(dir);
  }
}

function assertAllowedFile(name: string): AgentAdminResult<never> | null {
  if (!name || name.includes('/') || name.includes('\\') || !EDITABLE_PROFILE_MARKDOWN_NAMES.has(name)) {
    return { ok: false, error: `unsupported file "${name}"`, status: 400 };
  }
  return null;
}

export async function listAgentProfileFiles(
  cfg: Config,
  agentId: string,
): Promise<AgentAdminResult<{ agentId: string; profileDir: string; files: AgentFileEntry[] }>> {
  const id = normalizeAgentId(agentId);
  if (collectAgentIdsForList(cfg).every((x) => x !== id)) {
    return { ok: false, error: `agent "${id}" not found`, status: 404 };
  }
  const root = await profileMarkdownRootReal(cfg, id);
  const names = [...EDITABLE_PROFILE_MARKDOWN_NAMES];
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
  return { ok: true, data: { agentId: id, profileDir: root, files } };
}

export async function readAgentProfileFile(
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
  const root = await profileMarkdownRootReal(cfg, id);
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

export async function writeAgentProfileFile(
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
  const root = await profileMarkdownRootReal(cfg, id);
  const abs = resolveWorkspaceSafePath(root, name);
  if (!abs) {
    return { ok: false, error: 'invalid path', status: 400 };
  }
  const rootReal = await profileMarkdownRootReal(cfg, id);
  if (!isPathUnderWorkspace(rootReal, abs)) {
    return { ok: false, error: 'path escapes profile markdown root', status: 400 };
  }
  await writeFile(abs, content, 'utf-8');
  return { ok: true, data: { agentId: id, path: abs } };
}

// ---------------------------------------------------------------------------
// Binary agent avatar (profile markdown root dir, not a SOUL/IDENTITY markdown file)
// ---------------------------------------------------------------------------

const AGENT_AVATAR_MAX_BYTES = 512 * 1024;
const AGENT_AVATAR_BASENAME = 'agent-avatar';

const AGENT_AVATAR_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'] as const;

function agentAvatarFilenames(): string[] {
  return AGENT_AVATAR_EXTENSIONS.map((ext) => `${AGENT_AVATAR_BASENAME}${ext}`);
}

function mimeToExt(mime: string): '.png' | '.jpg' | '.jpeg' | '.webp' | null {
  const m = mime.toLowerCase().trim();
  if (m === 'image/png') return '.png';
  if (m === 'image/jpeg' || m === 'image/jpg') return '.jpg';
  if (m === 'image/webp') return '.webp';
  return null;
}

function detectImageMimeFromBytes(buf: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

function assertAgentExistsForAvatar(cfg: Config, id: string): AgentAdminResult<never> | null {
  if (collectAgentIdsForList(cfg).every((x) => x !== id)) {
    return { ok: false, error: `agent "${id}" not found`, status: 404 };
  }
  return null;
}

export async function readAgentAvatarFile(
  cfg: Config,
  agentId: string,
): Promise<AgentAdminResult<{ agentId: string; buffer: Buffer; contentType: string; path: string }>> {
  const missingAgent = assertAgentExistsForAvatar(cfg, agentId);
  if (missingAgent) {
    return missingAgent;
  }
  const id = normalizeAgentId(agentId);
  const root = await profileMarkdownRootReal(cfg, id);
  for (const name of agentAvatarFilenames()) {
    const abs = resolveWorkspaceSafePath(root, name);
    if (!abs) {
      continue;
    }
    try {
      const st = await stat(abs);
      if (!st.isFile() || st.size <= 0 || st.size > AGENT_AVATAR_MAX_BYTES) {
        continue;
      }
      const buffer = await readFile(abs);
      const detected = detectImageMimeFromBytes(buffer);
      if (!detected) {
        continue;
      }
      return { ok: true, data: { agentId: id, buffer, contentType: detected, path: abs } };
    } catch {
      /* try next */
    }
  }
  return { ok: false, error: 'avatar not found', status: 404 };
}

export async function writeAgentAvatarFromBase64(
  cfg: Config,
  agentId: string,
  base64: string,
  mimeType: string,
): Promise<AgentAdminResult<{ agentId: string; path: string }>> {
  const missingAgent = assertAgentExistsForAvatar(cfg, agentId);
  if (missingAgent) {
    return missingAgent;
  }
  const id = normalizeAgentId(agentId);
  const ext = mimeToExt(mimeType);
  if (!ext) {
    return { ok: false, error: 'unsupported mimeType (use image/png, image/jpeg, or image/webp)', status: 400 };
  }
  let raw: Buffer;
  try {
    raw = Buffer.from(base64, 'base64');
  } catch {
    return { ok: false, error: 'invalid base64', status: 400 };
  }
  if (raw.length === 0 || raw.length > AGENT_AVATAR_MAX_BYTES) {
    return { ok: false, error: `avatar must be non-empty and at most ${AGENT_AVATAR_MAX_BYTES} bytes`, status: 400 };
  }
  const detected = detectImageMimeFromBytes(raw);
  if (!detected || !extMatchesDetectedMime(ext, detected)) {
    return { ok: false, error: 'file content does not match declared image type', status: 400 };
  }

  const root = await profileMarkdownRootReal(cfg, id);
  const rootReal = await profileMarkdownRootReal(cfg, id);
  const targetName = `${AGENT_AVATAR_BASENAME}${ext}`;
  const abs = resolveWorkspaceSafePath(root, targetName);
  if (!abs || !isPathUnderWorkspace(rootReal, abs)) {
    return { ok: false, error: 'invalid path', status: 400 };
  }
  for (const name of agentAvatarFilenames()) {
    if (name === targetName) {
      continue;
    }
    const other = resolveWorkspaceSafePath(root, name);
    if (other && isPathUnderWorkspace(rootReal, other)) {
      try {
        await unlink(other);
      } catch {
        /* absent */
      }
    }
  }
  await writeFile(abs, raw);
  return { ok: true, data: { agentId: id, path: abs } };
}

function mimeToExtToMime(ext: '.png' | '.jpg' | '.jpeg' | '.webp'): 'image/png' | 'image/jpeg' | 'image/webp' {
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

function extMatchesDetectedMime(
  ext: '.png' | '.jpg' | '.jpeg' | '.webp',
  detected: 'image/png' | 'image/jpeg' | 'image/webp',
): boolean {
  return detected === mimeToExtToMime(ext);
}

/** Remove any `agent-avatar.*` in the agent profile markdown root. Idempotent: ok even when no file existed. */
export async function deleteAgentAvatarFile(cfg: Config, agentId: string): Promise<AgentAdminResult<{ agentId: string }>> {
  const missingAgent = assertAgentExistsForAvatar(cfg, agentId);
  if (missingAgent) {
    return missingAgent;
  }
  const id = normalizeAgentId(agentId);
  const root = await profileMarkdownRootReal(cfg, id);
  const rootReal = await profileMarkdownRootReal(cfg, id);
  for (const name of agentAvatarFilenames()) {
    const abs = resolveWorkspaceSafePath(root, name);
    if (!abs || !isPathUnderWorkspace(rootReal, abs)) {
      continue;
    }
    try {
      await unlink(abs);
    } catch {
      /* absent */
    }
  }
  return { ok: true, data: { agentId: id } };
}
