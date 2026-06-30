/**
 * Per-session markdown workspace override (stored in SessionAgentConfig).
 */

import { join } from 'node:path';

import type { Config } from '../config/schema.js';
import { resolveEffectiveAgentProfileForSession } from '../config/agent-profile.js';
import { resolveDefaultAgentId, resolveUserPath } from '../agent/agent-scope.js';
import { normalizeWorkspaceDir } from '../config/workspace-path.js';
import type { SessionAgentConfig } from './config-types.js';

/**
 * Normalize user input for `workingDirectoryOverride`. Rejects empty and filesystem roots.
 */
export function normalizeWorkingDirectoryInput(raw: string): { ok: true; path: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: 'working directory is empty' };
  }
  const resolved = resolveUserPath(trimmed);
  const normalized = normalizeWorkspaceDir(resolved);
  if (!normalized) {
    return { ok: false, error: 'invalid working directory path' };
  }
  return { ok: true, path: normalized };
}

/**
 * Resolved markdown workspace for tools/shell: session override or merged agent profile default.
 */
export function effectiveWorkspacePathForSession(
  cfg: Config,
  sessionKey: string,
  sessionAgentConfig: SessionAgentConfig | null | undefined,
): string {
  const legacyWorkspace = (cfg.agents as unknown as { defaults?: { workspace?: string } }).defaults?.workspace?.trim();
  const base = legacyWorkspace
    ? join(resolveUserPath(legacyWorkspace), resolveDefaultAgentId(cfg))
    : resolveEffectiveAgentProfileForSession(cfg, sessionKey).resolvedWorkspacePath;
  const o = sessionAgentConfig?.workingDirectoryOverride?.trim();
  if (!o) {
    return base;
  }
  const resolved = resolveUserPath(o);
  const normalized = normalizeWorkspaceDir(resolved);
  return normalized ?? base;
}
