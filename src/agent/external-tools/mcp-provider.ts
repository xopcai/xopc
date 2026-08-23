import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { resolveEffectiveAgentProfileForSession } from '../../config/agent-profile.js';
import type { Config } from '../../config/schema.js';
import type { ExtensionHookRunner } from '../../extensions/index.js';
import { isMcpCatalogToolDenied, mcpToolPolicyId, resolveMcpToolPolicy } from '../mcp/bundle-mcp-policy.js';
import { getOrCreateSessionMcpRuntime } from '../mcp/bundle-mcp-runtime.js';
import type { McpCatalogTool, SessionMcpRuntime } from '../mcp/bundle-mcp-types.js';
import { externalToolRef, parseExternalToolRef } from './refs.js';
import type {
  ExternalToolDescriptor,
  ExternalToolExecutionContext,
  ExternalToolProvider,
  ExternalToolSearchHit,
} from './types.js';

export interface McpToolProviderDeps {
  workspace: string;
  getConfig: () => Config | undefined;
  getSessionKey: () => string | undefined;
  agentId?: string;
  hookRunner?: ExtensionHookRunner;
  getRuntime?: (params: {
    sessionId: string;
    sessionKey?: string;
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
            sessionKey: this.deps.getSessionKey(),
            isMcpTool: true,
            mcpServerId: tool.serverName,
          },
        );
        if (!hook.allowed) throw new Error(hook.reason ?? 'MCP tool call blocked by policy hook.');
        executionArgs = hook.params ?? args;
      }
      const result = await runtime.callTool(
        tool.serverName,
        tool.toolName,
        executionArgs,
        this.executionSignal(tool, context.signal),
      );
      return toAgentToolResult({ serverName: tool.serverName, toolName: tool.toolName, result });
    });
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
    const sessionKey = this.deps.getSessionKey();
    const profile = cfg && sessionKey
      ? resolveEffectiveAgentProfileForSession(cfg, sessionKey)
      : undefined;
    const policyName = policyToolId(tool);
    const policy = resolveMcpToolPolicy(
      { serverId: tool.safeServerName, policyToolId: policyName },
      profile?.manifest.tools.mcp,
    );
    return !(policy?.scope === 'readonly' && tool.annotations?.readOnlyHint !== true)
      && !profile?.tools.denied.has(policyName)
      && !isMcpCatalogToolDenied(
        { serverId: tool.safeServerName, policyToolId: policyName },
        profile?.manifest.tools.mcp,
      );
  }

  private executionSignal(tool: McpCatalogTool, signal: AbortSignal | undefined): AbortSignal | undefined {
    const cfg = this.deps.getConfig();
    const sessionKey = this.deps.getSessionKey();
    const profile = cfg && sessionKey
      ? resolveEffectiveAgentProfileForSession(cfg, sessionKey)
      : undefined;
    const timeoutMs = resolveMcpToolPolicy(
      { serverId: tool.safeServerName, policyToolId: policyToolId(tool) },
      profile?.manifest.tools.mcp,
    )?.limits?.timeoutMs;
    if (!timeoutMs) return signal;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  }

  private async withRuntime<T>(run: (runtime: SessionMcpRuntime) => Promise<T>): Promise<T> {
    const cfg = this.deps.getConfig();
    const sessionKey = this.deps.getSessionKey();
    const sessionId = sessionKey ?? `agent:${this.deps.agentId ?? 'main'}`;
    const runtime = await (this.deps.getRuntime ?? getOrCreateSessionMcpRuntime)({
      sessionId,
      sessionKey,
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
