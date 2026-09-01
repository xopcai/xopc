import { Agent, type AgentMessage, type ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';

import { resolveProviderApiKeySync } from '../../auth/sync-provider-auth.js';
import { extractProfileAgentId } from '../../config/agent-profile.js';
import { resolveTypedModelRef } from '../../config/agent-typed-models.js';
import type { Config } from '../../config/schema.js';
import { getApiKeySync, resolveModel } from '../../providers/index.js';
import {
  finishContextExtractionRun,
  getTurnPersonalization,
  loadCompactionSourceSnapshot,
} from '../../storage/sqlite/index.js';
import { claimRegisteredExtraction, type ExtractorId } from '../../user-context/extraction/registry.js';
import { emptyUnderstandingReview, executeUnderstandingInterpretation } from '../../user-context/extraction/executor.js';
import {
  parseSemanticUnderstanding,
  type SemanticEvidence,
  type SemanticUnderstandingInterpretation,
} from '../../user-context/extraction/semantic.js';
import { createExtensionAwareStreamFn } from '../../providers/extension-stream-bridge.js';
import { createLogger } from '../../utils/logger.js';

import { extractTextContent } from '../context/workspace.js';
import { readAgentMessageContent } from '../memory/agent-message-access.js';
import type { MemoryManager } from '../memory/manager.js';
import type { UnderstandingReviewResult } from '../memory/understanding/types.js';
import { runAgentTurnWithTimeout, resolveAgentTurnTimeoutMs } from '../orchestration/run-agent-turn-with-timeout.js';
import { isAssistantTurnAborted, isAssistantTurnFailed } from '../orchestration/llm-turn-retry.js';

import type { BackgroundReviewSettings } from './settings.js';
import { buildUnderstandingInterpreterPrompt, UNDERSTANDING_INTERPRETER_SYSTEM_PROMPT } from './prompts.js';

const log = createLogger('UnderstandingInterpreter');

type EvidenceMessage = SemanticEvidence & { createdAt: number; message: AgentMessage };

export interface RunBackgroundReviewParams {
  sessionKey: string;
  mainAgent: Agent;
  settings: BackgroundReviewSettings;
  memoryManager: MemoryManager;
  getConfig: () => Config | undefined;
}

export interface RunTurnUnderstandingParams extends Omit<RunBackgroundReviewParams, 'settings'> {
  turnId: string;
  userText: string;
  maxHistoryMessages?: number;
}

function isReviewMessage(value: unknown): value is AgentMessage {
  if (!value || typeof value !== 'object') return false;
  const role = (value as { role?: unknown }).role;
  return role === 'user' || role === 'assistant';
}

function messageText(message: AgentMessage): string {
  const content = readAgentMessageContent(message);
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? extractTextContent(content as Array<{ type: string; text?: string }>) : '';
}

function tagMessage(entry: EvidenceMessage): AgentMessage {
  const copy = JSON.parse(JSON.stringify(entry.message)) as AgentMessage;
  const tag = `[evidence_ref:${entry.ref}] [role:${entry.role}]\n`;
  const content = readAgentMessageContent(copy);
  if (typeof content === 'string') return { ...copy, content: `${tag}${content}` } as AgentMessage;
  if (Array.isArray(content)) {
    const parts = [...content] as Array<{ type: string; text?: string }>;
    const first = parts[0];
    if (first?.type === 'text') parts[0] = { ...first, text: `${tag}${first.text ?? ''}` };
    else parts.unshift({ type: 'text', text: tag });
    return { ...copy, content: parts } as AgentMessage;
  }
  return copy;
}

function loadEvidenceMessages(sessionKey: string, max: number): EvidenceMessage[] {
  const snapshot = loadCompactionSourceSnapshot(sessionKey);
  if (!snapshot) return [];
  return snapshot.entries
    .filter((entry) => isReviewMessage(entry.row))
    .slice(-max)
    .map((entry) => {
      const message = entry.row as AgentMessage;
      return {
        ref: entry.entryId,
        role: message.role as 'user' | 'assistant',
        text: messageText(message),
        createdAt: entry.createdAt,
        message,
      };
    });
}

function lastAssistantText(agent: Agent): string {
  for (let i = agent.state.messages.length - 1; i >= 0; i -= 1) {
    const message = agent.state.messages[i];
    if (message.role === 'assistant') return messageText(message);
  }
  return '';
}

function isLocalModel(model: Model<Api>): boolean {
  if (['ollama', 'lmstudio'].includes(model.provider)) return true;
  try {
    const hostname = new URL(model.baseUrl).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

function resolveInterpreterRuntime(params: Pick<RunBackgroundReviewParams, 'sessionKey' | 'mainAgent' | 'getConfig'>): {
  model: Model<Api>;
  processingPolicy: 'local_only' | 'remote_allowed';
  destination: 'local_model' | 'remote_model';
} | null {
  const config = params.getConfig();
  const processingPolicy = config?.userContext.understanding.processingPolicy ?? 'remote_allowed';
  let model: Model<Api> | undefined;
  if (config) {
    const agentId = extractProfileAgentId(params.sessionKey, config);
    for (const role of ['understanding', 'small']) {
      const ref = resolveTypedModelRef(config, agentId, role);
      if (!ref) continue;
      try {
        model = resolveModel(ref);
        break;
      } catch (err) {
        log.debug({ err, agentId, role, modelRef: ref }, 'Configured understanding model could not be resolved');
      }
    }
  }
  model ??= params.mainAgent.state.model as Model<Api>;
  if (processingPolicy === 'local_only' && !isLocalModel(model)) {
    log.debug({ sessionKey: params.sessionKey, provider: model.provider, modelId: model.id }, 'Understanding interpretation skipped because no local model is configured');
    return null;
  }
  return {
    model,
    processingPolicy,
    destination: isLocalModel(model) ? 'local_model' : 'remote_model',
  };
}

async function interpret(params: {
  sessionKey: string;
  mainAgent: Agent;
  getConfig: () => Config | undefined;
  evidence: EvidenceMessage[];
  mode: 'turn' | 'transcript';
  availableTargets: Array<{ id: string; statement: string }>;
  timeoutMs: number;
  model: Model<Api>;
}): Promise<SemanticUnderstandingInterpretation | null> {
  const reviewAgent = new Agent({
    initialState: {
      systemPrompt: UNDERSTANDING_INTERPRETER_SYSTEM_PROMPT,
      model: params.model,
      thinkingLevel: 'off' as ThinkingLevel,
      tools: [],
      messages: [],
    },
    streamFn: createExtensionAwareStreamFn(),
    getApiKey: (provider: string) => resolveProviderApiKeySync(provider) ?? getApiKeySync(provider) ?? '',
  });
  reviewAgent.state.messages = params.evidence.map(tagMessage);
  try {
    await runAgentTurnWithTimeout(reviewAgent, async () => {
      await reviewAgent.prompt({
        role: 'user',
        content: buildUnderstandingInterpreterPrompt({ mode: params.mode, availableTargets: params.availableTargets }),
        timestamp: Date.now(),
      });
      await reviewAgent.waitForIdle();
    }, Math.min(params.timeoutMs, resolveAgentTurnTimeoutMs(params.getConfig())));
  } catch (err) {
    log.warn({ err, sessionKey: params.sessionKey }, 'User-understanding interpretation failed or timed out');
    reviewAgent.abort();
    await reviewAgent.waitForIdle().catch(() => {});
    return null;
  }
  if (isAssistantTurnAborted(reviewAgent) || isAssistantTurnFailed(reviewAgent)) return null;
  return parseSemanticUnderstanding(
    lastAssistantText(reviewAgent),
    params.evidence,
    params.availableTargets.map((item) => item.id),
  );
}

async function executeReview(params: {
  sessionKey: string;
  mainAgent: Agent;
  memoryManager: MemoryManager;
  getConfig: () => Config | undefined;
  evidence: EvidenceMessage[];
  mode: 'turn' | 'transcript';
  extractorId: ExtractorId;
  sourceRef: string;
  contentForHash: string;
  availableTargets: Array<{ id: string; statement: string }>;
  timeoutMs: number;
  turnId?: string;
}): Promise<UnderstandingReviewResult> {
  const runtime = resolveInterpreterRuntime(params);
  if (!runtime) return emptyUnderstandingReview();
  const extraction = claimRegisteredExtraction({
    extractorId: params.extractorId,
    sourceRef: params.sourceRef,
    contentForHash: params.contentForHash,
    processingPolicy: runtime.processingPolicy,
    destination: runtime.destination,
  });
  if (!extraction.shouldExecute) return emptyUnderstandingReview();
  const interpretation = await interpret({ ...params, model: runtime.model });
  if (!interpretation) {
    finishContextExtractionRun({ runId: extraction.run.id, status: 'failed', errorCode: 'model_or_schema_failed' });
    return emptyUnderstandingReview();
  }
  try {
    const result = await executeUnderstandingInterpretation({
      interpretation,
      evidence: params.evidence,
      extractionRunId: extraction.run.id,
      extractorId: params.extractorId,
      sessionKey: params.sessionKey,
      ...(params.turnId ? { turnId: params.turnId } : {}),
      memoryManager: params.memoryManager,
      getConfig: params.getConfig,
      reviewSource: params.mode === 'turn' ? 'turn' : 'background',
      processingPolicy: runtime.processingPolicy,
    });
    finishContextExtractionRun({
      runId: extraction.run.id,
      status: 'completed',
      outputs: result.writeOutputs?.map((output) => ({
        candidateKey: output.candidateKey,
        ...(output.objectId ? { objectType: 'understanding' as const, objectId: output.objectId } : {}),
        ...(output.versionId ? { versionId: output.versionId } : {}),
        outcome: output.outcome,
      })),
    });
    return result;
  } catch (err) {
    finishContextExtractionRun({ runId: extraction.run.id, status: 'failed', errorCode: 'write_failed' });
    throw err;
  }
}

export async function runTurnUnderstandingReview(params: RunTurnUnderstandingParams): Promise<UnderstandingReviewResult> {
  const evidence = loadEvidenceMessages(params.sessionKey, params.maxHistoryMessages ?? 12);
  if (!evidence.length) return emptyUnderstandingReview();
  const personalization = getTurnPersonalization(params.turnId);
  const availableTargets = personalization?.items.flatMap((item) => {
    if (item.objectType !== 'understanding' || item.decision !== 'selected') return [];
    return [{ id: item.objectId, statement: item.content }];
  }) ?? [];
  return executeReview({
    sessionKey: params.sessionKey,
    mainAgent: params.mainAgent,
    memoryManager: params.memoryManager,
    getConfig: params.getConfig,
    evidence,
    mode: 'turn',
    extractorId: 'turn-semantics',
    sourceRef: `session:${params.sessionKey}:turn:${params.turnId}`,
    contentForHash: params.userText,
    availableTargets,
    timeoutMs: 30_000,
    turnId: params.turnId,
  });
}

export async function runBackgroundReviewTurn(params: RunBackgroundReviewParams): Promise<void> {
  const evidence = loadEvidenceMessages(params.sessionKey, params.settings.maxHistoryMessages);
  if (!evidence.length) return;
  const first = evidence[0]!;
  const last = evidence[evidence.length - 1]!;
  await executeReview({
    sessionKey: params.sessionKey,
    mainAgent: params.mainAgent,
    memoryManager: params.memoryManager,
    getConfig: params.getConfig,
    evidence,
    mode: 'transcript',
    extractorId: 'transcript-synthesis',
    sourceRef: `session:${params.sessionKey}:window:${first.ref}:${last.ref}`,
    contentForHash: evidence.map((entry) => entry.ref).join('\n'),
    availableTargets: [],
    timeoutMs: params.settings.maxDurationMs,
  });
}
