import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { Config } from '../../config/schema.js';
import { setLatestMemoryInjectFeedback } from '../../storage/sqlite/index.js';
import { createLogger } from '../../utils/logger.js';
import { ContextCompiler } from '../../user-context/context-compiler.js';
import { UserContextPlanner } from './context/planner.js';
import type { UserContextPlan } from './context/types.js';
import type { MemoryManager } from './manager.js';
import {
  shouldPlanUserContextThisTurn,
} from './memory-config.js';
import { isExplicitUnderstandingCorrection } from './understanding/correction.js';
import { extractAgentUserPlainText } from './user-message-text.js';
import { assembleTaskContext } from '../../tasks/task-context-assembler.js';

const log = createLogger('UserContextCoordinator');

export interface UserContextCoordinatorOptions {
  getConfig: () => Config | undefined;
  isEnabledForSession: (sessionKey: string) => boolean;
  getAgentIdForSession: (sessionKey: string) => string;
  getMemoryManagerForSession: (sessionKey: string) => MemoryManager;
  getLastAssistantContent: (sessionKey: string) => string | null;
}

export class UserContextCoordinator {
  private readonly userTurn = new Map<string, number>();
  private readonly correctionTargets = new Map<string, string[]>();
  private readonly planner = new UserContextPlanner();
  private readonly contextCompiler = new ContextCompiler();

  constructor(private readonly options: UserContextCoordinatorOptions) {}

  forgetSession(sessionKey: string): void {
    this.userTurn.delete(sessionKey);
    this.correctionTargets.delete(sessionKey);
  }

  clear(): void {
    this.userTurn.clear();
    this.correctionTargets.clear();
  }

  async prepare(userMessage: AgentMessage, sessionKey: string): Promise<UserContextPlan> {
    const empty = (): UserContextPlan => ({
      traceId: '',
      modelMessage: userMessage,
      items: [],
      rejected: [],
      consentRequests: [],
      estimatedTokens: 0,
    });
    const config = this.options.getConfig();
    if (!this.options.isEnabledForSession(sessionKey)) return empty();
    const userQuery = extractAgentUserPlainText(userMessage);
    const taskContext = assembleTaskContext(sessionKey, userQuery);
    const query = taskContext.retrievalQuery;
    this.correctionTargets.delete(sessionKey);
    let excludedRecordIds: string[] | undefined;
    if (isExplicitUnderstandingCorrection(userQuery)) {
      try {
        const trace = setLatestMemoryInjectFeedback({
          sessionKey,
          requireSelectedRecords: true,
          feedback: {
            rating: 'not_helpful',
            source: 'system',
            reason: 'detected_explicit_user_correction',
          },
        });
        if (trace?.selectedRecordIds.length) {
          this.correctionTargets.set(sessionKey, trace.selectedRecordIds);
          excludedRecordIds = trace.selectedRecordIds;
        }
      } catch (err) {
        log.debug({ err, sessionKey }, 'Understanding correction feedback was not persisted');
      }
    }
    const turn = (this.userTurn.get(sessionKey) ?? 0) + 1;
    this.userTurn.set(sessionKey, turn);
    if (!shouldPlanUserContextThisTurn(config, turn)) return empty();
    const plan = await this.planner.plan({
      memoryManager: this.options.getMemoryManagerForSession(sessionKey),
      agentId: this.options.getAgentIdForSession(sessionKey),
      sessionKey,
      query,
      userMessage,
      excludedRecordIds,
      allocation: taskContext.allocation,
    });
    if (plan.traceId) {
      try {
        this.contextCompiler.capture({ sessionKey, query, plan });
      } catch (err) {
        log.debug({ err, sessionKey, traceId: plan.traceId }, 'Context snapshot was not persisted');
      }
    }
    return plan;
  }

  async afterTurn(sessionKey: string, userPlainText: string): Promise<import('./understanding/types.js').UnderstandingReviewResult | undefined> {
    if (!this.options.isEnabledForSession(sessionKey)) return undefined;
    const memoryManager = this.options.getMemoryManagerForSession(sessionKey);
    const assistantContent = this.options.getLastAssistantContent(sessionKey) ?? '';
    const correctionTargetRecordIds = this.correctionTargets.get(sessionKey);
    this.correctionTargets.delete(sessionKey);
    try {
      const review = await memoryManager.captureTurnUnderstanding(
        userPlainText,
        assistantContent,
        {
          agentId: this.options.getAgentIdForSession(sessionKey),
          sessionId: sessionKey,
          correctionTargetRecordIds,
        },
      );
      void memoryManager.syncProvidersForTurn(userPlainText, assistantContent, { sessionId: sessionKey });
      memoryManager.queuePrefetchAll(userPlainText, { sessionId: sessionKey });
      return review;
    } catch (err) {
      log.warn({ err, sessionKey }, 'Turn understanding capture failed');
    }
    void memoryManager.syncProvidersForTurn(userPlainText, assistantContent, { sessionId: sessionKey });
    memoryManager.queuePrefetchAll(userPlainText, { sessionId: sessionKey });
    return undefined;
  }
}
