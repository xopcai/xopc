import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { UserMessage } from '@earendil-works/pi-ai';
import type { TaskEvidence, TaskJudgment } from '@xopcai/gateway-contract';

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
import { createLogger } from '../../utils/logger.js';
import { TaskApplicationService } from '../../tasks/task-application-service.js';
import { TaskConversationRepository } from '../../tasks/task-conversation-repository.js';
import { TaskRepository } from '../../tasks/task-repository.js';
import { TaskRunRepository } from '../../tasks/task-run-repository.js';
import type { ModelManager } from '../models/index.js';

const log = createLogger('TaskJudge');
const MAX_HISTORY_CHARS = 24_000;

export interface TaskTurnCompletion {
  sessionKey: string;
  channel: string;
  chatId: string;
  assistantPlainText: string;
  aborted: boolean;
  streamError?: string;
  skipTaskReview?: boolean;
  outboundMetadata?: Record<string, unknown>;
}

export interface TaskJudgeDecision {
  completedCriteria: number[];
  needsUser: boolean;
  nextAction?: string;
  judgment: TaskJudgment;
}

function compactHistory(messages: AgentMessage[]): string {
  const text = JSON.stringify(messages);
  return text.length <= MAX_HISTORY_CHARS ? text : text.slice(-MAX_HISTORY_CHARS);
}

export function parseTaskJudgeDecision(raw: string, criteriaCount: number): TaskJudgeDecision {
  const text = stripCodeFences(raw);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Task judge returned invalid JSON');
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

export class TaskJudgeService {
  readonly #tasks = new TaskRepository();
  readonly #runs = new TaskRunRepository();
  readonly #application = new TaskApplicationService();
  readonly #conversations = new TaskConversationRepository();

  constructor(private readonly options: {
    sessionStore: SessionStore;
    modelManager: ModelManager;
    getConfig: () => Config | undefined;
  }) {}

  async reviewTurn(payload: TaskTurnCompletion): Promise<void> {
    if (payload.skipTaskReview || payload.aborted || payload.streamError) return;
    const taskId = this.#conversations.resolveActiveExecutionSession(payload.sessionKey)?.taskId;
    if (!taskId) return;

    const task = this.#tasks.get(taskId);
    if (!task?.contract) return;
    const run = this.#runs.getActiveRoot(taskId);
    if (!run || run.status !== 'running' || run.sessionKey !== payload.sessionKey) return;

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
      log.warn({ err: error, modelRef, taskId }, 'Task judge model could not be resolved');
      return;
    }

    const history = compactHistory(await this.options.sessionStore.loadMessages(payload.sessionKey));
    const criteria = task.contract.acceptanceCriteria;
    const prompt = [
      'You are an independent task verifier. Be strict and evidence-driven.',
      'Mark a criterion complete only when the transcript or latest response directly proves it.',
      'needsUser is true only when a specific decision, permission, credential, or missing fact must come from the user.',
      'Make one clear recommendation. Explain the decisive reasons, rejected alternatives, uncertainty, and calibrated confidence.',
      'Return only JSON: {"completedCriteria":[0],"needsUser":false,"nextAction":"...","recommendation":"...","reasons":["..."],"rejectedAlternatives":[{"option":"...","reason":"..."}],"uncertainty":"...","confidence":0.8}.',
      `Task:\n${task.contract.objective}`,
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
      const decision = parseTaskJudgeDecision(extractAssistantText(response.content), criteria.length);
      const now = Date.now();
      const evidence: TaskEvidence[] = decision.completedCriteria.map((index) => ({
        kind: 'state',
        title: `Independently verified: ${criteria[index]}`,
        summary: decision.judgment.reasons[0]!,
        verifies: [criteria[index]!],
        provenance: 'judge',
        strength: 'verified',
        observedAt: now,
      }));
      if (decision.needsUser) {
        this.#runs.createWait({
          taskId,
          taskRunId: run.id,
          kind: 'user_input',
          reason: decision.judgment.recommendation,
          condition: { question: decision.nextAction ?? decision.judgment.recommendation },
        });
        this.#runs.setStatus({ runId: run.id, expectedVersion: run.version, from: ['running'], to: 'waiting' });
        return;
      }
      const checks = criteria.map((criterion, index) => ({
        criterion,
        status: decision.completedCriteria.includes(index) ? 'passed' as const : 'unverified' as const,
        evidenceTitles: evidence.filter((item) => item.verifies?.includes(criterion)).map((item) => item.title),
      }));
      const passed = checks.every((check) => check.status === 'passed');
      this.#application.completeRun({
        runId: run.id,
        expectedRunVersion: run.version,
        receipt: {
          status: 'succeeded',
          summary: payload.assistantPlainText.slice(-2_000) || 'Agent run completed',
          changes: [], evidence,
          verification: { status: passed ? 'passed' : 'unverified', checks },
          remainingWork: checks.filter((check) => check.status !== 'passed').map((check) => check.criterion),
          ...(decision.nextAction ? { nextAction: decision.nextAction } : {}),
          needsUser: false,
          completionVerdict: passed ? 'achieved' : 'partial',
          judgment: decision.judgment,
        },
      });
    } catch (error) {
      log.warn({ err: error, taskId, sessionKey: payload.sessionKey }, 'Task review failed');
    }
  }
}
