import crypto from "node:crypto";
import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import type { AgentTool as AnyAgentTool } from "@earendil-works/pi-agent-core";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../../config/schema.js";
import { createLogger } from "../../utils/logger.js";
const log = createLogger("Mcp:Bundle");
import { setPluginToolMeta } from "./mcp-tool-meta.js";
import {
  normalizeLowercaseStringOrEmpty,
  normalizeOptionalString,
} from "../../utils/string-coerce.js";
import {
  buildSafeToolName,
  normalizeReservedToolNames,
  TOOL_NAME_SEPARATOR,
} from "./bundle-mcp-names.js";
import type { BundleMcpToolRuntime, SessionMcpRuntime } from "./bundle-mcp-types.js";
import type { McpCatalogPrompt, McpCatalogResource } from "./bundle-mcp-types.js";

export type McpGatewayToolEntry = {
  name: string;
  shortName: string;
  description: string;
};

export type McpGatewayResourceEntry = {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
};

export type McpGatewayPromptEntry = {
  name: string;
  title?: string;
  description?: string;
  argumentCount: number;
};

export type McpGatewayCapabilitySummary = {
  serverId: string;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  tools: McpGatewayToolEntry[];
  resources: McpGatewayResourceEntry[];
  prompts: McpGatewayPromptEntry[];
};

function readMaterializedToolDescription(tool: AnyAgentTool): string {
  const raw = tool as { description?: unknown; label?: unknown };
  return (
    normalizeOptionalString(raw.description) ??
    normalizeOptionalString(raw.label) ??
    tool.name
  );
}

export function mapBundleMcpToolsForGateway(
  tools: AnyAgentTool[],
  serverId: string,
): McpGatewayToolEntry[] {
  const prefix = `${serverId.trim()}${TOOL_NAME_SEPARATOR}`;
  return tools
    .filter((tool) => tool.name.startsWith(prefix))
    .map((tool) => ({
      name: tool.name,
      shortName: tool.name.slice(prefix.length),
      description: readMaterializedToolDescription(tool),
    }));
}

export async function listBundleMcpServerToolsForGateway(params: {
  workspaceDir: string;
  cfg?: Config;
  serverId: string;
}): Promise<McpGatewayToolEntry[]> {
  const runtime = await createBundleMcpToolRuntime({
    workspaceDir: params.workspaceDir,
    cfg: params.cfg,
  });
  try {
    return mapBundleMcpToolsForGateway(runtime.tools, params.serverId);
  } finally {
    await runtime.dispose();
  }
}

function mapBundleMcpResourcesForGateway(
  resources: McpCatalogResource[],
  serverId: string,
): McpGatewayResourceEntry[] {
  return resources
    .filter((resource) => resource.serverName === serverId)
    .map((resource) => ({
      uri: resource.uri,
      name: resource.name,
      title: resource.title,
      description: resource.description,
      mimeType: resource.mimeType,
    }));
}

function mapBundleMcpPromptsForGateway(
  prompts: McpCatalogPrompt[],
  serverId: string,
): McpGatewayPromptEntry[] {
  return prompts
    .filter((prompt) => prompt.serverName === serverId)
    .map((prompt) => ({
      name: prompt.name,
      title: prompt.title,
      description: prompt.description,
      argumentCount: prompt.argumentCount,
    }));
}

export async function listBundleMcpServerCapabilitiesForGateway(params: {
  workspaceDir: string;
  cfg?: Config;
  serverId: string;
}): Promise<McpGatewayCapabilitySummary> {
  const createRuntime =
    (await import("./bundle-mcp-runtime.js")).createSessionMcpRuntime;
  const runtime = createRuntime({
    sessionId: `bundle-mcp:${crypto.randomUUID()}`,
    workspaceDir: params.workspaceDir,
    cfg: params.cfg,
  });
  try {
    const catalog = await runtime.getCatalog();
    const tools = mapBundleMcpToolsForGateway(
      await materializeBundleMcpToolsForRun({ runtime }).then(async (toolRuntime) => {
        try {
          return toolRuntime.tools;
        } finally {
          await toolRuntime.dispose();
        }
      }),
      params.serverId,
    );
    const resources = mapBundleMcpResourcesForGateway(catalog.resources, params.serverId);
    const prompts = mapBundleMcpPromptsForGateway(catalog.prompts, params.serverId);
    return {
      serverId: params.serverId,
      toolCount: tools.length,
      resourceCount: resources.length,
      promptCount: prompts.length,
      tools,
      resources,
      prompts,
    };
  } finally {
    await runtime.dispose();
  }
}

