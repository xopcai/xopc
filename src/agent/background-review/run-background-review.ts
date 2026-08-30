import { Agent, type AgentMessage, type ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';

import type { Config } from '../../config/schema.js';
import { resolveProviderApiKeySync } from '../../auth/sync-provider-auth.js';
import { getApiKeySync } from '../../providers/index.js';
import { isDurableUnderstandingCandidate } from '../../user-context/understandingQuality.js';
import { UNDERSTANDING_KINDS } from '../../user-context/domain.js';
import { createExtensionAwareStreamFn } from '../../providers/extension-stream-bridge.js';
import { createLogger } from '../../utils/logger.js';
import {
  createContextEvidence,
  finishContextExtractionRun,
  getSessionMetadata,
  loadCompactionSourceSnapshot,
} from '../../storage/sqlite/index.js';
import { claimRegisteredExtraction, extractionInputHash } from '../../user-context/extraction/registry.js';

import { extractTextContent } from '../context/workspace.js';
import { readAgentMessageContent } from '../memory/agent-message-access.js';
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

type EvidenceMessage = { entryId: string; createdAt: number; message: AgentMessage };
type BackgroundCandidate = UnderstandingCandidate & { evidenceRefs: string[] };

function isReviewMessage(value: unknown): value is AgentMessage {
  if (!value || typeof value !== 'object') return false;
  const role = (value as { role?: unknown }).role;
  return role === 'user' || role === 'assistant';
}

function tagMessage(message: AgentMessage, entryId: string): AgentMessage {
  const copy = JSON.parse(JSON.stringify(message)) as AgentMessage;
  const tag = `[evidence_ref:${entryId}]\n`;
  const messageContent = readAgentMessageContent(copy);
  if (typeof messageContent === 'string') return { ...copy, content: `${tag}${messageContent}` } as AgentMessage;
  if (Array.isArray(messageContent)) {
    const content = [...messageContent] as Array<{ type: string; text?: string }>;
    const first = content[0];
    if (first?.type === 'text') content[0] = { ...first, text: `${tag}${first.text ?? ''}` };
    else content.unshift({ type: 'text', text: tag });
    return { ...copy, content } as AgentMessage;
  }
  return copy;
}

function loadEvidenceMessages(sessionKey: string, max: number): EvidenceMessage[] {
  const snapshot = loadCompactionSourceSnapshot(sessionKey);
  if (!snapshot) return [];
  return snapshot.entries
    .filter((entry) => isReviewMessage(entry.row))
    .slice(-max)
    .map((entry) => ({ entryId: entry.entryId, createdAt: entry.createdAt, message: entry.row as AgentMessage }));
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

function parseBackgroundCandidates(raw: string): BackgroundCandidate[] {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)?.[1];
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  const candidateJson = fenced ?? (start >= 0 && end > start ? raw.slice(start, end + 1) : raw);
  try {
    const parsed = JSON.parse(candidateJson) as { candidates?: unknown };
    if (!Array.isArray(parsed.candidates)) return [];
    const output: BackgroundCandidate[] = [];
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
      const evidenceRefs = Array.isArray(item.evidenceRefs)
        ? [...new Set(item.evidenceRefs.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))]
        : [];
      output.push({
        kind,
        content: item.content.trim(),
        confidence: Math.max(0, Math.min(1, confidence)),
        importance: Math.max(0, Math.min(1, importance)),
        explicitness: 'inferred',
        durability,
        sensitivity,
        disclosurePolicy,
        evidenceRefs,
      } as BackgroundCandidate);
    }
    return output;
  } catch {
    return [];
  }
}

export function parseUnderstandingCandidates(raw: string): UnderstandingCandidate[] {
  return parseBackgroundCandidates(raw).map(({ evidenceRefs: _evidenceRefs, ...candidate }) => candidate);
}

