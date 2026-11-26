/**
 * Gateway REST helpers for multi-agent management.
 */

import { mkdir, readFile, realpath, stat, unlink, writeFile } from 'node:fs/promises';
import { resolve as pathResolve } from 'node:path';

import {
  listAgentEntries,
  normalizeAgentId,
  resolveAgentProfileDir,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
  resolveUserPath,
  validateAgentIdForNewAgent,
} from '../agent/agent-scope.js';
import {
  AGENT_PROFILE_MARKDOWN_SYSTEM_FILES,
  REQUIRED_AGENT_PROFILE_MARKDOWN_FILE_SET,
} from '../agent/context/workspace.js';
import {
  externalRuntimeDefaultAvatar,
  parseExternalRuntimeAvatar,
  renderExternalRuntimeAvatarSvg,
} from '../agent/external/index.js';
import type {
  AgentEntry,
  AgentModelsOverride,
  AgyAuthMethod,
  EffectiveAgentConfig,
  ExternalAgentExecution,
  ExternalAgentKind,
  ExternalContextAccess,
  ExternalPermissionMode,
  SkillOverride,
} from '../agent-config/index.js';
import { AgentCatalogRepository } from '../agent-catalog/repository.js';
import { AgentCatalogService } from '../agent-catalog/service.js';
import { resolveEffectiveAgentProfile } from '../config/agent-profile.js';
import { GATEWAY_BUILTIN_TOOL_IDS } from './agent-builtin-tools.js';
import { isPathUnderWorkspace, resolveWorkspaceSafePath } from './workspace-editor-path.js';

const EDITABLE_PROFILE_MARKDOWN_NAMES = new Set<string>([...AGENT_PROFILE_MARKDOWN_SYSTEM_FILES]);

export type GatewayAgentRow = {
  id: string;
  revision?: number;
  name?: string;
  description?: string;
  language?: string;
  /** Avatar reference from the structured Agent profile. */
  avatar?: string;
  workspace: string;
  /** Absolute directory for profile Markdown (`SOUL.md`, …) and gateway avatars: `agents/<id>/profile/`. */
  profileDir: string;
  override: AgentEntry;
  effective: EffectiveAgentConfig;
  sources: Record<string, 'system' | 'global' | 'agent'>;
  isDefault: boolean;
};

export type GatewayAgentsListResponse = {
  defaultId: string;
  agents: GatewayAgentRow[];
  builtinToolIds: string[];
};

export type GatewayAgentEffectiveConfigResponse = {
  config: EffectiveAgentConfig;
  sources: Record<string, 'system' | 'global' | 'agent'>;
};

function collectAgentIdsForList(): string[] {
  const entries = listAgentEntries().filter((e) => e.enabled !== false);
  const defaultId = resolveDefaultAgentId();
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

export async function listGatewayAgents(
  _options: { locale?: string } = {},
): Promise<GatewayAgentsListResponse> {
  const defaultId = resolveDefaultAgentId();
  const agents: GatewayAgentRow[] = [];
  for (const id of collectAgentIdsForList()) {
    const profile = resolveEffectiveAgentProfile(id);
    const entry = listAgentEntries().find((e) => normalizeAgentId(e.id) === id);
    if (!entry) continue;
    const identity = entry.profile;
    const resolvedAvatar =
      identity?.avatar?.trim()
      || (entry.execution ? externalRuntimeDefaultAvatar(entry.execution.kind) : undefined);
    agents.push({
      id,
      name: identity?.name ?? id,
      ...(identity?.description ? { description: identity.description } : {}),
      ...(identity?.language ? { language: identity.language } : {}),
      ...(resolvedAvatar ? { avatar: resolvedAvatar } : {}),
      workspace: profile.resolvedWorkspacePath,
      profileDir: resolveAgentProfileDir(id),
      revision: new AgentCatalogRepository().get(entry.id)?.revision,
      override: structuredClone(entry),
      effective: structuredClone(profile.config),
      sources: { ...profile.sources },
      isDefault: id === defaultId,
    });
  }
  agents.sort((a, b) => a.id.localeCompare(b.id));
  return { defaultId, agents, builtinToolIds: [...GATEWAY_BUILTIN_TOOL_IDS] };
}

export function getGatewayAgentEffectiveConfig(
  agentIdRaw: string,
): AgentAdminResult<GatewayAgentEffectiveConfigResponse> {
  const agentId = normalizeAgentId(agentIdRaw);
  const entry = listAgentEntries().find((e) => normalizeAgentId(e.id) === agentId);
  if (!entry) {
    return { ok: false, error: `agent "${agentId}" not found`, status: 404 };
  }
  try {
    return {
      ok: true,
      data: (() => {
        const profile = resolveEffectiveAgentProfile(agentId);
        return { config: profile.config, sources: profile.sources };
      })(),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      status: 400,
    };
  }
}

export type CreateAgentBody = {
  /** Optional id seed; normalized agent id defaults from the profile name when omitted. */
  id?: string;
  workspace?: string;
  profile: NonNullable<AgentEntry['profile']>;
  specialistProfile?: AgentEntry['specialistProfile'];
  execution?: AgentEntry['execution'];
};

export type AgentAdminHttpStatus = 400 | 404 | 409;

export type AgentAdminResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: AgentAdminHttpStatus };

