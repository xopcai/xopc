import crypto from 'node:crypto';
import type { AgentMessage, ThinkingLevel } from '@earendil-works/pi-agent-core';

import type { Config } from '../../config/schema.js';
import type { AgentInstanceGateway } from '../agent-instance-gateway.js';
import type { ModelManager } from '../models/index.js';
import type { SessionStore } from '../../session/store.js';
import { resolveAgentTurnTimeoutMs } from '../orchestration/run-agent-turn-with-timeout.js';
import { runXopcEmbeddedTurn } from './run-turn.js';
import type { EmbeddedStreamEvent, RunXopcEmbeddedTurnParams, RunXopcEmbeddedTurnResult } from './types.js';
import { applyStartupContextToUserMessage } from '../reply/apply-turn-user-enrichment.js';
import { resolveEffectiveAgentManifestForSession } from '../../config/agent-profile.js';
import {
  mergeTurnTools,
  resolveEmbeddedMcpToolsForTurn,
} from '../mcp/resolve-embedded-mcp-tools.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('EmbeddedTurnForSession');

export type RunEmbeddedForSessionParams = {
  sessionKey: string;
  runId?: string;
  userMessage: AgentMessage;
  llmImages?: import('@earendil-works/pi-ai').ImageContent[];
  sessionStore: SessionStore;
  agentManager: AgentInstanceGateway;
  modelManager: ModelManager;
  thinkingOverride?: string | null;
  abortSignal?: AbortSignal;
  onEvent?: (event: EmbeddedStreamEvent) => void;
  getConfig?: () => Config | undefined;
  beforeTurn?: () => void | Promise<void>;
  afterTurn?: (userPlain: string) => void | Promise<void>;
  startupAction?: 'new' | 'reset';
  forceStartupContext?: boolean;
  applyStartupContext?: boolean;
  /** When true, dispose session MCP runtime after this turn completes. */
  cleanupBundleMcpOnRunEnd?: boolean;
};

export async function runEmbeddedTurnForSession(
  params: RunEmbeddedForSessionParams,
): Promise<RunXopcEmbeddedTurnResult> {
  const { sessionKey, agentManager, modelManager, sessionStore, userMessage } = params;
  const runId = params.runId ?? crypto.randomUUID();

  await params.beforeTurn?.();

  const agent = (agentManager as any).getOrCreateAgent(sessionKey) as {
    state: {
      tools: RunXopcEmbeddedTurnParams['tools'];
      systemPrompt?: string;
      thinkingLevel?: ThinkingLevel;
    };
  };
  const mm = modelManager as any;
  await mm.applyModelForSession(agent, sessionKey);

  const modelRef = String(mm.getModelForSession(sessionKey));
  agentManager.setModelForSession(sessionKey, modelRef);
  const model = mm.getResolvedModelForSession(sessionKey) as RunXopcEmbeddedTurnParams['model'];
  const tools = agent.state.tools;
  const systemPrompt = agent.state.systemPrompt ?? '';
  const thinkingLevel = (params.thinkingOverride as ThinkingLevel | undefined) ?? agent.state.thinkingLevel;
  const workspaceDir = agentManager.getResolvedWorkspaceForSession(sessionKey);
  const config = params.getConfig?.();

  // --- Pre-turn automatic compaction ---
  await maybeAutoCompactBeforeTurn({
    sessionKey,
    sessionStore,
    agentManager,
    model,
    config,
    onEvent: params.onEvent,
  });

  let userMessageForTurn = userMessage;
  if (params.applyStartupContext !== false) {
    userMessageForTurn = await applyStartupContextToUserMessage({
      userMessage,
      sessionKey,
      workspaceDir,
      cfg: config,
      sessionStore,
      startupAction: params.startupAction,
      force: params.forceStartupContext,
    });
  }

  const result = await (async () => {
    const mcpResolved = await resolveEmbeddedMcpToolsForTurn({
      sessionKey,
      workspaceDir,
      cfg: config,
      baseTools: tools,
      cleanupOnTurnEnd: params.cleanupBundleMcpOnRunEnd === true,
    });
    const turnTools = mergeTurnTools(tools, mcpResolved.tools);
    try {
      return await runXopcEmbeddedTurn({
        sessionKey,
        runId,
        userMessage: userMessageForTurn,
        images: params.llmImages,
        model,
        modelRef,
        tools: turnTools,
        systemPrompt,
        thinkingLevel,
        workspaceDir,
        sessionStore,
        timeoutMs: resolveAgentTurnTimeoutMs(config),
        abortSignal: params.abortSignal,
        onEvent: params.onEvent,
      });
    } finally {
      await mcpResolved.dispose().catch(() => {});
    }
  })();

  return result;
}

// ---------------------------------------------------------------------------
// Pre-turn automatic compaction
// ---------------------------------------------------------------------------

async function maybeAutoCompactBeforeTurn(opts: {
  sessionKey: string;
  sessionStore: SessionStore;
  agentManager: AgentInstanceGateway;
  model: RunXopcEmbeddedTurnParams['model'];
  config: Config | undefined;
  onEvent?: (event: EmbeddedStreamEvent) => void;
}): Promise<void> {
  const { sessionKey, sessionStore, agentManager, model, config, onEvent } = opts;
  if (config) {
    try {
      const manifest = resolveEffectiveAgentManifestForSession(config, sessionKey);
      if (manifest.memory.retention?.compaction === false) {
        return;
      }
    } catch {
      // Keep compaction enabled when manifest resolution is unavailable.
    }
  }

  const contextWindow = (model as { contextWindow?: number }).contextWindow ?? 128_000;
  const messages = await sessionStore.load(sessionKey);
  const prep = sessionStore.prepareCompaction(sessionKey, messages, contextWindow);

  if (!prep.needsCompaction) {
    return;
  }

  log.info(
    { sessionKey, reason: prep.stats?.reason, usagePercent: prep.stats?.usagePercent, contextWindow },
    'Pre-turn auto-compaction triggered',
  );

  onEvent?.({
    type: 'compaction',
    status: 'started',
    tokensBefore: prep.stats?.usagePercent != null
      ? Math.round((prep.stats.usagePercent as number) * contextWindow)
      : undefined,
  });

  try {
    const result = await sessionStore.compact(sessionKey, messages, contextWindow);

    if (result.compacted) {
      // Evict the cached agent so the next turn reloads from the compacted transcript
      agentManager.removeAgent(sessionKey);

      log.info(
        { sessionKey, tokensBefore: result.tokensBefore, tokensAfter: result.tokensAfter },
        'Pre-turn auto-compaction completed',
      );

      onEvent?.({
        type: 'compaction',
        status: 'completed',
        tokensBefore: result.tokensBefore,
        tokensAfter: result.tokensAfter,
        summary: result.summary.length > 200 ? `${result.summary.slice(0, 200)}…` : result.summary,
      });
    } else {
      onEvent?.({ type: 'compaction', status: 'skipped' });
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log.warn({ err, sessionKey }, `Pre-turn auto-compaction failed: ${errorMessage}`);
    // Non-fatal: let the turn proceed even if compaction fails
    onEvent?.({ type: 'compaction', status: 'skipped' });
  }
}
