import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';

import { createXopcUseTool, type XopcUseToolDeps } from './xopc-use-tool.js';

const schema = Type.Object({
  command: Type.Union(['discover', 'propose', 'select', 'repair', 'inspect', 'start', 'get', 'advance', 'cancel', 'set_enabled', 'remove'].map(value => Type.Literal(value))),
  args: Type.Optional(Type.Record(Type.String(), Type.Any(), { description:
    'For a service name use discover {serviceName,purpose}, then propose {discoveryId,expectedVersion,plan,evidence}, select {discoveryId,expectedVersion,candidateId}, start {planId,expectedPlanVersion,serverId,purpose}. Read tool_manual topic mcp for plan fields and evidence. Explicit-address start: {serverId,url,purpose,displayName?,authentication?:"auto"|"bearer"|"header"|"none",transport?:"streamable-http"|"sse",secretFields?,helpUrl?,objective?:"connect_only"|"complete_task",expectedRevision?}. stdio start uses transport:"stdio" and execution instead of url and requires owner review. get: {setupId}. advance/cancel: {setupId,expectedVersion}. Never include credential values.' })),
});

/** Small eager entry point; the existing product adapter owns authority and execution. */
export function createMcpSetupTool(deps: XopcUseToolDeps): AgentTool<typeof schema, Record<string, unknown>> {
  const product = createXopcUseTool(deps);
  return {
    name: 'mcp_setup', label: 'Connect MCP service', parameters: schema,
    description: 'Discover and configure a requested MCP service from its name or explicit address on the Gateway host. For a name, discover official integration references and preserve evidence; do not guess the URL or ask the user for technical configuration. Read tool_manual xopc_use topic mcp. Explicit localhost addresses remain supported. Only connect means objective connect_only; a requested task means complete_task. Token/OAuth uses the exact host interaction link, never chat input. stdio execution and unverified publishers require owner review. The host resumes the original objective after verification; tool counts are not business results.',
    execute: (id, params, signal, update) => product.execute(id, { mode: 'mcp_setup', command: params.command, args: params.args }, signal, update),
  };
}