async function runUnderstandingReview(params: RunBackgroundReviewParams): Promise<void> {
  const { sessionKey, mainAgent, settings, memoryManager, getConfig } = params;
  const evidenceMessages = loadEvidenceMessages(sessionKey, settings.maxHistoryMessages);
  if (!evidenceMessages.length) {
    log.debug({ sessionKey }, 'User-understanding review skipped because no persisted evidence was available');
    return;
  }
  const lastEvidence = evidenceMessages[evidenceMessages.length - 1]!;
  const extraction = claimRegisteredExtraction({
    extractorId: 'transcript-synthesis',
    sourceRef: `session:${sessionKey}:window:${evidenceMessages[0]!.entryId}:${lastEvidence.entryId}`,
    contentForHash: evidenceMessages.map((entry) => entry.entryId).join('\n'),
    processingPolicy: 'remote_allowed',
    destination: 'remote_model',
  });
  if (!extraction.shouldExecute) return;
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
  reviewAgent.state.messages = evidenceMessages.map((entry) => tagMessage(entry.message, entry.entryId));
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
    finishContextExtractionRun({ runId: extraction.run.id, status: 'failed', errorCode: 'model_failed' });
    return;
  }
  if (isAssistantTurnAborted(reviewAgent) || isAssistantTurnFailed(reviewAgent)) {
    finishContextExtractionRun({ runId: extraction.run.id, status: 'failed', errorCode: 'model_failed' });
    return;
  }
  const candidates = parseBackgroundCandidates(lastAssistantText(reviewAgent));
  let applied = 0;
  try {
    const evidenceByRef = new Map(evidenceMessages.map((entry) => [entry.entryId, entry]));
    const projectId = getSessionMetadata(sessionKey)?.projectId;
    const outputs: Array<{
      candidateKey: string; objectType?: 'understanding'; objectId?: string; versionId?: string;
      outcome: 'created' | 'deduplicated' | 'rejected';
    }> = [];
    for (const { evidenceRefs, ...candidate } of candidates) {
      const referenced = evidenceRefs.flatMap((ref) => {
        const entry = evidenceByRef.get(ref);
        return entry ? [entry] : [];
      });
      if (!referenced.length) {
        outputs.push({ candidateKey: `${candidate.kind}:${candidate.content}`, outcome: 'rejected' });
        continue;
      }
      const evidenceIds = referenced.map((entry) => createContextEvidence({
        sourceType: 'conversation',
        sourceRef: `session:${sessionKey}:entry:${entry.entryId}`,
        sourceRunId: extraction.run.id,
        sessionId: sessionKey,
        messageId: entry.entryId,
        contentHash: extractionInputHash(JSON.stringify(entry.message)),
        retentionPolicy: 'derived_only',
        processingPolicy: 'remote_allowed',
        extractorId: 'transcript-synthesis',
        extractorVersion: '1',
        trustLevel: 'owner',
        observedAt: entry.createdAt,
      }).id);
      const result = await memoryManager.applyUnderstandingCandidates([candidate], {
        sessionKey,
        ...(projectId ? { projectId } : {}),
        evidenceIds,
        reviewSource: 'background',
        extractionRunId: extraction.run.id,
      });
      outputs.push(...(result.writeOutputs ?? []).map((output) => ({
        candidateKey: output.candidateKey,
        ...(output.objectId ? { objectType: 'understanding' as const, objectId: output.objectId } : {}),
        ...(output.versionId ? { versionId: output.versionId } : {}),
        outcome: output.outcome,
      })));
      applied += 1;
    }
    finishContextExtractionRun({ runId: extraction.run.id, status: 'completed', outputs });
  } catch (error) {
    finishContextExtractionRun({ runId: extraction.run.id, status: 'failed', errorCode: 'write_failed' });
    throw error;
  }
  log.debug({ sessionKey, candidateCount: candidates.length, applied }, 'User-understanding review completed');
}

export async function runBackgroundReviewTurn(params: RunBackgroundReviewParams): Promise<void> {
  await runUnderstandingReview(params);
}
