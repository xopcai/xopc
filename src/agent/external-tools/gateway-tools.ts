import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { Type } from '@sinclair/typebox';

import { ExternalToolService } from './service.js';
import { EXTERNAL_TOOL_SOURCES, type ExternalToolProvider } from './types.js';

export const EXTERNAL_TOOL_NAMES = {
  search: 'xopc_tool_search',
  describe: 'xopc_tool_describe',
  execute: 'xopc_tool_execute',
} as const;

const ToolSearchSchema = Type.Object({
  query: Type.String({ description: 'Describe the capability or task you need.' }),
  sources: Type.Optional(Type.Array(Type.Union(EXTERNAL_TOOL_SOURCES.map((source) => Type.Literal(source))), {
    maxItems: EXTERNAL_TOOL_SOURCES.length,
    description: 'Optional external tool sources to search.',
  })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
});

const ToolDescribeSchema = Type.Object({
  toolRefs: Type.Array(Type.String(), {
    minItems: 1,
    maxItems: 3,
    description: 'Exact tool references returned by xopc_tool_search.',
  }),
});

const ToolExecuteSchema = Type.Object({
  toolRef: Type.String({ description: 'Exact tool reference returned by xopc_tool_search.' }),
  revision: Type.String({ description: 'Exact contract revision returned by xopc_tool_describe.' }),
  arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  approvalId: Type.Optional(Type.String({ description: 'One-time approval id when execution requested confirmation.' })),
});

function textResult(value: unknown, details: Record<string, unknown> = {}): AgentToolResult<Record<string, unknown>> {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    details,
  };
}

export function createExternalToolGatewayTools(providers: ExternalToolProvider[]): AgentTool[] {
  const service = new ExternalToolService(providers);
  const searchTool: AgentTool<typeof ToolSearchSchema, Record<string, unknown>> = {
    name: EXTERNAL_TOOL_NAMES.search,
    label: '🔎 External Tool Search',
    description: 'Search MCP, connected-app, extension, remote-memory, and current-endpoint tools. Use concise English capability keywords. Returns compact references only; call xopc_tool_describe before execution.',
    parameters: ToolSearchSchema,
    async execute(_toolCallId, params) {
      return textResult(await service.search(params));
    },
  };
  const describeTool: AgentTool<typeof ToolDescribeSchema, Record<string, unknown>> = {
    name: EXTERNAL_TOOL_NAMES.describe,
    label: '📋 External Tool Contract',
    description: 'Load exact contracts for up to three external tools returned by xopc_tool_search.',
    parameters: ToolDescribeSchema,
    async execute(_toolCallId, params) {
      return textResult(await service.describe(params.toolRefs));
    },
  };
  const executeTool: AgentTool<typeof ToolExecuteSchema, Record<string, unknown>> = {
    name: EXTERNAL_TOOL_NAMES.execute,
    label: '▶️ External Tool Execute',
    description: 'Execute one external tool using its exact reference, contract revision, and validated arguments.',
    parameters: ToolExecuteSchema,
    async execute(toolCallId, params, signal, onUpdate) {
      const result = await service.execute({
        ...params,
        context: { toolCallId, signal, onUpdate },
      });
      return {
        ...result,
        details: {
          ...(result.details ?? {}),
          delegatedToolRef: params.toolRef,
          delegatedToolRevision: params.revision,
        },
      };
    },
  };
  return [searchTool, describeTool, executeTool];
}
