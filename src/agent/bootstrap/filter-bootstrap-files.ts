import { isCronConversationId, isSubagentConversationId } from '../../routing/session-key.js';
import {
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
} from '../context/workspace.js';
import type { WorkspaceBootstrapFile } from './types.js';

const MINIMAL_BOOTSTRAP_ALLOWLIST = new Set<string>([
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
]);

/** Subagent and cron sessions load only the minimal identity and instruction profile. */
export function filterBootstrapFilesForSession(
  files: WorkspaceBootstrapFile[],
  conversationId?: string,
): WorkspaceBootstrapFile[] {
  if (!conversationId || (!isSubagentConversationId(conversationId) && !isCronConversationId(conversationId))) {
    return files;
  }
  return files.filter((file) => MINIMAL_BOOTSTRAP_ALLOWLIST.has(file.name));
}
