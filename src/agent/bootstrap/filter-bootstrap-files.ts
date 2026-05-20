import { isCronSessionKey, isSubagentSessionKey } from '../../routing/session-key.js';
import {
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_USER_FILENAME,
} from '../context/workspace.js';
import type { WorkspaceBootstrapFile } from './types.js';

const MINIMAL_BOOTSTRAP_ALLOWLIST = new Set<string>([
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_USER_FILENAME,
]);

/** Subagent and cron sessions omit MEMORY.md and other heavy profile files. */
export function filterBootstrapFilesForSession(
  files: WorkspaceBootstrapFile[],
  sessionKey?: string,
): WorkspaceBootstrapFile[] {
  if (!sessionKey || (!isSubagentSessionKey(sessionKey) && !isCronSessionKey(sessionKey))) {
    return files;
  }
  return files.filter((file) => MINIMAL_BOOTSTRAP_ALLOWLIST.has(file.name));
}
