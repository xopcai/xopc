import { Agent, type AgentMessage, type ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';

import { resolveProviderApiKeySync } from '../../auth/sync-provider-auth.js';
import { extractProfileAgentId } from '../../config/agent-profile.js';
import { resolveModelIntentRef } from '../../config/agent-model-intents.js';
import type { Config } from '../../config/schema.js';
import { getApiKeySync, resolveModel } from '../../providers/index.js';
import {
  finishContextExtractionRun,
  getSessionMetadata,
  loadCompactionSourceSnapshot,
} from '../../storage/sqlite/index.js';
import { claimRegisteredExtraction, type ExtractorId } from '../../user-context/extraction/registry.js';
import {
  emptyUserModelCaptureResult,
  executeUserModelInterpretation,
  parseUserModelInterpretation,
  type CaptureEvidence,
  type UserModelCaptureResult,
  type UserModelInterpretation,
} from '../../user-model/capture/index.js';
import { listUserAssertions } from '../../user-model/repository.js';
import { createExtensionAwareStreamFn } from '../../providers/extension-stream-bridge.js';
import { createLogger } from '../../utils/logger.js';

import { extractTextContent } from '../context/workspace.js';
import { readAgentMessageContent } from '../memory/agent-message-access.js';
import { runAgentTurnWithTimeout, resolveAgentTurnTimeoutMs } from '../orchestration/run-agent-turn-with-timeout.js';
import { isAssistantTurnAborted, isAssistantTurnFailed } from '../orchestration/llm-turn-retry.js';

import type { BackgroundReviewSettings } from './settings.js';
import { buildUserModelInterpreterPrompt, USER_MODEL_INTERPRETER_SYSTEM_PROMPT } from './prompts.js';

const log = createLogger('UserModelInterpreter');

type EvidenceMessage = CaptureEvidence & { message: AgentMessage };

export interface RunUserModelReviewParams {
  sessionKey: string;
  mainAgent: Agent;
  settings: BackgroundReviewSettings;
  workspaceId: string;
  getConfig: () => Config | undefined;
}

export interface RunTurnUserModelCaptureParams extends Omit<RunUserModelReviewParams, 'settings'> {
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

function resolveInterpreterRuntime(params: Pick<RunUserModelReviewParams, 'sessionKey' | 'mainAgent' | 'getConfig'>): {
  model: Model<Api>;
  processingPolicy: 'local_only' | 'remote_allowed';
  destination: 'local_model' | 'remote_model';
} | null {
  const config = params.getConfig();
  const processingPolicy = config?.userContext.userModel.processingPolicy ?? 'remote_allowed';
  let model: Model<Api> | undefined;
  if (config) {
    const agentId = extractProfileAgentId(params.sessionKey, config);
    const ref = resolveModelIntentRef(config, agentId, 'understanding');
    if (ref) {
      try {
        model = resolveModel(ref);
      } catch (err) {
        log.debug({ err, agentId, modelRef: ref }, 'Configured understanding model could not be resolved');
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
}): Promise<UserModelInterpretation | null> {
  const reviewAgent = new Agent({
    initialState: {
      systemPrompt: USER_MODEL_INTERPRETER_SYSTEM_PROMPT,
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
      const timezone = params.getConfig()?.userContext.userModel.maintenance.timezone
        ?? Intl.DateTimeFormat().resolvedOptions().timeZone
        ?? 'UTC';
      await reviewAgent.prompt({
        role: 'user',
        content: buildUserModelInterpreterPrompt({
          mode: params.mode,
          availableTargets: params.availableTargets,
          evidenceTimestamp: new Date(params.evidence.at(-1)?.createdAt ?? Date.now()).toISOString(),
          timezone,
        }),
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
  return parseUserModelInterpretation(
    lastAssistantText(reviewAgent),
    params.evidence,
    params.availableTargets.map((item) => item.id),
  );
}

async function executeReview(params: {
  sessionKey: string;
  mainAgent: Agent;
  workspaceId: string;
  getConfig: () => Config | undefined;
  evidence: EvidenceMessage[];
  mode: 'turn' | 'transcript';
  extractorId: ExtractorId;
  sourceRef: string;
  contentForHash: string;
  availableTargets: Array<{ id: string; statement: string }>;
  timeoutMs: number;
  turnId?: string;
}): Promise<UserModelCaptureResult> {
  const runtime = resolveInterpreterRuntime(params);
  if (!runtime) return emptyUserModelCaptureResult();
  const extraction = claimRegisteredExtraction({
    extractorId: params.extractorId,
    sourceRef: params.sourceRef,
    contentForHash: params.contentForHash,
    processingPolicy: runtime.processingPolicy,
    destination: runtime.destination,
  });
  if (!extraction.shouldExecute) return emptyUserModelCaptureResult();
  const interpretation = await interpret({ ...params, model: runtime.model });
  if (!interpretation) {
    finishContextExtractionRun({ runId: extraction.run.id, status: 'failed', errorCode: 'model_or_schema_failed' });
    return emptyUserModelCaptureResult();
  }
  try {
    const config = params.getConfig();
    const agentId = config ? extractProfileAgentId(params.sessionKey, config) : 'main';
    const write = config?.userContext.userModel.writePolicy ?? 'deny';
    const result = executeUserModelInterpretation({
      interpretation,
      evidence: params.evidence,
      extractionRunId: extraction.run.id,
      extractorId: params.extractorId,
      scopeContext: {
        sessionId: params.sessionKey,
        agentId,
        workspaceId: params.workspaceId,
        ...(getSessionMetadata(params.sessionKey)?.projectId
          ? { projectId: getSessionMetadata(params.sessionKey)!.projectId }
          : {}),
      },
      policy: {
        write,
        sensitiveWrite: config?.userContext.userModel.sensitiveWritePolicy ?? 'confirm',
        processing: runtime.processingPolicy,
      },
      ...(params.turnId ? { turnId: params.turnId } : {}),
    });
    finishContextExtractionRun({
      runId: extraction.run.id,
      status: 'completed',
      outputs: result.outputs.map((output) => ({
        candidateKey: output.candidateKey,
        outcome: output.outcome === 'deduplicated' ? 'deduplicated' as const
          : output.outcome === 'rejected' ? 'rejected' as const : 'created' as const,
      })),
    });
    return result;
  } catch (err) {
    finishContextExtractionRun({ runId: extraction.run.id, status: 'failed', errorCode: 'write_failed' });
    throw err;
  }
}

export async function runTurnUserModelCapture(params: RunTurnUserModelCaptureParams): Promise<UserModelCaptureResult> {
  const evidence = loadEvidenceMessages(params.sessionKey, params.maxHistoryMessages ?? 12);
  if (!evidence.length) return emptyUserModelCaptureResult();
  const availableTargets = listUserAssertions({ limit: 200 }).map((item) => ({
    id: item.id,
    statement: item.statement,
  }));
  return executeReview({
    sessionKey: params.sessionKey,
    mainAgent: params.mainAgent,
    workspaceId: params.workspaceId,
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

export async function runBackgroundUserModelReview(params: RunUserModelReviewParams): Promise<void> {
  const evidence = loadEvidenceMessages(params.sessionKey, params.settings.maxHistoryMessages);
  if (!evidence.length) return;
  const first = evidence[0]!;
  const last = evidence[evidence.length - 1]!;
  await executeReview({
    sessionKey: params.sessionKey,
    mainAgent: params.mainAgent,
    workspaceId: params.workspaceId,
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