function toAgentToolResult(params: {
  serverName: string;
  toolName: string;
  result: CallToolResult;
}): AgentToolResult<unknown> {
  const content = Array.isArray(params.result.content)
    ? (params.result.content as AgentToolResult<unknown>["content"])
    : [];
  const normalizedContent: AgentToolResult<unknown>["content"] =
    content.length > 0
      ? content
      : params.result.structuredContent !== undefined
        ? [
            {
              type: "text",
              text: JSON.stringify(params.result.structuredContent, null, 2),
            },
          ]
        : ([
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: params.result.isError === true ? "error" : "ok",
                  server: params.serverName,
                  tool: params.toolName,
                },
                null,
                2,
              ),
            },
          ] as AgentToolResult<unknown>["content"]);
  const details: Record<string, unknown> = {
    mcpServer: params.serverName,
    mcpTool: params.toolName,
  };
  if (params.result.structuredContent !== undefined) {
    details.structuredContent = params.result.structuredContent;
  }
  if (params.result.isError === true) {
    details.status = "error";
  }
  return {
    content: normalizedContent,
    details,
  };
}

export async function materializeBundleMcpToolsForRun(params: {
  runtime: SessionMcpRuntime;
  reservedToolNames?: Iterable<string>;
  disposeRuntime?: () => Promise<void>;
}): Promise<BundleMcpToolRuntime> {
  let disposed = false;
  const releaseLease = params.runtime.acquireLease?.();
  params.runtime.markUsed();
  let catalog;
  try {
    catalog = await params.runtime.getCatalog();
  } catch (error) {
    releaseLease?.();
    throw error;
  }
  const reservedNames = normalizeReservedToolNames(params.reservedToolNames);
  const tools: BundleMcpToolRuntime["tools"] = [];
  const sortedCatalogTools = [...catalog.tools].toSorted((a, b) => {
    const serverOrder = a.safeServerName.localeCompare(b.safeServerName);
    if (serverOrder !== 0) {
      return serverOrder;
    }
    const toolOrder = a.toolName.localeCompare(b.toolName);
    if (toolOrder !== 0) {
      return toolOrder;
    }
    return a.serverName.localeCompare(b.serverName);
  });

  for (const tool of sortedCatalogTools) {
    const originalName = tool.toolName.trim();
    if (!originalName) {
      continue;
    }
    const safeToolName = buildSafeToolName({
      serverName: tool.safeServerName,
      toolName: originalName,
      reservedNames,
    });
    if (safeToolName !== `${tool.safeServerName}${TOOL_NAME_SEPARATOR}${originalName}`) {
      log.warn(
        `bundle-mcp: tool "${tool.toolName}" from server "${tool.serverName}" registered as "${safeToolName}" to keep the tool name provider-safe.`,
      );
    }
    reservedNames.add(normalizeLowercaseStringOrEmpty(safeToolName));
    const agentTool = {
      name: safeToolName,
      label: tool.title ?? tool.toolName,
      description: tool.description || tool.title || tool.fallbackDescription,
      parameters: tool.inputSchema,
      execute: async (_toolCallId: string, input: unknown, signal?: AbortSignal) => {
        params.runtime.markUsed();
        const result = await params.runtime.callTool(tool.serverName, tool.toolName, input, signal);
        return toAgentToolResult({
          serverName: tool.serverName,
          toolName: tool.toolName,
          result,
        });
      },
    } as unknown as AnyAgentTool;
    setPluginToolMeta(agentTool, {
      pluginId: "bundle-mcp",
      optional: false,
    });
    tools.push(agentTool);
  }

  // Sort tools deterministically by name so the tools block in API requests is stable across
  // turns (defensive — listTools() order is usually stable but not guaranteed).
  // Cannot fix name collisions: collision suffixes above are order-dependent.
  tools.sort((a, b) => a.name.localeCompare(b.name));

  return {
    tools,
    dispose: async () => {
      if (disposed) {
        return;
      }
      disposed = true;
      releaseLease?.();
      await params.disposeRuntime?.();
    },
  };
}

export async function createBundleMcpToolRuntime(params: {
  workspaceDir: string;
  cfg?: Config;
  reservedToolNames?: Iterable<string>;
  createRuntime?: (params: {
    sessionId: string;
    workspaceDir: string;
    cfg?: Config;
  }) => SessionMcpRuntime;
}): Promise<BundleMcpToolRuntime> {
  const createRuntime =
    params.createRuntime ?? (await import("./bundle-mcp-runtime.js")).createSessionMcpRuntime;
  const runtime = createRuntime({
    sessionId: `bundle-mcp:${crypto.randomUUID()}`,
    workspaceDir: params.workspaceDir,
    cfg: params.cfg,
  });
  const materialized = await materializeBundleMcpToolsForRun({
    runtime,
    reservedToolNames: params.reservedToolNames,
    disposeRuntime: async () => {
      await runtime.dispose();
    },
  });
  return materialized;
}
