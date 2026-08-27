import { Agent, type AgentMessage, type ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';

import type { Config } from '../../config/schema.js';
import { resolveProviderApiKeySync } from '../../auth/sync-provider-auth.js';
import { getApiKeySync } from '../../providers/index.js';
import { isDurableUnderstandingCandidate } from '../../user-context/understandingQuality.js';
import { UNDERSTANDING_KINDS } from '../../user-context/domain.js';
import { createExtensionAwareStreamFn } from '../../providers/extension-stream-bridge.js';
import { createLogger } from '../../utils/logger.js';
import { getSessionMetadata } from '../../storage/sqlite/index.js';

import { extractTextContent } from '../context/workspace.js';
import type { MemoryManager } from '../memory/manager.js';
import type { UnderstandingCandidate } from '../memory/understanding/types.js';
import {
  runAgentTurnWithTimeout,
  resolveAgentTurnTimeoutMs,
} from '../orchestration/run-agent-turn-with-timeout.js';
import {
  isAssistantTurnAborted,
  isAssistantTurnFailed,
} from '../orchestration/llm-turn-retry.js';

import type { BackgroundReviewSettings } from './settings.js';
import {
  MEMORY_REVIEW_USER_PROMPT,
  UNDERSTANDING_REVIEW_SYSTEM_PROMPT,
} from './prompts.js';

const log = createLogger('BackgroundReview');

function cloneMessageTail(messages: AgentMessage[], max: number): AgentMessage[] {
  const tail = messages.length <= max ? messages : messages.slice(-max);
  return JSON.parse(JSON.stringify(tail)) as AgentMessage[];
}

export interface RunBackgroundReviewParams {
  sessionKey: string;
  mainAgent: Agent;
  settings: BackgroundReviewSettings;
  memoryManager: MemoryManager;
  getConfig: () => Config | undefined;
}

const ALLOWED_UNDERSTANDING_KINDS = new Set<UnderstandingCandidate['kind']>(UNDERSTANDING_KINDS);
const ALLOWED_SENSITIVITIES = new Set<UnderstandingCandidate['sensitivity']>([
  'normal', 'personal', 'secret', 'regulated',
]);

function lastAssistantText(agent: Agent): string {
  for (let i = agent.state.messages.length - 1; i >= 0; i--) {
    const message = agent.state.messages[i];
    if (message.role !== 'assistant') continue;
    return Array.isArray(message.content)
      ? extractTextContent(message.content as Array<{ type: string; text?: string }>)
      : String(message.content);
  }
  return '';
}

export function parseUnderstandingCandidates(raw: string): UnderstandingCandidate[] {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)?.[1];
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  const candidateJson = fenced ?? (start >= 0 && end > start ? raw.slice(start, end + 1) : raw);
  try {
    const parsed = JSON.parse(candidateJson) as { candidates?: unknown };
    if (!Array.isArray(parsed.candidates)) return [];
    const output: UnderstandingCandidate[] = [];
    for (const value of parsed.candidates.slice(0, 8)) {
      if (!value || typeof value !== 'object') continue;
      const item = value as Record<string, unknown>;
      if (!ALLOWED_UNDERSTANDING_KINDS.has(item.kind as UnderstandingCandidate['kind'])) continue;
      if (typeof item.content !== 'string' || item.content.trim().length < 4) continue;
      const kind = item.kind as UnderstandingCandidate['kind'];
      if (!isDurableUnderstandingCandidate(kind, item.content)) continue;
      const confidence = typeof item.confidence === 'number' ? item.confidence : 0.65;
      const importance = typeof item.importance === 'number' ? item.importance : 0.5;
      const durability = item.durability === 'ephemeral' || item.durability === 'recurring'
        ? item.durability
        : 'durable';
      const sensitivity = ALLOWED_SENSITIVITIES.has(item.sensitivity as UnderstandingCandidate['sensitivity'])
        ? item.sensitivity as UnderstandingCandidate['sensitivity']
        : 'personal';
      const disclosurePolicy = item.disclosurePolicy === 'silent' || item.disclosurePolicy === 'ask_before_reference'
        ? item.disclosurePolicy
        : 'referenceable';
      output.push({
        kind,
        content: item.content.trim(),
        confidence: Math.max(0, Math.min(1, confidence)),
        importance: Math.max(0, Math.min(1, importance)),
        explicitness: 'inferred',
        durability,
        sensitivity,
        disclosurePolicy,
      });
    }
    return output;
  } catch {
    return [];
  }
}

async function runUnderstandingReview(params: RunBackgroundReviewParams): Promise<void> {
  const { sessionKey, mainAgent, settings, memoryManager, getConfig } = params;
  const reviewAgent = new Agent({
    initialState: {
      systemPrompt: UNDERSTANDING_REVIEW_SYSTEM_PROMPT,
      model: mainAgent.state.model as Model<Api>,
      thinkingLevel: 'off' as ThinkingLevel,
      tools: [],
      messages: [],
    },
    streamFn: createExtensionAwareStreamFn(),
    getApiKey: (provider: string) => resolveProviderApiKeySync(provider) ?? getApiKeySync(provider) ?? '',
  });
  reviewAgent.state.messages = cloneMessageTail(mainAgent.state.messages, settings.maxHistoryMessages);
  const timeoutMs = Math.min(settings.maxDurationMs, resolveAgentTurnTimeoutMs(getConfig()));
  try {
    await runAgentTurnWithTimeout(reviewAgent, async () => {
      await reviewAgent.prompt({ role: 'user', content: MEMORY_REVIEW_USER_PROMPT, timestamp: Date.now() });
      await reviewAgent.waitForIdle();
    }, timeoutMs);
  } catch (err) {
    log.warn({ err, sessionKey }, 'User-understanding review failed or timed out');
    reviewAgent.abort();
    await reviewAgent.waitForIdle().catch(() => {});
    return;
  }
  if (isAssistantTurnAborted(reviewAgent) || isAssistantTurnFailed(reviewAgent)) return;
  const candidates = parseUnderstandingCandidates(lastAssistantText(reviewAgent));
  const projectId = getSessionMetadata(sessionKey)?.projectId;
  await memoryManager.applyUnderstandingCandidates(candidates, {
    sessionKey,
    ...(projectId ? { projectId } : {}),
    sourceText: 'Background review of the current session transcript',
    reviewSource: 'background',
  });
  log.debug({ sessionKey, candidateCount: candidates.length }, 'User-understanding review completed');
}

export async function runBackgroundReviewTurn(params: RunBackgroundReviewParams): Promise<void> {
  await runUnderstandingReview(params);
}
