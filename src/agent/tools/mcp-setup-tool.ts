import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';

import { createXopcUseTool, type XopcUseToolDeps } from './xopc-use-tool.js';

const schema = Type.Object({
  command: Type.Union(['inspect', 'start', 'get', 'advance', 'cancel', 'set_enabled', 'remove'].map(value => Type.Literal(value))),
  args: Type.Optional(Type.Record(Type.String(), Type.Any(), { description:
    'inspect: {}. start: {serverId,url,purpose,displayName?,expectedRevision?}; derive an ASCII serverId if the user gave none. get: {setupId}. advance/cancel: {setupId,expectedVersion}. set_enabled/remove: {serverId,expectedRevision,enabled?}. Never include credentials.' })),
});

/** Small eager entry point; the existing product adapter owns authority and execution. */
export function createMcpSetupTool(deps: XopcUseToolDeps): AgentTool<typeof schema, Record<string, unknown>> {
  const product = createXopcUseTool(deps);
  return {
    name: 'mcp_setup', label: 'Connect MCP service', parameters: schema,
    description: 'Configure a user-requested HTTP MCP service on the Gateway host, including user-provided localhost/127.0.0.1 addresses. Probe before claiming an address is unreachable. A clear request authorizes that specific local connection/change/removal; do not ask again. In a paired Weixin private chat, start proposes a specific owner-approved connection; global inspect is unavailable there. Otherwise inspect existing connections; start then advance with the returned version. Token/OAuth uses the trusted interactionPath, never chat input. The host resumes the original objective when ready. Read tool_manual xopc_use topic mcp for details. Connection success is not a business read.',
    execute: (id, params, signal, update) => product.execute(id, { mode: 'mcp_setup', command: params.command, args: params.args }, signal, update),
  };
}
