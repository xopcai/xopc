/**
 * Workspace setup metadata in `<markdownWorkspace>/.xopc/workspace.json`
 * (same path as `resolveWorkspaceStatePath` / `xopc init`).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { Config } from '../../config/schema.js';
import { FILENAMES, resolveWorkspaceStatePath } from '../../config/paths.js';

export { resolveWorkspaceStatePath };

const WORKSPACE_STATE_VERSION = 1;

export interface WorkspaceSetupState {
  version: number;
  /** Set by `xopc init` for the agent id owning this workspace. */
  agentId?: string;
  /** ISO timestamp when profile Markdown was first seeded (init / agents add). */
  profileMarkdownSeededAt?: string;
}

function parseWorkspaceState(raw: string): WorkspaceSetupState | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return {
      version: WORKSPACE_STATE_VERSION,
      agentId: typeof parsed.agentId === 'string' ? parsed.agentId : undefined,
      profileMarkdownSeededAt:
        typeof parsed.profileMarkdownSeededAt === 'string' ? parsed.profileMarkdownSeededAt : undefined,
    };
  } catch {
    return null;
  }
}

function readWorkspaceState(statePath: string): WorkspaceSetupState {
  try {
    const raw = readFileSync(statePath, 'utf-8');
    return parseWorkspaceState(raw) ?? { version: WORKSPACE_STATE_VERSION };
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code !== 'ENOENT') {
      throw err;
    }
    return { version: WORKSPACE_STATE_VERSION };
  }
}

function writeWorkspaceState(statePath: string, patch: Partial<WorkspaceSetupState>): void {
  const merged = { ...readWorkspaceState(statePath), ...patch, version: WORKSPACE_STATE_VERSION };
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(merged, null, 2)}\n`, 'utf-8');
}

/** Resolve workspace state path when only the Markdown workspace root is known. */
export function resolveWorkspaceStatePathForMarkdownWorkspace(markdownWorkspaceDir: string): string {
  return join(markdownWorkspaceDir, '.xopc', FILENAMES.WORKSPACE_STATE);
}

/** Resolve workspace state path from config + agent id. */
export function resolveAgentWorkspaceStatePath(config: Config, agentId: string): string {
  return resolveWorkspaceStatePath(config, agentId);
}

/** Record profile Markdown seed time (idempotent). */
export function markProfileMarkdownSeeded(statePath: string): void {
  const state = readWorkspaceState(statePath);
  if (state.profileMarkdownSeededAt) {
    return;
  }
  writeWorkspaceState(statePath, { profileMarkdownSeededAt: new Date().toISOString() });
}