export async function createGatewayAgent(
  body: CreateAgentBody,
): Promise<AgentAdminResult<{ agentId: string; workspace: string }>> {
  const idRes = validateAgentIdForNewAgent(body.id, body.profile.name);
  if (idRes.ok === false) {
    return { ok: false, error: idRes.error, status: 400 };
  }
  const agentId = idRes.agentId;
  if (new AgentCatalogRepository().get(agentId, { includeDeleted: true })) {
    return { ok: false, error: `agent "${agentId}" already exists`, status: 409 };
  }

  const workspace = body.execution
    ? undefined
    : body.workspace?.trim() ? resolveUserPath(body.workspace) : undefined;
  const profile = structuredClone(body.profile);
  if (body.execution && !profile.avatar?.trim()) {
    profile.avatar = externalRuntimeDefaultAvatar(body.execution.kind);
  }
  try {
    await new AgentCatalogService().create({
      id: agentId,
      enabled: true,
      ...(workspace ? { workspace } : {}),
      profile,
      ...(body.specialistProfile ? { specialistProfile: body.specialistProfile } : {}),
      ...(body.execution ? { execution: body.execution } : {}),
    });
    return { ok: true, data: { agentId, workspace: resolveAgentWorkspaceDir(agentId) } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), status: 400 };
  }
}

export type QuickSetupExternalRuntimeItem = {
  kind: ExternalAgentKind;
  name?: string;
  model?: string;
  permissionMode?: ExternalPermissionMode;
  contextAccess?: ExternalContextAccess;
  authMethod?: AgyAuthMethod;
};

export type QuickSetupExternalRuntimeResultItem = {
  kind: ExternalAgentKind;
  agentId?: string;
  created: boolean;
  reusedExisting?: boolean;
  status: 'ok' | 'error';
  error?: string;
};

const QUICK_SETUP_DEFAULTS: Record<ExternalAgentKind, { baseId: string; name: string }> = {
  codex: { baseId: 'codex', name: 'Codex' },
  agy: { baseId: 'antigravity', name: 'Antigravity' },
  claude: { baseId: 'claude-code', name: 'Claude Code' },
};

