import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { WORKSPACE_FILES } from '../../config/paths.js';
import { stripFrontMatter } from '../context/workspace.js';
import {
  isWorkspaceSetupCompleted,
  syncBootstrapSetupCompletion,
} from '../context/workspace-state.js';
import {
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_MEMORY_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_USER_FILENAME,
} from '../context/workspace.js';
import type { BootstrapFileName, WorkspaceBootstrapFile } from './types.js';

const BOOTSTRAP_LOAD_ORDER: BootstrapFileName[] = [
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_USER_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  WORKSPACE_FILES.BOOTSTRAP,
  DEFAULT_MEMORY_FILENAME,
];

function readProfileFile(filePath: string): string | null {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    return stripFrontMatter(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

export function isProfileBootstrapPending(profileDir: string, workspaceStatePath: string): boolean {
  syncBootstrapSetupCompletion(workspaceStatePath, profileDir);
  if (isWorkspaceSetupCompleted(workspaceStatePath)) {
    return false;
  }
  return existsSync(join(profileDir, WORKSPACE_FILES.BOOTSTRAP));
}

/**
 * Load bootstrap profile Markdown from `agents/<id>/profile/`.
 * MEMORY.md and BOOTSTRAP.md are omitted when absent; other slots emit missing markers.
 *
 * BOOTSTRAP.md is also filtered out when `setupCompletedAt` is set in the workspace state,
 * to prevent re-injection of the bootstrap script after setup is done.
 */
export function loadProfileBootstrapFiles(
  profileDir: string,
  workspaceStatePath: string,
): WorkspaceBootstrapFile[] {
  syncBootstrapSetupCompletion(workspaceStatePath, profileDir);
  const resolvedDir = resolve(profileDir);
  const result: WorkspaceBootstrapFile[] = [];
  const setupCompleted = isWorkspaceSetupCompleted(workspaceStatePath);

  for (const name of BOOTSTRAP_LOAD_ORDER) {
    const filePath = join(resolvedDir, name);

    // Skip BOOTSTRAP.md entirely when setup is already completed
    if (name === WORKSPACE_FILES.BOOTSTRAP && setupCompleted) {
      continue;
    }

    if (name === DEFAULT_MEMORY_FILENAME || name === WORKSPACE_FILES.BOOTSTRAP) {
      const content = readProfileFile(filePath);
      if (content === null) {
        continue;
      }
      result.push({ name, path: filePath, content, missing: false });
      continue;
    }

    const content = readProfileFile(filePath);
    if (content !== null) {
      result.push({ name, path: filePath, content, missing: false });
    } else {
      result.push({ name, path: filePath, missing: true });
    }
  }

  return result;
}
