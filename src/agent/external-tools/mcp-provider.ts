import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { resolveEffectiveAgentProfileForSession } from '../../config/agent-profile.js';
import { connectorPrincipalForSession } from '../../connectors/principal.js';
import type { Config } from '../../config/schema.js';
import type { ExtensionHookRunner } from '../../extensions/index.js';
import { publishConnectionWait, requireSessionConnection } from '../../storage/sqlite/connection-wait-repository.js';
import { mcpToolPolicyId } from '../mcp/bundle-mcp-policy.js';
import { getOrCreateSessionMcpRuntime } from '../mcp/bundle-mcp-runtime.js';
import { isMcpAuthorizationError } from '../mcp/oauth/mcp-oauth-errors.js';
import { pluginMcpCandidateRef } from '../../extensions/agent-plugins/connection.js';
import type { McpCatalogTool, SessionMcpRuntime } from '../mcp/bundle-mcp-types.js';
import { externalToolRef, parseExternalToolRef } from './refs.js';
import type {
  ExternalToolDescriptor,
  ExternalConnectionCandidate,
  ExternalToolExecutionContext,
  ExternalToolProvider,
  ExternalToolSearchHit,
} from './types.js';

export interface McpToolProviderDeps {
  workspace: string;
  getConfig: () => Config | undefined;
  getConversationId: () => string | undefined;
  agentId?: string;
  hookRunner?: ExtensionHookRunner;
  getRuntime?: (params: {
    sessionId: string;
    conversationId?: string;
    workspaceDir: string;
    cfg?: Config;
  }) => Promise<SessionMcpRuntime>;
}

function policyToolId(tool: McpCatalogTool): string {
  return mcpToolPolicyId(tool.safeServerName, tool.toolName);
}

function toAgentToolResult(params: {
  serverName: string;
  toolName: string;
  result: CallToolResult;
}): AgentToolResult<Record<string, unknown>> {
  const content = Array.isArray(params.result.content)
    ? (params.result.content as AgentToolResult<Record<string, unknown>>['content'])
    : [];
  const normalizedContent = content.length > 0
    ? content
    : [{
        type: 'text' as const,
        text: JSON.stringify(
          params.result.structuredContent ?? {
            status: params.result.isError === true ? 'error' : 'ok',
            server: params.serverName,
            tool: params.toolName,
          },
          null,
          2,
        ),
      }];
  return {
    content: normalizedContent,
    details: {
      mcpServer: params.serverName,
      mcpTool: params.toolName,
      ...(params.result.structuredContent !== undefined
        ? { structuredContent: params.result.structuredContent }
        : {}),
      ...(params.result.isError === true ? { status: 'error' } : {}),
    },
  };
}

function hasAuthorizationChallenge(result: CallToolResult): boolean {
  const challenge = result._meta?.['mcp/www_authenticate'];
  return typeof challenge === 'string' || Array.isArray(challenge) && challenge.some(value => typeof value === 'string');
}

export class McpToolProvider implements ExternalToolProvider {
  readonly source = 'mcp' as const;

  constructor(private readonly deps: McpToolProviderDeps) {}

  async search(_query: string): Promise<ExternalToolSearchHit[]> {
    return this.withRuntime(async (runtime) => {
      const catalog = await runtime.getCatalog();
      return catalog.tools.filter((tool) => this.isAllowed(tool)).map((tool) => ({
        toolRef: externalToolRef(this.source, tool.safeServerName, tool.toolName),
        source: this.source,
        namespace: tool.safeServerName,
        title: tool.title || tool.toolName,
        summary: tool.description || tool.fallbackDescription,
      }));
    });
  }

  async connectionCandidates(query: string): Promise<ExternalConnectionCandidate[]> {
    return this.withRuntime(async (runtime) => {
      const catalog = await runtime.getCatalog();
      const normalizedQuery = query.toLocaleLowerCase();
      return Object.values(catalog.servers).flatMap(server => {
        if (!server.serverName.startsWith('plugin/') || server.error?.code !== 'MCP_AUTHORIZATION_REQUIRED') return [];
        const [, encodedPluginId, encodedServerName] = server.serverName.split('/');
        if (!encodedPluginId || !encodedServerName) return [];
        const pluginId = decodeURIComponent(encodedPluginId);
        const serverName = decodeURIComponent(encodedServerName);
        const searchable = `${pluginId} ${serverName}`.toLocaleLowerCase();
        const tokens = normalizedQuery.split(/[^\p{L}\p{N}_-]+/u).filter(token => token.length > 1);
        if (tokens.length && !tokens.some(token => searchable.includes(token))) return [];
        return [{
          candidateRef: pluginMcpCandidateRef(pluginId, serverName),
          source: this.source,
          label: pluginId,
          summary: `Connect ${pluginId}/${serverName}`,
          capabilities: [`mcp.tools:${server.serverName}`],
          reason: 'not_connected' as const,
        }];
      });
    });
  }