function allocateUniqueExternalAgentId(repo: AgentCatalogRepository, baseId: string): string {
  if (!repo.get(baseId, { includeDeleted: true })) return baseId;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${baseId}-${suffix}`;
    if (!repo.get(candidate, { includeDeleted: true })) return candidate;
  }
  return `${baseId}-${Date.now().toString(36)}`;
}

function buildQuickSetupExecution(item: QuickSetupExternalRuntimeItem): ExternalAgentExecution {
  const permissionMode: ExternalPermissionMode = item.permissionMode ?? 'full_access';
  const contextAccess: ExternalContextAccess = item.contextAccess ?? 'read_write';
  const model = item.model?.trim() || undefined;
  if (item.kind === 'agy') {
    return {
      kind: 'agy',
      permissionMode,
      contextAccess,
      ...(model ? { model } : {}),
      ...(item.authMethod ? { authMethod: item.authMethod } : {}),
    };
  }
  if (item.kind === 'claude') {
    return {
      kind: 'claude',
      permissionMode,
      contextAccess,
      ...(model ? { model } : {}),
    };
  }
  return {
    kind: 'codex',
    permissionMode,
    contextAccess,
    ...(model ? { model } : {}),
  };
}

/**
 * Idempotently provision one or more host-installed external runtime agents for onboarding.
 * Reuses an active agent of the same kind when present, and avoids 409 collisions with soft-deleted ids.
 */
export async function quickSetupExternalGatewayAgents(
  items: ReadonlyArray<QuickSetupExternalRuntimeItem>,
): Promise<QuickSetupExternalRuntimeResultItem[]> {
  const repo = new AgentCatalogRepository();
  const catalogService = new AgentCatalogService();
  const seenKinds = new Set<ExternalAgentKind>();
  const results: QuickSetupExternalRuntimeResultItem[] = [];

  for (const item of items) {
    if (seenKinds.has(item.kind)) continue;
    seenKinds.add(item.kind);

    const existing = listAgentEntries().find(
      (entry) => entry.enabled !== false && entry.execution?.kind === item.kind,
    );
    if (existing) {
      results.push({
        kind: item.kind,
        agentId: normalizeAgentId(existing.id),
        created: false,
        reusedExisting: true,
        status: 'ok',
      });
      continue;
    }

    const defaults = QUICK_SETUP_DEFAULTS[item.kind];
    const name = item.name?.trim() || defaults.name;
    const agentId = allocateUniqueExternalAgentId(repo, defaults.baseId);
    const execution = buildQuickSetupExecution(item);
    try {
      await catalogService.create({
        id: agentId,
        enabled: true,
        profile: {
          name,
          avatar: externalRuntimeDefaultAvatar(item.kind),
        },
        execution,
      });
      results.push({
        kind: item.kind,
        agentId,
        created: true,
        status: 'ok',
      });
    } catch (error) {
      results.push({
        kind: item.kind,
        created: false,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

export type UpdateAgentBody = {
  expectedRevision?: number;
  specialistProfile?: AgentEntry['specialistProfile'] | null;
  workspace?: string | null;
  profile?: AgentEntry['profile'] | null;
  execution?: AgentEntry['execution'];
  models?: AgentModelsOverride | null;
  setDefault?: boolean;
  skills?: SkillOverride | null;
  tools?: AgentEntry['tools'] | null;
  toolAllowlist?: AgentEntry['toolAllowlist'] | null;
  runtime?: AgentEntry['runtime'] | null;
};

export async function updateGatewayAgent(
  agentIdRaw: string,
  body: UpdateAgentBody,
): Promise<AgentAdminResult<void>> {
  const agentId = normalizeAgentId(agentIdRaw);
  const existing = new AgentCatalogRepository().get(agentId);
  if (!existing) {
    return { ok: false, error: `agent "${agentId}" not found`, status: 404 };
  }
  if (body.setDefault === true && existing.execution) {
    return { ok: false, error: 'External runtime agents cannot be set as the default agent', status: 400 };
  }
  if (body.execution !== undefined) {
    if (!existing.execution || body.execution.kind !== existing.execution.kind) {
      return { ok: false, error: 'Agent execution runtime kind cannot be changed after creation', status: 400 };
    }
  }
  const patch: Partial<Omit<AgentEntry, 'id'>> = {};
  if (body.workspace !== undefined) patch.workspace = body.workspace?.trim() ? resolveUserPath(body.workspace) : undefined;
  if (body.profile !== undefined) patch.profile = body.profile ?? undefined;
  if (body.execution !== undefined) patch.execution = body.execution;
  if (body.specialistProfile !== undefined) patch.specialistProfile = body.specialistProfile ?? undefined;
  if (body.models !== undefined) patch.models = body.models ?? undefined;
  if (body.skills !== undefined) patch.skills = body.skills ?? undefined;
  if (body.tools !== undefined) patch.tools = body.tools ?? undefined;
  if (body.toolAllowlist !== undefined) patch.toolAllowlist = body.toolAllowlist ?? undefined;

  if (body.runtime !== undefined) patch.runtime = body.runtime ?? undefined;
  try {
    const service = new AgentCatalogService();
    await service.update(agentId, patch, body.expectedRevision);
    if (body.setDefault === true) service.setDefault(agentId);
    return { ok: true, data: undefined };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), status: 400 };
  }
}

export async function deleteGatewayAgent(
  agentIdRaw: string,
  options: { purge?: boolean } = {},
): Promise<AgentAdminResult<{ agentId: string; removedBindings: number }>> {
  const agentId = normalizeAgentId(agentIdRaw);
  if (!new AgentCatalogRepository().get(agentId)) {
    return { ok: false, error: `agent "${agentId}" not found`, status: 404 };
  }
  try {
    const result = await new AgentCatalogService().delete(agentId, options);
    return { ok: true, data: { agentId, removedBindings: result.removedBindings } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), status: 400 };
  }
}

export type AgentFileEntry = {
  name: string;
  missing: boolean;
  size?: number;
  updatedAtMs?: number;
};

async function profileMarkdownRootReal(agentId: string): Promise<string> {
  const dir = resolveAgentProfileDir(agentId);
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
  agentId: string,
): Promise<AgentAdminResult<{ agentId: string; profileDir: string; files: AgentFileEntry[] }>> {
  const id = normalizeAgentId(agentId);
  if (collectAgentIdsForList().every((x) => x !== id)) {
    return { ok: false, error: `agent "${id}" not found`, status: 404 };
  }
  const root = await profileMarkdownRootReal(id);
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
      if (!REQUIRED_AGENT_PROFILE_MARKDOWN_FILE_SET.has(name)) {
        continue;
      }
      files.push({ name, missing: true });
    }
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, data: { agentId: id, profileDir: root, files } };
}

export async function readAgentProfileFile(
  agentId: string,
  name: string,
): Promise<AgentAdminResult<{ agentId: string; content: string; path: string }>> {
  const bad = assertAllowedFile(name);
  if (bad) {
    return bad;
  }
  const id = normalizeAgentId(agentId);
  if (collectAgentIdsForList().every((x) => x !== id)) {
    return { ok: false, error: `agent "${id}" not found`, status: 404 };
  }
  const root = await profileMarkdownRootReal(id);
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
  agentId: string,
  name: string,
  content: string,
): Promise<AgentAdminResult<{ agentId: string; path: string }>> {
  const bad = assertAllowedFile(name);
  if (bad) {
    return bad;
  }
  const id = normalizeAgentId(agentId);
  if (collectAgentIdsForList().every((x) => x !== id)) {
    return { ok: false, error: `agent "${id}" not found`, status: 404 };
  }
  const root = await profileMarkdownRootReal(id);
  const abs = resolveWorkspaceSafePath(root, name);
  if (!abs) {
    return { ok: false, error: 'invalid path', status: 400 };
  }
  const rootReal = await profileMarkdownRootReal(id);
  if (!isPathUnderWorkspace(rootReal, abs)) {
    return { ok: false, error: 'path escapes profile markdown root', status: 400 };
  }
  await writeFile(abs, content, 'utf-8');
  return { ok: true, data: { agentId: id, path: abs } };
}

// ---------------------------------------------------------------------------
// Binary agent avatar under the Agent profile directory
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

function assertAgentExistsForAvatar(id: string): AgentAdminResult<never> | null {
  if (collectAgentIdsForList().every((x) => x !== id)) {
    return { ok: false, error: `agent "${id}" not found`, status: 404 };
  }
  return null;
}

export async function readAgentAvatarFile(
  agentId: string,
): Promise<AgentAdminResult<{ agentId: string; buffer: Buffer; contentType: string; path: string }>> {
  const missingAgent = assertAgentExistsForAvatar(agentId);
  if (missingAgent) {
    return missingAgent;
  }
  const id = normalizeAgentId(agentId);
  const root = await profileMarkdownRootReal(id);
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
  agentId: string,
  base64: string,
  mimeType: string,
): Promise<AgentAdminResult<{ agentId: string; path: string }>> {
  const missingAgent = assertAgentExistsForAvatar(agentId);
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

  const root = await profileMarkdownRootReal(id);
  const rootReal = await profileMarkdownRootReal(id);
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
export async function deleteAgentAvatarFile(agentId: string): Promise<AgentAdminResult<{ agentId: string }>> {
  const missingAgent = assertAgentExistsForAvatar(agentId);
  if (missingAgent) {
    return missingAgent;
  }
  const id = normalizeAgentId(agentId);
  const root = await profileMarkdownRootReal(id);
  const rootReal = await profileMarkdownRootReal(id);
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


const renderedAvatarCache = new Map<string, Buffer>();

/** Rasterize configured generated avatars locally for native mobile clients. */
export async function resolveAgentAvatarImage(agentId: string): Promise<AgentAdminResult<{ buffer: Buffer; contentType: string }>> {
  const missing = assertAgentExistsForAvatar(agentId);
  if (missing) return missing;
  const id = normalizeAgentId(agentId);
  const entry = listAgentEntries().find((item) => normalizeAgentId(item.id) === id);
  const reference = entry?.profile?.avatar?.trim() ?? '';
  if (reference === 'xopc:custom') return readAgentAvatarFile(id);
  const runtimeAvatarKind =
    parseExternalRuntimeAvatar(reference)
    ?? (!reference && entry?.execution ? entry.execution.kind : undefined);
  if (runtimeAvatarKind) {
    const key = `runtime:${runtimeAvatarKind}`;
    const cached = renderedAvatarCache.get(key);
    if (cached) return { ok: true, data: { buffer: cached, contentType: 'image/png' } };
    const { default: sharp } = await import('sharp');
    const svg = renderExternalRuntimeAvatarSvg(runtimeAvatarKind, 128);
    const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
    if (renderedAvatarCache.size >= 64) renderedAvatarCache.delete(renderedAvatarCache.keys().next().value!);
    renderedAvatarCache.set(key, buffer);
    return { ok: true, data: { buffer, contentType: 'image/png' } };
  }
  if (reference.startsWith('xopc:loopi:') || /^https?:\/\//i.test(reference)) {
    return { ok: false, status: 404, error: 'Avatar is rendered by the client' };
  }
  const match = /^xopc:dicebear:(adventurer|bottts|lorelei|thumbs|fun-emoji|pixel-art):(.+)$/.exec(reference);
  const style = match?.[1] ?? 'adventurer';
  const seed = match?.[2] ?? id;
  const key = JSON.stringify([style, seed]);
  const cached = renderedAvatarCache.get(key);
  if (cached) return { ok: true, data: { buffer: cached, contentType: 'image/png' } };
  const [{ createAvatar }, collection, { default: sharp }] = await Promise.all([
    import('@dicebear/core'), import('@dicebear/collection'), import('sharp'),
  ]);
  const options = { seed, size: 128 };
  const svg = (() => {
    switch (style) {
      case 'bottts': return createAvatar(collection.bottts, options).toString();
      case 'lorelei': return createAvatar(collection.lorelei, options).toString();
      case 'thumbs': return createAvatar(collection.thumbs, options).toString();
      case 'fun-emoji': return createAvatar(collection.funEmoji, options).toString();
      case 'pixel-art': return createAvatar(collection.pixelArt, options).toString();
      default: return createAvatar(collection.adventurer, options).toString();
    }
  })();
  const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
  if (renderedAvatarCache.size >= 64) renderedAvatarCache.delete(renderedAvatarCache.keys().next().value!);
  renderedAvatarCache.set(key, buffer);
  return { ok: true, data: { buffer, contentType: 'image/png' } };
}
