/**
 * Workspace bootstrap state machine — OpenClaw-aligned.
 *
 * Tracks BOOTSTRAP.md lifecycle in `<markdownWorkspace>/.xopc/workspace.json`
 * (same path as `resolveWorkspaceStatePath` / `xopc init`).
 *
 * Motivation: BOOTSTRAP.md instructs the agent to delete itself after setup,
 * but that is unreliable (LLM-dependent). This module provides a runtime-level
 * state machine so the system can track whether bootstrap was completed
 * regardless of whether the agent actually deleted the file.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { Config } from '../../config/schema.js';
import { FILENAMES, WORKSPACE_FILES, resolveWorkspaceStatePath } from '../../config/paths.js';

export { resolveWorkspaceStatePath };

const WORKSPACE_STATE_VERSION = 1;

export interface WorkspaceSetupState {
  version: number;
  /** Set by `xopc init` for the agent id owning this workspace. */
  agentId?: string;
  /** ISO timestamp when profile Markdown was first seeded (init / agents add). */
  profileMarkdownSeededAt?: string;
  /** ISO timestamp when BOOTSTRAP.md was first seeded into the profile. */
  bootstrapSeededAt?: string;
  /** ISO timestamp when bootstrap setup was completed (BOOTSTRAP.md workflow finished). */
  setupCompletedAt?: string;
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
      bootstrapSeededAt:
        typeof parsed.bootstrapSeededAt === 'string' ? parsed.bootstrapSeededAt : undefined,
      setupCompletedAt: typeof parsed.setupCompletedAt === 'string' ? parsed.setupCompletedAt : undefined,
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

/**
 * Check whether the workspace bootstrap setup has been completed.
 * Returns true when `setupCompletedAt` is set in the state file.
 */
export function isWorkspaceSetupCompleted(statePath: string): boolean {
  const state = readWorkspaceState(statePath);
  return typeof state.setupCompletedAt === 'string' && state.setupCompletedAt.trim().length > 0;
}

/**
 * Check whether BOOTSTRAP.md is still pending (seeded but not completed).
 * Works even if the file was already deleted by the agent — the state file is authoritative.
 */
export function isWorkspaceBootstrapPending(statePath: string): boolean {
  const state = readWorkspaceState(statePath);
  if (typeof state.setupCompletedAt === 'string' && state.setupCompletedAt.trim().length > 0) {
    return false;
  }
  return typeof state.bootstrapSeededAt === 'string';
}

/**
 * When BOOTSTRAP.md was seeded but the file is now gone, treat setup as completed.
 * Idempotent; safe to call before loading bootstrap files or listing profile files.
 */
export function syncBootstrapSetupCompletion(statePath: string, profileDir: string): void {
  if (isWorkspaceSetupCompleted(statePath)) {
    return;
  }
  if (existsSync(join(profileDir, WORKSPACE_FILES.BOOTSTRAP))) {
    return;
  }
  const state = readWorkspaceState(statePath);
  if (!state.bootstrapSeededAt) {
    return;
  }
  markSetupCompleted(statePath);
}

/**
 * Mark BOOTSTRAP.md as seeded (call when workspace-seed.ts writes the file).
 */
export function markBootstrapSeeded(statePath: string): void {
  const state = readWorkspaceState(statePath);
  if (state.bootstrapSeededAt) {
    return;
  }
  writeWorkspaceState(statePath, { bootstrapSeededAt: new Date().toISOString() });
}

/**
 * Mark bootstrap setup as completed.
 */
export function markSetupCompleted(statePath: string): void {
  writeWorkspaceState(statePath, { setupCompletedAt: new Date().toISOString() });
}
