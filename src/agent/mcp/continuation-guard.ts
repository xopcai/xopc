import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';

import { DurableState } from '../../storage/sqlite/durable-state.js';
import { findSessionInputByRunId } from '../../storage/sqlite/session-input-repository.js';
import { getSessionMetadata } from '../../storage/sqlite/session-read-repository.js';
import { getEmbeddedExecutionRunId } from '../embedded/execution-context.js';

/** Connecting alone does not authorize reading private MCP resources or invoking business tools. */
export function createMcpSetupContinuationGuard(conversationId: string, discoveryAvailable = false): ExtensionFactory {
  return pi => {
    if (discoveryAvailable) pi.on('tool_result', event => {
      if (event.isError) return;
      const content = event.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
      const empty = event.toolName === 'codemode' && /searchTools\s*\(/.test(JSON.stringify(event.input)) && /Output:\s*\[\]\s*$/.test(content)
        || event.toolName === 'tool_search' && /no (?:matching |relevant )?tools|0 tools/i.test(content);
      const runId = getEmbeddedExecutionRunId();
      const input = runId ? findSessionInputByRunId(conversationId, runId) : undefined;
      const goal = input?.clientMessageId.startsWith('mcp-setup:') ? new DurableState<{ serverId: string; phase: string }>('mcp.conversation-setup').get(input.clientMessageId.slice('mcp-setup:'.length)) : undefined;
      if (empty && goal?.phase === 'ready') return { content: [...event.content, { type: 'text' as const, text: `This is a saved connection continuation. Search tools using the exact namespace mcp__${goal.serverId.replace(/-/g, '_')}, then finish the original objective. Do not restart setup.` }] };
      if (empty) return { content: [...event.content, { type: 'text' as const, text: 'No registered tool matches this search. This is not evidence that the requested service cannot be connected. If the user clearly asked to connect a named service, call the available mcp_setup discover {serviceName,purpose} and read tool_manual topic mcp before reporting a blocker or asking for an MCP URL. Do not substitute a different saved service.' }] };
    });
    pi.on('tool_call', event => {
      if (!event.toolName.startsWith('mcp__') && !['read_mcp_resource', 'read_resource'].includes(event.toolName)) return;
      const runId = getEmbeddedExecutionRunId(); if (!runId) return;
      const input = findSessionInputByRunId(conversationId, runId);
      if (!input?.clientMessageId.startsWith('mcp-setup:')) return;
      const goal = new DurableState<{ conversationId: string; transcriptId: string; phase: string; objective?: string; serverId: string }>('mcp.conversation-setup').get(input.clientMessageId.slice('mcp-setup:'.length));
      if (!goal || goal.phase !== 'ready' || goal.transcriptId !== getSessionMetadata(conversationId)?.transcriptId) return { block: true, reason: 'MCP setup authorization changed. Return to the current conversation.' };
      if (goal.objective === 'connect_only') return { block: true, reason: 'The user requested connection only. Describe discovered capabilities without reading private data or invoking business tools.' };
      if (['read_mcp_resource', 'read_resource'].includes(event.toolName) && (event.input as Record<string, unknown>).server !== goal.serverId) return { block: true, reason: 'This continuation may read resources only from the newly connected MCP server.' };
      if (event.toolName.startsWith('mcp__') && !event.toolName.startsWith(`mcp__${goal.serverId.replace(/-/g, '_')}__`)) return { block: true, reason: `This continuation may use only the newly connected MCP server ${goal.serverId}. Discover that server's actual tools.` };
    });
  };
}
