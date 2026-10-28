import { isXopcDatabaseOpen } from '../../storage/sqlite/connection.js';
import { findSessionInputByRunId } from '../../storage/sqlite/session-input-repository.js';

/** Only host-created MCP setup inputs may become hidden continuation context. */
export function getMcpSetupResumeInput(conversationId: string, runId: string) {
  if (!isXopcDatabaseOpen()) return undefined;
  const input = findSessionInputByRunId(conversationId, runId);
  return input?.origin.type === 'system' && input.origin.source === 'internal'
    && input.clientMessageId.startsWith('mcp-setup:')
    ? { content: input.content } : undefined;
}
