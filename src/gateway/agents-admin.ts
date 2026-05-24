/**
 * Gateway REST helpers for multi-agent management.
 */

import { mkdir, readFile, realpath, stat, unlink, writeFile } from 'node:fs/promises';
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
import type { Config } from '../config/schema.js';
import { WORKSPACE_FILES } from '../config/paths.js';
import { resolveEffectiveAgentProfile } from '../config/agent-profile.js';
import { GATEWAY_BUILTIN_TOOL_IDS } from './agent-builtin-tools.js';
import { isPathUnderWorkspace, resolveWorkspaceSafePath } from './workspace-editor-path.js';

const EDITABLE_PROFILE_MARKDOWN_NAMES = new Set<string>([
  ...AGENT_PROFILE_MARKDOWN_SYSTEM_FILES,
  WORKSPACE_FILES.BOOTSTRAP,
]);

export type GatewayAgentRow = {
  id: string;
  name?: string;
  description?: string;
  /** Value from `IDENTITY.md` **Avatar:** line when present (may be URL, `xopc:…`, etc.). */
  avatar?: string;
  workspace: string;
  /** Absolute directory for profile Markdown (`SOUL.md`, …) and gateway avatars: `agents/<id>/profile/`. */
  profileDir: string;
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

/** Extract `**Avatar:**` value from profile IDENTITY.md (same line shape as the gateway console parser). */
export function extractAvatarFromIdentityMarkdown(content: string): string | undefined {
  for (const line of content.split('\n')) {
    const match = line.match(/^[-*]\s+\*\*Avatar:\*\*\s*(.*)/i);
    if (match) {
      const v = match[1]?.trim() ?? '';
      return v.length > 0 ? v : undefined;
    }
  }
  return undefined;
}

export async function listGatewayAgents(cfg: Config): Promise<GatewayAgentsListResponse> {
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
    let avatar: string | undefined;
    try {
      const identityPath = join(resolveAgentProfileDir(cfg, id), WORKSPACE_FILES.IDENTITY);
      const content = await readFile(identityPath, 'utf-8');
      avatar = extractAvatarFromIdentityMarkdown(content);
    } catch {
      /* missing IDENTITY.md or unreadable */
    }
    agents.push({
      id,
      ...(entry?.name?.trim() ? { name: entry.name.trim() } : {}),
      ...(entry?.description?.trim() ? { description: entry.description.trim() } : {}),
      ...(avatar ? { avatar } : {}),
      workspace: profile.resolvedWorkspacePath,
      profileDir: resolveAgentProfileDir(cfg, id),
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
  /** Initial `agents.list[].tools.disable` for the new entry. */
  toolsDisable?: string[];
  /** Profile markdown files to write after seeding (e.g. `IDENTITY.md`, `SOUL.md`). */
  profileFiles?: Record<string, string>;
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
  const idRes = validateAgentIdForNewAgent(body.id, name);
  if (idRes.ok === false) {
    return { ok: false, error: idRes.error, status: 400 };
  }
  const agentId = idRes.agentId;
  if (findAgentEntryIndex(listAgentEntries(cfg), agentId) >= 0) {
    return { ok: false, error: `agent "${agentId}" already exists`, status: 409 };
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

  const wsAbs = resolveUserPath(workspace);
  let next = applyAgentConfig(cfg, {
    agentId,
    name,
    workspace: wsAbs,
    ...(body.model?.trim() ? { model: body.model.trim() } : {}),
    ...(body.agentDir?.trim() ? { agentDir: body.agentDir.trim() } : {}),
    ...(body.description?.trim() ? { description: body.description.trim() } : {}),
  });

  if (body.toolsDisable !== undefined) {
    const list = [...listAgentEntries(next)];
    const idx = findAgentEntryIndex(list, agentId);
    if (idx >= 0) {
      type Entry = (typeof list)[number];
      const entry: Entry = { ...list[idx] };
      const disable = body.toolsDisable.map((s) => String(s).trim()).filter(Boolean);
      entry.tools = { ...entry.tools, disable };
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
  opts?: { profileFiles?: Record<string, string> },
): Promise<AgentAdminResult<void>> {
  const wsPath = resolveAgentWorkspaceDir(cfg, agentId);
  const profilePath = resolveAgentProfileDir(cfg, agentId);
  const adPath = resolveAgentDir(cfg, agentId);
  await mkdir(wsPath, { recursive: true });
  await mkdir(profilePath, { recursive: true });
  await mkdir(adPath, { recursive: true });
  const id = normalizeAgentId(agentId);
  const entry = listAgentEntries(cfg).find((e) => normalizeAgentId(e.id) === id);
  const displayName = entry?.name?.trim() || id;
  seedAgentProfileMarkdownFiles(profilePath, wsPath, { displayName });

  const profileFiles = opts?.profileFiles;
  if (profileFiles && Object.keys(profileFiles).length > 0) {
    for (const [name, content] of Object.entries(profileFiles)) {
      const written = await writeAgentProfileFile(cfg, agentId, name, content);
      if (!written.ok) {
        return written;
      }
    }
  }

  return { ok: true, data: undefined };
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
