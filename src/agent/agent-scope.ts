/**
 * Agent path and list resolution (config is the single source of truth).
 */

import { join, resolve } from 'node:path';

import type { Config } from '../config/schema.js';
import { resolveStateDir } from '../config/paths-state.js';
import { expandWorkspacePathString } from '../config/workspace-path.js';
import { resolveDefaultAgentWorkspaceDir } from '../config/workspace-defaults.js';

export const DEFAULT_AGENT_ID = 'main';

const VALID_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const INVALID_CHARS_RE = /[^a-z0-9_-]+/g;
const LEADING_DASH_RE = /^-+/;
const TRAILING_DASH_RE = /-+$/;

/** Normalized id segment safe for directory names under `agents/<id>/`. */
export const STRICT_AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const WINDOWS_RESERVED_AGENT_IDS = new Set<string>([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

function normalizeLowercaseStringOrEmpty(s: string): string {
  return s.trim().toLowerCase();
}

/** Path-safe agent id. */
export function normalizeAgentId(value: string | undefined | null): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    return DEFAULT_AGENT_ID;
  }
  const normalized = normalizeLowercaseStringOrEmpty(trimmed);
  if (VALID_ID_RE.test(trimmed)) {
    return normalized;
  }
  return (
    normalized
      .replace(INVALID_CHARS_RE, '-')
      .replace(LEADING_DASH_RE, '')
      .replace(TRAILING_DASH_RE, '')
      .slice(0, 64) || DEFAULT_AGENT_ID
  );
}

/**
 * Validate agent id for new agents (folder-safe path segment).
 * When `explicitId` is set, it must already match {@link STRICT_AGENT_ID_RE} (case-insensitive input, stored lowercase).
 * When omitted, id is derived from `displayNameForDerivation` via {@link normalizeAgentId}.
 */
export function validateAgentIdForNewAgent(
  explicitId: string | undefined | null,
  displayNameForDerivation: string,
): { ok: true; agentId: string } | { ok: false; error: string } {
  const explicit = explicitId?.trim();
  if (explicit) {
    const id = explicit.toLowerCase();
    if (!STRICT_AGENT_ID_RE.test(id)) {
      return {
        ok: false,
        error:
          'Invalid agent id: use 1–64 characters; letters, digits, underscores, and hyphens only; start with a letter or digit.',
      };
    }
    if (id === DEFAULT_AGENT_ID) {
      return { ok: false, error: `"${DEFAULT_AGENT_ID}" is reserved` };
    }
    if (WINDOWS_RESERVED_AGENT_IDS.has(id)) {
      return { ok: false, error: `Agent id "${id}" is reserved (Windows device name).` };
    }
    return { ok: true, agentId: id };
  }

  const agentId = normalizeAgentId(displayNameForDerivation.trim());
  if (agentId === DEFAULT_AGENT_ID) {
    return {
      ok: false,
      error:
        'Display name cannot produce a valid agent folder id. Set an explicit Agent id (letters, digits, underscores, hyphens only).',
    };
  }
  if (WINDOWS_RESERVED_AGENT_IDS.has(agentId)) {
    return {
      ok: false,
      error: `That display name resolves to "${agentId}", which is reserved. Use a different display name or set an explicit Agent id.`,
    };
  }
  if (!STRICT_AGENT_ID_RE.test(agentId)) {
    return {
      ok: false,
      error:
        'Could not derive a folder-safe agent id from the display name. Set an explicit Agent id (letters, digits, underscores, hyphens only).',
    };
  }
  return { ok: true, agentId };
}

/** Expand `~` and resolve to an absolute path. */
export function resolveUserPath(raw: string): string {
  const expanded = expandWorkspacePathString(raw.trim());
  return resolve(expanded);
}

type AgentEntry = NonNullable<NonNullable<Config['agents']>['list']>[number];

export function listAgentEntries(cfg: Config): AgentEntry[] {
  const list = cfg.agents?.list;
  if (!Array.isArray(list)) {
    return [];
  }
  return list.filter((e): e is AgentEntry => Boolean(e && typeof e === 'object'));
}

export function resolveDefaultAgentId(cfg: Config): string {
  const explicit = cfg.agents?.default?.trim();
  if (explicit) {
    return normalizeAgentId(explicit);
  }
  const agents = listAgentEntries(cfg);
  if (agents.length === 0) {
    return DEFAULT_AGENT_ID;
  }
  const defaults = agents.filter((a) => a?.default === true);
  const chosen = (defaults[0] ?? agents[0])?.id?.trim();
  return chosen ? normalizeAgentId(chosen) : DEFAULT_AGENT_ID;
}

function resolveAgentEntry(cfg: Config, agentId: string): AgentEntry | undefined {
  const id = normalizeAgentId(agentId);
  return listAgentEntries(cfg).find((e) => normalizeAgentId(e.id) === id);
}

/**
 * Markdown workspace root for an agent.
 */
export function resolveAgentWorkspaceDir(cfg: Config, agentId: string): string {
  const id = normalizeAgentId(agentId);
  const configured = resolveAgentEntry(cfg, id)?.workspace?.trim();
  if (configured) {
    return resolveUserPath(configured);
  }
  const defaultAgentId = resolveDefaultAgentId(cfg);
  const fallback = cfg.agents?.defaults?.workspace?.trim();
  if (id === defaultAgentId) {
    if (fallback) {
      return resolveUserPath(fallback);
    }
    return resolveDefaultAgentWorkspaceDir(process.env);
  }
  if (fallback) {
    return join(resolveUserPath(fallback), id);
  }
  const stateDir = resolveStateDir(process.env);
  return join(stateDir, `workspace-${id}`);
}

/**
 * Internal agent state dir: credentials, `agent.json`, pid, inbox (`…/agent/`).
 */
export function resolveAgentDir(cfg: Config, agentId: string): string {
  const id = normalizeAgentId(agentId);
  const configured = resolveAgentEntry(cfg, id)?.agentDir?.trim();
  if (configured) {
    return resolveUserPath(configured);
  }
  const root = resolveStateDir(process.env);
  return join(root, 'agents', id, 'agent');
}

/** Parent of `sessions/` and `agent/`: `<stateDir>/agents/<id>/`. */
export function resolveAgentHomeDir(cfg: Config, agentId: string): string {
  return join(resolveStateDir(process.env), 'agents', normalizeAgentId(agentId));
}

/** Bootstrap / persona Markdown (SOUL, AGENTS, …) under agent home — not the markdown project workspace. */
export function resolveAgentBootstrapDir(cfg: Config, agentId: string): string {
  return join(resolveAgentHomeDir(cfg, agentId), 'bootstrap');
}

export function resolveSessionsDir(cfg: Config, agentId: string): string {
  return join(resolveAgentHomeDir(cfg, agentId), 'sessions');
}

/**
 * Find the agent id whose resolved markdown workspace matches `resolvedWorkspacePath`.
 * Falls back to {@link resolveDefaultAgentId} when no list entry matches.
 */
export function resolveAgentIdForWorkspacePath(cfg: Config, resolvedWorkspacePath: string): string {
  const target = resolveUserPath(resolvedWorkspacePath);
  for (const e of listAgentEntries(cfg)) {
    const id = normalizeAgentId(e.id);
    if (resolveAgentWorkspaceDir(cfg, id) === target) {
      return id;
    }
  }
  const def = resolveDefaultAgentId(cfg);
  if (resolveAgentWorkspaceDir(cfg, def) === target) {
    return def;
  }
  return def;
}

export function getDefaultWorkspacePath(cfg: Config): string {
  return resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg));
}
