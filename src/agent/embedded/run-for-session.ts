import crypto from 'node:crypto';
import type { AgentMessage, ThinkingLevel } from '@earendil-works/pi-agent-core';

import type { Config } from '../../config/schema.js';
import type { AgentManager } from '../agent-manager.js';
import type { ModelManager } from '../models/index.js';
import type { SessionStore } from '../../session/store.js';
import { resolveAgentTurnTimeoutMs } from '../orchestration/run-agent-turn-with-timeout.js';
import { runXopcEmbeddedTurn } from './run-turn.js';
import type { EmbeddedStreamEvent, RunXopcEmbeddedTurnParams, RunXopcEmbeddedTurnResult } from './types.js';

export type RunEmbeddedForSessionParams = {
  sessionKey: string;
  runId?: string;
  userMessage: AgentMessage;
  sessionStore: SessionStore;
  agentManager: AgentManager;
  modelManager: ModelManager;
  thinkingOverride?: string | null;
  abortSignal?: AbortSignal;
  onEvent?: (event: EmbeddedStreamEvent) => void;
  getConfig?: () => Config | undefined;
  beforeTurn?: () => void | Promise<void>;
  afterTurn?: (userPlain: string) => void | Promise<void>;
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
  const model = mm.getResolvedModelForSession(sessionKey) as RunXopcEmbeddedTurnParams['model'];
  const tools = agent.state.tools;
  const systemPrompt = agent.state.systemPrompt ?? '';
  const thinkingLevel = (params.thinkingOverride as ThinkingLevel | undefined) ?? agent.state.thinkingLevel;
  const workspaceDir = agentManager.getResolvedWorkspaceForSession(sessionKey);
  const config = params.getConfig?.();

  const result = await runXopcEmbeddedTurn({
    sessionKey,
    runId,
    userMessage,
    model,
    modelRef,
    tools,
    systemPrompt,
    thinkingLevel,
    workspaceDir,
    sessionStore,
    timeoutMs: resolveAgentTurnTimeoutMs(config),
    abortSignal: params.abortSignal,
    onEvent: params.onEvent,
  });

  return result;
}
