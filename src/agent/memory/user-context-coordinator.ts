import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { Config } from '../../config/schema.js';
import { parseSessionKey } from '../../routing/session-key.js';
import {
  getTurnPersonalization,
  recordContextFeedback,
  setUnderstandingStatus,
} from '../../storage/sqlite/index.js';
import { createLogger } from '../../utils/logger.js';
import { UserContextPlanner } from '../../user-context/planner.js';
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
  getWorkspaceIdForSession?: (sessionKey: string) => string;
  getProjectIdForSession?: (sessionKey: string) => string | undefined;
  getMemoryManagerForSession: (sessionKey: string) => MemoryManager;
  getLastAssistantContent: (sessionKey: string) => string | null;
}

export class UserContextCoordinator {
  private readonly userTurn = new Map<string, number>();
  private readonly lastTurnId = new Map<string, string>();
  private readonly correctionTargets = new Map<string, string[]>();
  private readonly planner = new UserContextPlanner();

  constructor(private readonly options: UserContextCoordinatorOptions) {}

  forgetSession(sessionKey: string): void {
    this.userTurn.delete(sessionKey);
    this.lastTurnId.delete(sessionKey);
    this.correctionTargets.delete(sessionKey);
  }

  clear(): void {
    this.userTurn.clear();
    this.lastTurnId.clear();
    this.correctionTargets.clear();
  }

  async prepare(userMessage: AgentMessage, sessionKey: string, turnId: string): Promise<UserContextPlan> {
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
    const previousTurnId = this.lastTurnId.get(sessionKey);
    this.lastTurnId.set(sessionKey, turnId);
    this.correctionTargets.delete(sessionKey);
    let excludedRecordIds: string[] | undefined;
    if (previousTurnId && isExplicitUnderstandingCorrection(userQuery)) {
      try {
        const personalization = getTurnPersonalization(previousTurnId);
        const selectedIds = personalization?.items
          .filter((item) => item.objectType === 'understanding' && item.decision === 'selected')
          .map((item) => item.objectId) ?? [];
        if (personalization && selectedIds.length) {
          for (const recordId of selectedIds) {
            recordContextFeedback({
              turnId: previousTurnId,
              runId: personalization.runId,
              objectType: 'understanding',
              objectId: recordId,
              rating: 'wrong',
              reason: 'detected_explicit_user_correction',
            });
            setUnderstandingStatus(recordId, 'needs_review');
          }
          this.correctionTargets.set(sessionKey, selectedIds);
          excludedRecordIds = selectedIds;
        }
      } catch (err) {
        log.debug({ err, sessionKey }, 'Understanding correction feedback was not persisted');
      }
    }
    const turn = (this.userTurn.get(sessionKey) ?? 0) + 1;
    this.userTurn.set(sessionKey, turn);
    if (!shouldPlanUserContextThisTurn(config, turn)) return empty();
    const plan = this.planner.plan({
      sessionKey,
      channel: parseSessionKey(sessionKey)?.source,
      workspaceId: this.options.getWorkspaceIdForSession?.(sessionKey) ?? '',
      projectId: this.options.getProjectIdForSession?.(sessionKey),
      turnId,
      query,
      userMessage,
      excludedRecordIds,
      allocation: taskContext.allocation,
    });
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
          turnId: this.lastTurnId.get(sessionKey),
          workspaceId: this.options.getWorkspaceIdForSession?.(sessionKey),
          projectId: this.options.getProjectIdForSession?.(sessionKey),
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
