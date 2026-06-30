import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { Config } from '../../config/schema.js';
import { resolveEffectiveAgentProfileForSession } from '../../config/agent-profile.js';
import {
  getOrCreateSessionMcpRuntime,
  materializeBundleMcpToolsForRun,
} from './bundle-mcp-tools.js';
import { shouldCreateBundleMcpRuntimeForAttempt } from './bundle-mcp-policy.js';
import type { BundleMcpToolRuntime } from './bundle-mcp-types.js';

export type ResolvedEmbeddedMcpTools = {
  tools: AgentTool[];
  dispose: () => Promise<void>;
};

export async function resolveEmbeddedMcpToolsForTurn(params: {
  sessionKey: string;
  workspaceDir: string;
  cfg?: Config;
  baseTools: AgentTool[];
  cleanupOnTurnEnd?: boolean;
}): Promise<ResolvedEmbeddedMcpTools> {
  const profile = params.cfg
    ? resolveEffectiveAgentProfileForSession(params.cfg, params.sessionKey)
    : undefined;
  const disabledTools = profile?.tools.denied;

  if (
    !shouldCreateBundleMcpRuntimeForAttempt({
      cfg: params.cfg,
      disabledTools,
    })
  ) {
    return { tools: [], dispose: async () => {} };
  }

  const reserved = new Set(params.baseTools.map((t) => t.name));
  const runtime = await getOrCreateSessionMcpRuntime({
    sessionId: params.sessionKey,
    sessionKey: params.sessionKey,
    workspaceDir: params.workspaceDir,
    cfg: params.cfg,
  });

  let materialized: BundleMcpToolRuntime;
  try {
    materialized = await materializeBundleMcpToolsForRun({
      runtime,
      reservedToolNames: reserved,
      disposeRuntime: params.cleanupOnTurnEnd
        ? async () => {
            await runtime.dispose();
          }
        : undefined,
    });
  } catch (error) {
    await runtime.dispose().catch(() => {});
    throw error;
  }

  const filtered = materialized.tools.filter((tool) => {
    if (disabledTools?.has(tool.name)) {
      return false;
    }
    return true;
  });

  return {
    tools: filtered,
    dispose: materialized.dispose,
  };
}

export function mergeTurnTools(baseTools: AgentTool[], mcpTools: AgentTool[]): AgentTool[] {
  if (mcpTools.length === 0) {
    return baseTools;
  }
  return [...baseTools, ...mcpTools];
}
