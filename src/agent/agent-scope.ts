/** Agent path and list resolution backed by the SQLite Agent catalog. */

import fs from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';

import type { AgentEntry } from '../agent-config/index.js';
import {
  DEFAULT_AGENT_ID,
  deriveAgentIdFromDisplayName,
  normalizeAgentId,
  STRICT_AGENT_ID_RE,
  validateAgentIdForNewAgent,
} from '../agent-catalog/id.js';
import { AgentCatalogRepository } from '../agent-catalog/repository.js';
import { resolveStateDir } from '../config/paths-state.js';
import { resolveDefaultAgentWorkspaceDir } from '../config/workspace-defaults.js';
import { expandWorkspacePathString } from '../config/workspace-path.js';

export {
  DEFAULT_AGENT_ID,
  deriveAgentIdFromDisplayName,
  normalizeAgentId,
  STRICT_AGENT_ID_RE,
  validateAgentIdForNewAgent,
};

const catalog = new AgentCatalogRepository();

/** Expand `~` and resolve to an absolute path. */
export function resolveUserPath(raw: string): string {
  return resolve(expandWorkspacePathString(raw.trim()));
}

export function listAgentEntries(): AgentEntry[] {
  return catalog.snapshot().agents;
}

export function resolveDefaultAgentId(): string {
  return catalog.getSettings().defaultAgentId;
}

function resolveAgentEntry(agentId: string): AgentEntry | undefined {
  const id = normalizeAgentId(agentId);
  return listAgentEntries().find((entry) => entry.id === id);
}

/** Markdown workspace root for an Agent. */
export function resolveAgentWorkspaceDir(agentId: string): string {
  const id = normalizeAgentId(agentId);
  const configured = resolveAgentEntry(id)?.workspace?.trim();
  if (configured) return resolveUserPath(configured);
  if (id === resolveDefaultAgentId()) return resolveDefaultAgentWorkspaceDir(process.env);
  return join(resolveStateDir(process.env), `workspace-${id}`);
}

/** Internal Agent state dir: credentials, `agent.json`, pid, inbox (`…/agent/`). */
export function resolveAgentDir(agentId: string): string {
  return join(resolveStateDir(process.env), 'agents', normalizeAgentId(agentId), 'agent');
}

/** Parent of `sessions/` and `agent/`: `<stateDir>/agents/<id>/`. */
export function resolveAgentHomeDir(agentId: string): string {
  return join(resolveStateDir(process.env), 'agents', normalizeAgentId(agentId));
}

/** Profile Markdown + gateway avatar files: `<stateDir>/agents/<id>/profile/`. */
export function resolveAgentProfileDir(agentId: string): string {
  return join(resolveAgentHomeDir(agentId), 'profile');
}

/** Resolved path for a single profile Markdown basename (e.g. `SOUL.md`). */
export function resolveAgentProfileMarkdownPath(agentId: string, filename: string): string {
  const base = basename(filename.trim().replace(/\\/g, '/'));
  return join(resolveAgentProfileDir(agentId), base);
}

function normalizePathForComparison(input: string): string {
  const resolved = resolve(resolveUserPath(input));
  let normalized = resolved;
  try {
    normalized = fs.realpathSync.native(resolved);
  } catch {
    // Keep lexical path for non-existent directories.
  }
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isPathWithinRoot(candidatePath: string, rootPath: string): boolean {
  const rel = relative(rootPath, candidatePath);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Agent ids whose workspace root contains `workspacePath` (longest match first). */
export function resolveAgentIdsByWorkspacePath(workspacePath: string): string[] {
  const normalizedWorkspacePath = normalizePathForComparison(workspacePath);
  const entries = listAgentEntries();
  const matches: Array<{ id: string; workspaceDir: string; order: number }> = [];

  entries.forEach((entry, order) => {
    const workspaceDir = normalizePathForComparison(resolveAgentWorkspaceDir(entry.id));
    if (isPathWithinRoot(normalizedWorkspacePath, workspaceDir)) {
      matches.push({ id: entry.id, workspaceDir, order });
    }
  });

  const defaultId = resolveDefaultAgentId();
  if (!entries.some((entry) => entry.id === defaultId)) {
    const workspaceDir = normalizePathForComparison(resolveAgentWorkspaceDir(defaultId));
    if (isPathWithinRoot(normalizedWorkspacePath, workspaceDir)) {
      matches.push({ id: defaultId, workspaceDir, order: entries.length });
    }
  }

  matches.sort((left, right) =>
    right.workspaceDir.length - left.workspaceDir.length || left.order - right.order);
  return matches.map((entry) => entry.id);
}

/** Best-matching Agent id for cwd, or `undefined` when no workspace contains the path. */
export function resolveAgentIdByWorkspacePath(workspacePath: string): string | undefined {
  return resolveAgentIdsByWorkspacePath(workspacePath)[0];
}

/** Resolve an Agent from a workspace, falling back to the catalog default. */
export function resolveAgentIdForWorkspacePath(resolvedWorkspacePath: string): string {
  return resolveAgentIdByWorkspacePath(resolvedWorkspacePath) ?? resolveDefaultAgentId();
}

export function getDefaultWorkspacePath(): string {
  return resolveAgentWorkspaceDir(resolveDefaultAgentId());
}
