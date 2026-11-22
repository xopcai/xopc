import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  CancelTaskRequestSchema,
  GetPromptRequestSchema,
  GetTaskPayloadRequestSchema,
  GetTaskRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListTasksRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { CapabilityDescriptor } from '@xopcai/gateway-contract';

import { PACKAGE_VERSION } from '../package-version.js';
import { MCP_BRIDGE_PATH } from './connection-grants.js';
import { GatewayHttpError, type GatewayHttpClient } from './gateway-http-client.js';
import {
  describeTool, MCP_SERVER_INSTRUCTIONS, parseToolArguments, toolFailure, toolName, toolResult,
} from './tool-contract.js';

export function createCapabilityMcpServer(client: Pick<GatewayHttpClient, 'getJson' | 'postJson'>): Server {
  const server = new Server({ name: 'xopc-gateway', version: PACKAGE_VERSION }, {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
      tasks: { list: {}, cancel: {} },
    },
    instructions: MCP_SERVER_INSTRUCTIONS,
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
      if (previous && previous !== item.descriptorDigest) {
        return toolFailure('CONTRACT_CHANGED', undefined, 'Tool schema changed; call tools/list to refresh.');
      }
      const args = parseToolArguments(item, params.arguments);
      if (!args) {
        return toolFailure('INVALID_INPUT', undefined, item.effect === 'read'
          ? 'Read tools do not accept idempotencyKey.'
          : 'Write tools require a non-empty string idempotencyKey.');
      }
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
        return toolFailure(code, error.operationId, error.hint);
      }
      return toolFailure(writeDispatched ? 'OUTCOME_UNKNOWN' : signal.aborted ? 'CANCELLED' : 'UNAVAILABLE');
    }
  });

  const bridgeAction = async <T>(payload: Record<string, unknown>, signal: AbortSignal): Promise<T> => {
    const { data } = await client.postJson<{ data: T }>(MCP_BRIDGE_PATH, payload, signal);
    return data;
  };

  server.setRequestHandler(ListResourcesRequestSchema, async (_req, { signal }) =>
    bridgeAction({ bridgeAction: 'resources/list' }, signal),
  );
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async (_req, { signal }) =>
    bridgeAction({ bridgeAction: 'resources/templates/list' }, signal),
  );
  server.setRequestHandler(ReadResourceRequestSchema, async ({ params }, { signal }) =>
    bridgeAction({ bridgeAction: 'resources/read', uri: params.uri }, signal),
  );
  server.setRequestHandler(ListPromptsRequestSchema, async (_req, { signal }) =>
    bridgeAction({ bridgeAction: 'prompts/list' }, signal),
  );
  server.setRequestHandler(GetPromptRequestSchema, async ({ params }, { signal }) =>
    bridgeAction({ bridgeAction: 'prompts/get', name: params.name, ...(params.arguments ? { arguments: params.arguments } : {}) }, signal),
  );
  server.setRequestHandler(ListTasksRequestSchema, async ({ params }, { signal }) =>
    bridgeAction({ bridgeAction: 'tasks/list', ...(params?.cursor ? { cursor: params.cursor } : {}) }, signal),
  );
  server.setRequestHandler(GetTaskRequestSchema, async ({ params }, { signal }) =>
    bridgeAction({ bridgeAction: 'tasks/get', taskId: params.taskId }, signal),
  );
  server.setRequestHandler(GetTaskPayloadRequestSchema, async ({ params }, { signal }) =>
    bridgeAction({ bridgeAction: 'tasks/result', taskId: params.taskId }, signal),
  );
  server.setRequestHandler(CancelTaskRequestSchema, async ({ params }, { signal }) =>
    bridgeAction({ bridgeAction: 'tasks/cancel', taskId: params.taskId }, signal),
  );

  return server;
}
