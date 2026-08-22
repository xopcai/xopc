import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { stripFrontMatter } from '../context/workspace.js';
import {
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  REQUIRED_AGENT_PROFILE_MARKDOWN_FILE_SET,
} from '../context/workspace.js';
import type { BootstrapFileName, WorkspaceBootstrapFile } from './types.js';

const PROFILE_LOAD_ORDER: BootstrapFileName[] = [
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
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

/**
 * Load bootstrap profile Markdown from `agents/<id>/profile/`.
 * Required files emit missing markers; optional files are omitted when absent.
 */
export function loadProfileBootstrapFiles(profileDir: string): WorkspaceBootstrapFile[] {
  const resolvedDir = resolve(profileDir);
  const result: WorkspaceBootstrapFile[] = [];

  for (const name of PROFILE_LOAD_ORDER) {
    const filePath = join(resolvedDir, name);

    const content = readProfileFile(filePath);
    if (content !== null) {
      result.push({ name, path: filePath, content, missing: false });
    } else if (REQUIRED_AGENT_PROFILE_MARKDOWN_FILE_SET.has(name)) {
      result.push({ name, path: filePath, missing: true });
    }
  }

  return result;
}
