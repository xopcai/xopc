import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { UserMessage } from '@earendil-works/pi-ai';

import { resolveEffectiveAgentProfileForSession } from '../../config/agent-profile.js';
import { getAgentDefaultModelRef, type Config } from '../../config/schema.js';
import { completeWithResolvedCredentials } from '../../providers/model-call.js';
import {
  extractAssistantText,
  getAssistantMessageErrorReason,
  stripCodeFences,
} from '../../providers/model-response.js';
import { getApiKey, resolveModel } from '../../providers/index.js';
import type { SessionStore } from '../../session/store.js';
import {
  listExecutionReceipts,
  updateExecutionReceipt,
  type ExecutionEvidence,
  type ExecutionJudgment,
} from '../../storage/sqlite/index.js';
import { createLogger } from '../../utils/logger.js';
import { OutcomeExecutionStateRepository } from '../../work/outcome-execution-state.js';
import { OutcomeRepository } from '../../work/outcome-repository.js';
import type { ModelManager } from '../models/index.js';

const log = createLogger('OutcomeJudge');
const MAX_HISTORY_CHARS = 24_000;

export interface OutcomeTurnCompletion {
  sessionKey: string;
  channel: string;
  chatId: string;
  assistantPlainText: string;
  aborted: boolean;
  streamError?: string;
  skipOutcomeReview?: boolean;
  outboundMetadata?: Record<string, unknown>;
}

export interface OutcomeJudgeDecision {
  completedCriteria: number[];
  needsUser: boolean;
  nextAction?: string;
  judgment: ExecutionJudgment;
}

function compactHistory(messages: AgentMessage[]): string {
  const text = JSON.stringify(messages);
  return text.length <= MAX_HISTORY_CHARS ? text : text.slice(-MAX_HISTORY_CHARS);
}

export function parseOutcomeJudgeDecision(raw: string, criteriaCount: number): OutcomeJudgeDecision {
  const text = stripCodeFences(raw);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Outcome judge returned invalid JSON');
  const value = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  const completedCriteria = Array.isArray(value.completedCriteria)
    ? [...new Set(value.completedCriteria
      .filter((item): item is number => Number.isInteger(item))
      .filter((item) => item >= 0 && item < criteriaCount))]
    : [];
  const reasons = Array.isArray(value.reasons)
    ? value.reasons.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      .map((item) => item.trim()).slice(0, 5)
    : [];
  const rejectedAlternatives = Array.isArray(value.rejectedAlternatives)
    ? value.rejectedAlternatives.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const candidate = item as Record<string, unknown>;
        return typeof candidate.option === 'string' && candidate.option.trim()
          && typeof candidate.reason === 'string' && candidate.reason.trim()
          ? [{ option: candidate.option.trim(), reason: candidate.reason.trim() }]
          : [];
      }).slice(0, 5)
    : [];
  const nextAction = typeof value.nextAction === 'string' && value.nextAction.trim()
    ? value.nextAction.trim()
    : undefined;
  const recommendation = typeof value.recommendation === 'string' && value.recommendation.trim()
    ? value.recommendation.trim()
    : nextAction ?? 'Continue gathering verifiable evidence.';
  const confidence = typeof value.confidence === 'number' && Number.isFinite(value.confidence)
    ? Math.max(0, Math.min(1, value.confidence))
    : 0.5;
  return {
    completedCriteria,
    needsUser: value.needsUser === true,
    ...(nextAction ? { nextAction } : {}),
    judgment: {
      recommendation,
      reasons: reasons.length > 0 ? reasons : ['No verified completion evidence was found.'],
      rejectedAlternatives,
      ...(typeof value.uncertainty === 'string' && value.uncertainty.trim()
        ? { uncertainty: value.uncertainty.trim() }
        : {}),
      confidence,
    },
  };
}

function resolveJudgeModel(
  config: Config | undefined,
  sessionKey: string,
  runtimeModel?: string,
): string | undefined {
  if (config) {
    const profile = resolveEffectiveAgentProfileForSession(config, sessionKey);
    if (profile.primaryModelRef?.trim()) return profile.primaryModelRef.trim();
  }
  return runtimeModel?.trim() || (config ? getAgentDefaultModelRef(config) : undefined);
}

