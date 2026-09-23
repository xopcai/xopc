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
import { decodeMcpResourceId, encodeMcpResourceId } from './mcp-resource-id.js';

export type McpGatewayToolEntry = {
  name: string;
  shortName: string;
  description: string;
  readOnly: boolean;
};

export type McpGatewayResourceEntry = {
  id: string;
  version: string;
  serverId: string;
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
  error?: import('./bundle-mcp-types.js').McpServerCatalog['error'];
};

function mapTools(tools: McpCatalogTool[], serverId: string): McpGatewayToolEntry[] {
  return tools.filter((tool) => tool.serverName === serverId).map((tool) => ({
    name: mcpToolPolicyId(tool.safeServerName, tool.toolName),
    shortName: tool.toolName,
    description: tool.description || tool.title || tool.fallbackDescription,
    readOnly: tool.annotations?.readOnlyHint === true,
  }));
}

function mapResources(
  resources: McpCatalogResource[],
  serverId: string,
): McpGatewayResourceEntry[] {
  return resources.filter((resource) => resource.serverName === serverId).map((resource) => ({
    id: encodeMcpResourceId({ serverId: resource.serverName, uri: resource.uri }),
    version: crypto.createHash('sha256').update(JSON.stringify(resource)).digest('hex'),
    serverId: resource.serverName,
    uri: resource.uri,
    name: resource.name,
    title: resource.title,
    description: resource.description,
    mimeType: resource.mimeType,
  }));
}

export async function listBundleMcpResourcesForGateway(params: {
  workspaceDir: string;
  cfg?: Config;
}): Promise<McpGatewayResourceEntry[]> {
  const catalog = await loadCatalog(params);
  return Object.keys(catalog.servers).sort().flatMap((serverId) => mapResources(catalog.resources, serverId));
}

export async function readBundleMcpResourceForGateway(params: {
  workspaceDir: string;
  cfg?: Config;
  sourceId: string;
}) {
  const identity = decodeMcpResourceId(params.sourceId);
  if (!identity) throw new Error('Invalid MCP resource id');
  const runtime = createSessionMcpRuntime({
    sessionId: `mcp-resource:${crypto.randomUUID()}`,
    workspaceDir: params.workspaceDir,
    cfg: params.cfg,
  });
  try {
    const catalog = await runtime.getCatalog();
    const resource = catalog.resources.find((item) => item.serverName === identity.serverId && item.uri === identity.uri);
    if (!resource) throw new Error('MCP resource is unavailable');
    const contents = await runtime.readResource(identity.serverId, identity.uri);
    return {
      resource: mapResources([resource], identity.serverId)[0]!,
      contents,
    };
  } finally {
    await runtime.dispose();
  }
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
    error: catalog.servers[params.serverId]?.error,
    toolCount: tools.length,
    resourceCount: resources.length,
    promptCount: prompts.length,
    tools,
    resources,
    prompts,
  };
}