  async describe(toolRef: string): Promise<ExternalToolDescriptor | undefined> {
    return this.withRuntime(async (runtime) => {
      const tool = await this.resolve(runtime, toolRef);
      if (!tool) return undefined;
      const summary = tool.description || tool.fallbackDescription;
      return {
        toolRef,
        source: this.source,
        namespace: tool.serverName,
        title: tool.title || tool.toolName,
        summary,
        description: summary,
        inputSchema: tool.inputSchema as Record<string, unknown>,
      };
    });
  }

  async execute(
    toolRef: string,
    args: Record<string, unknown>,
    _approvalId: string | undefined,
    context: ExternalToolExecutionContext,
  ) {
    return this.withRuntime(async (runtime) => {
      const tool = await this.resolve(runtime, toolRef);
      if (!tool) throw new Error(`MCP tool is unavailable or denied: ${toolRef}`);
      let executionArgs = args;
      if (this.deps.hookRunner) {
        const hook = await this.deps.hookRunner.runBeforeToolCall(
          policyToolId(tool),
          args,
          {
            conversationId: this.deps.getConversationId(),
            isMcpTool: true,
            mcpServerId: tool.serverName,
          },
        );
        if (!hook.allowed) throw new Error(hook.reason ?? 'MCP tool call blocked by policy hook.');
        executionArgs = hook.params ?? args;
      }
      try {
        const result = await runtime.callTool(tool.serverName, tool.toolName, executionArgs, this.executionSignal(tool, context.signal));
        if (tool.serverName.startsWith('plugin/') && hasAuthorizationChallenge(result)) {
          return this.requestConnection(tool.serverName, tool.toolName);
        }
        return toAgentToolResult({ serverName: tool.serverName, toolName: tool.toolName, result });
      } catch (error) {
        if (tool.serverName.startsWith('plugin/') && (isMcpAuthorizationError(error) || (error as { code?: number })?.code === 401)) {
          return this.requestConnection(tool.serverName, tool.toolName);
        }
        throw error;
      }
    });
  }

  private requestConnection(serverId: string, toolName: string): AgentToolResult<Record<string, unknown>> {
    const [, encodedPluginId, encodedServerName] = serverId.split('/');
    const conversationId = this.deps.getConversationId();
    if (!encodedPluginId || !encodedServerName || !conversationId) {
      return { content: [{ type: 'text', text: 'This MCP tool requires an account connection in xopc.' }],
        details: { status: 'connection_required' } };
    }
    const pluginId = decodeURIComponent(encodedPluginId);
    const serverName = decodeURIComponent(encodedServerName);
    const principal = connectorPrincipalForSession(conversationId);
    if (!principal.isLocalOwner) {
      return { content: [{ type: 'text', text: 'This MCP connection must be completed by the xopc owner.' }],
        details: { status: 'connection_required' } };
    }
    const result = requireSessionConnection({ conversationId, principalId: principal.principalId,
      agentId: principal.agentId ?? this.deps.agentId ?? 'main', summary: `Continue ${toolName} using ${pluginId}`,
      needs: [{ key: serverId, target: { type: 'plugin-mcp', pluginId, serverId, serverName }, label: pluginId,
        capabilities: [`mcp.tool:${serverId}:${toolName}`] }] });
    publishConnectionWait(conversationId);
    return { content: [{ type: 'text', text: 'Account connection required. The objective is preserved in xopc.' }], details: result };
  }

  private async resolve(runtime: SessionMcpRuntime, toolRef: string): Promise<McpCatalogTool | undefined> {
    const parsed = parseExternalToolRef(toolRef, this.source);
    if (!parsed) return undefined;
    const catalog = await runtime.getCatalog();
    const tool = catalog.tools.find((candidate) => (
      candidate.safeServerName === parsed.namespace && candidate.toolName === parsed.toolName
    ));
    return tool && this.isAllowed(tool) ? tool : undefined;
  }

  private isAllowed(tool: McpCatalogTool): boolean {
    const cfg = this.deps.getConfig();
    const conversationId = this.deps.getConversationId();
    const profile = cfg && conversationId
      ? resolveEffectiveAgentProfileForSession(conversationId)
      : undefined;
    const policyName = policyToolId(tool);
    return !profile?.tools.denied.has(policyName);
  }

  private executionSignal(tool: McpCatalogTool, signal: AbortSignal | undefined): AbortSignal | undefined {
    const cfg = this.deps.getConfig();
    const conversationId = this.deps.getConversationId();
    const profile = cfg && conversationId
      ? resolveEffectiveAgentProfileForSession(conversationId)
      : undefined;
    const timeoutMs = profile?.config.tools[policyToolId(tool)]?.timeoutMs;
    if (!timeoutMs) return signal;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  }

  private async withRuntime<T>(run: (runtime: SessionMcpRuntime) => Promise<T>): Promise<T> {
    const cfg = this.deps.getConfig();
    const conversationId = this.deps.getConversationId();
    const sessionId = conversationId ?? `agent:${this.deps.agentId ?? 'main'}`;
    const runtime = await (this.deps.getRuntime ?? getOrCreateSessionMcpRuntime)({
      sessionId,
      conversationId,
      workspaceDir: this.deps.workspace,
      cfg,
    });
    const releaseLease = runtime.acquireLease?.();
    runtime.markUsed();
    try {
      return await run(runtime);
    } finally {
      releaseLease?.();
    }
  }
}