export class OutcomeJudgeService {
  readonly #outcomes = new OutcomeRepository();
  readonly #states = new OutcomeExecutionStateRepository();

  constructor(private readonly options: {
    sessionStore: SessionStore;
    modelManager: ModelManager;
    getConfig: () => Config | undefined;
  }) {}

  async reviewTurn(payload: OutcomeTurnCompletion): Promise<void> {
    if (payload.skipOutcomeReview || payload.aborted || payload.streamError) return;
    const metadata = await this.options.sessionStore.getMetadata(payload.sessionKey);
    const outcomeId = typeof metadata?.customData?.outcomeId === 'string'
      ? metadata.customData.outcomeId.trim()
      : '';
    if (!outcomeId) return;

    const outcome = this.#outcomes.get(outcomeId);
    if (!outcome?.contract) return;
    const receipt = listExecutionReceipts({
      sessionKey: payload.sessionKey,
      outcomeId,
      limit: 1,
    })[0];
    if (!receipt || receipt.status !== 'running') return;

    let runtimeModel: string | undefined;
    try {
      runtimeModel = this.options.modelManager.getModelForSession(payload.sessionKey);
    } catch {
      runtimeModel = undefined;
    }
    const modelRef = resolveJudgeModel(this.options.getConfig(), payload.sessionKey, runtimeModel);
    if (!modelRef) return;

    let model: ReturnType<typeof resolveModel>;
    try {
      model = resolveModel(modelRef);
    } catch (error) {
      log.warn({ err: error, modelRef, outcomeId }, 'Outcome judge model could not be resolved');
      return;
    }

    const history = compactHistory(await this.options.sessionStore.loadMessages(payload.sessionKey));
    const criteria = outcome.contract.acceptanceCriteria;
    const prompt = [
      'You are an independent outcome verifier. Be strict and evidence-driven.',
      'Mark a criterion complete only when the transcript or latest response directly proves it.',
      'needsUser is true only when a specific decision, permission, credential, or missing fact must come from the user.',
      'Make one clear recommendation. Explain the decisive reasons, rejected alternatives, uncertainty, and calibrated confidence.',
      'Return only JSON: {"completedCriteria":[0],"needsUser":false,"nextAction":"...","recommendation":"...","reasons":["..."],"rejectedAlternatives":[{"option":"...","reason":"..."}],"uncertainty":"...","confidence":0.8}.',
      `Outcome:\n${outcome.objective}`,
      `Acceptance criteria:\n${criteria.map((item, index) => `${index}. ${item}`).join('\n')}`,
      `Latest response:\n${payload.assistantPlainText.slice(-12_000)}`,
      `Recent transcript:\n${history}`,
    ].join('\n\n');
    const request: UserMessage = { role: 'user', content: prompt, timestamp: Date.now() };

    try {
      const apiKey = await getApiKey(model.provider).catch(() => undefined);
      const response = await completeWithResolvedCredentials(
        model,
        { messages: [request] },
        { apiKey, maxTokens: 900, temperature: 0 },
      );
      const modelError = getAssistantMessageErrorReason(response);
      if (modelError) throw new Error(modelError);
      const decision = parseOutcomeJudgeDecision(extractAssistantText(response.content), criteria.length);
      const now = Date.now();
      const evidence: ExecutionEvidence[] = decision.completedCriteria.map((index) => ({
        kind: 'state',
        title: `Independently verified: ${criteria[index]}`,
        summary: decision.judgment.reasons[0]!,
        verifies: [criteria[index]!],
        provenance: 'judge',
        strength: 'verified',
        observedAt: now,
      }));
      updateExecutionReceipt({
        runId: receipt.runId,
        evidence: [...receipt.evidence, ...evidence],
        nextAction: decision.nextAction ?? null,
        needsUser: decision.needsUser,
        judgment: decision.judgment,
      });
      this.#states.update(outcomeId, {
        nextAction: decision.nextAction ?? null,
        blockedReason: decision.needsUser ? decision.judgment.recommendation : null,
      });
      this.#outcomes.updateState({
        id: outcomeId,
        userStatus: decision.needsUser ? 'needs_user' : 'running',
        internalStatus: decision.needsUser ? 'needs_user' : 'verifying',
      });
    } catch (error) {
      log.warn({ err: error, outcomeId, sessionKey: payload.sessionKey }, 'Outcome review failed');
    }
  }
}
