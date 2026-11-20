import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CapabilityDescriptor } from '@xopcai/gateway-contract';

import { PACKAGE_VERSION } from '../package-version.js';
import { MCP_BRIDGE_PATH } from './connection-grants.js';
import { GatewayHttpError, type GatewayHttpClient } from './gateway-http-client.js';
import { describeTool, parseToolArguments, toolFailure, toolName, toolResult } from './tool-contract.js';

export function createCapabilityMcpServer(client: Pick<GatewayHttpClient, 'getJson' | 'postJson'>): Server {
  const server = new Server({ name: 'xopc-gateway', version: PACKAGE_VERSION }, {
    capabilities: { tools: {} },
    instructions: 'Use list tools to look up stable IDs, then get tools for details. Writes need an idempotencyKey per intent. Retry uncertain writes with the same arguments and key.',
  });
  const catalog = async (signal: AbortSignal) => {
    const result = await client.getJson<{ capabilities: CapabilityDescriptor[] }>(MCP_BRIDGE_PATH, signal);
    return result.capabilities.filter(item => item.surfaces.includes('mcp'));
  };
  let discovered = new Map<string, string>();
  server.setRequestHandler(ListToolsRequestSchema, async (_request, { signal }) => {
    const items = await catalog(signal);
    discovered = new Map(items.map(item => [item.id, item.descriptorDigest]));
    return { tools: items.map(describeTool) };
  });
  server.setRequestHandler(CallToolRequestSchema, async ({ params }, { signal }) => {
    let writeDispatched = false;
    try {
      const item = (await catalog(signal)).find(tool => toolName(tool.id) === params.name);
      if (!item) return toolFailure('FORBIDDEN');
      const previous = discovered.get(item.id);
      if (previous && previous !== item.descriptorDigest) return toolFailure('CONTRACT_CHANGED');
      const args = parseToolArguments(item, params.arguments);
      if (!args) return toolFailure('INVALID_INPUT');
      writeDispatched = item.effect !== 'read';
      const { data } = await client.postJson<{ data: Record<string, unknown> }>(MCP_BRIDGE_PATH, {
        capability: item.id, majorVersion: item.majorVersion, descriptorDigest: item.descriptorDigest,
        ...args,
      }, signal);
      return toolResult(data);
    } catch (error) {
      if (error instanceof GatewayHttpError) {
        const code = error.code ?? ((error.status === 401 || error.status === 403) ? 'FORBIDDEN'
          : (error.status === 400 || error.status === 413) ? 'INVALID_INPUT'
          : writeDispatched && error.status !== 429 ? 'OUTCOME_UNKNOWN' : 'UNAVAILABLE');
        return toolFailure(code, error.operationId);
      }
      return toolFailure(writeDispatched ? 'OUTCOME_UNKNOWN' : signal.aborted ? 'CANCELLED' : 'UNAVAILABLE');
    }
  });
  return server;
}
