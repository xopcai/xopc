import crypto from 'node:crypto';

import type { Config } from '../../config/schema.js';
import { mcpToolPolicyId } from './bundle-mcp-policy.js';
import { createSessionMcpRuntime } from './bundle-mcp-runtime.js';
import type {
  McpCatalogPrompt,
  McpCatalogResource,
  McpCatalogTool,
  McpToolCatalog,
} from './bundle-mcp-types.js';

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

function mapTools(tools: McpCatalogTool[], serverId: string): McpGatewayToolEntry[] {
  return tools.filter((tool) => tool.serverName === serverId).map((tool) => ({
    name: mcpToolPolicyId(tool.safeServerName, tool.toolName),
    shortName: tool.toolName,
    description: tool.description || tool.title || tool.fallbackDescription,
  }));
}

function mapResources(
  resources: McpCatalogResource[],
  serverId: string,
): McpGatewayResourceEntry[] {
  return resources.filter((resource) => resource.serverName === serverId).map((resource) => ({
    uri: resource.uri,
    name: resource.name,
    title: resource.title,
    description: resource.description,
    mimeType: resource.mimeType,
  }));
}

function mapPrompts(prompts: McpCatalogPrompt[], serverId: string): McpGatewayPromptEntry[] {
  return prompts.filter((prompt) => prompt.serverName === serverId).map((prompt) => ({
    name: prompt.name,
    title: prompt.title,
    description: prompt.description,
    argumentCount: prompt.argumentCount,
  }));
}

async function loadCatalog(params: {
  workspaceDir: string;
  cfg?: Config;
}): Promise<McpToolCatalog> {
  const runtime = createSessionMcpRuntime({
    sessionId: `mcp-gateway:${crypto.randomUUID()}`,
    workspaceDir: params.workspaceDir,
    cfg: params.cfg,
  });
  try {
    return await runtime.getCatalog();
  } finally {
    await runtime.dispose();
  }
}

export async function listBundleMcpServerToolsForGateway(params: {
  workspaceDir: string;
  cfg?: Config;
  serverId: string;
}): Promise<McpGatewayToolEntry[]> {
  const catalog = await loadCatalog(params);
  return mapTools(catalog.tools, params.serverId);
}

export async function listBundleMcpServerCapabilitiesForGateway(params: {
  workspaceDir: string;
  cfg?: Config;
  serverId: string;
}): Promise<McpGatewayCapabilitySummary> {
  const catalog = await loadCatalog(params);
  const tools = mapTools(catalog.tools, params.serverId);
  const resources = mapResources(catalog.resources, params.serverId);
  const prompts = mapPrompts(catalog.prompts, params.serverId);
  return {
    serverId: params.serverId,
    toolCount: tools.length,
    resourceCount: resources.length,
    promptCount: prompts.length,
    tools,
    resources,
    prompts,
  };
}
