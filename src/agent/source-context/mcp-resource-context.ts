import type { Config } from '../../config/schema.js';
import { readBundleMcpResourceForGateway } from '../mcp/bundle-mcp-gateway.js';
import type { AgentSourceContext } from './types.js';

const MAX_MCP_RESOURCE_CONTEXT_CHARS = 96_000;

export async function buildMcpResourceAgentContext(params: {
  workspaceDir: string;
  config: Config;
  sourceId: string;
  expectedVersion?: string;
}): Promise<AgentSourceContext | null> {
  const resolved = await readBundleMcpResourceForGateway({
    workspaceDir: params.workspaceDir,
    cfg: params.config,
    sourceId: params.sourceId,
  }).catch(() => null);
  if (!resolved || (params.expectedVersion && params.expectedVersion !== resolved.resource.version)) return null;
  const snapshot = resolved.contents.contents.map((content) => {
    if ('text' in content) return content.text;
    return JSON.stringify({ uri: content.uri, mimeType: content.mimeType, binary: true });
  }).join('\n\n');
  const text = snapshot.slice(0, MAX_MCP_RESOURCE_CONTEXT_CHARS);
  return {
    kind: 'mcp_resource',
    sourceId: params.sourceId,
    version: resolved.resource.version,
    title: resolved.resource.title || resolved.resource.name,
    text,
    truncated: text.length < snapshot.length,
  };
}
