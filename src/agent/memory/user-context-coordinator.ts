import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { Config } from '../../config/schema.js';
import { setLatestMemoryInjectFeedback } from '../../storage/sqlite/index.js';
import { createLogger } from '../../utils/logger.js';
import { UserContextPlanner } from './context/planner.js';
import type { UserContextPlan } from './context/types.js';
import type { MemoryManager } from './manager.js';
import {
  shouldPlanUserContextThisTurn,
} from './memory-config.js';
import { isExplicitUnderstandingCorrection } from './understanding/correction.js';
import { extractAgentUserPlainText } from './user-message-text.js';

const log = createLogger('UserContextCoordinator');

export interface UserContextCoordinatorOptions {
  getConfig: () => Config | undefined;
  isEnabledForSession: (sessionKey: string) => boolean;
  getMemoryManagerForSession: (sessionKey: string) => MemoryManager;
  getLastAssistantContent: (sessionKey: string) => string | null;
}

export class UserContextCoordinator {
  private readonly userTurn = new Map<string, number>();
  private readonly correctionTargets = new Map<string, string[]>();
  private readonly planner = new UserContextPlanner();

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
      estimatedTokens: 0,
    });
    const config = this.options.getConfig();
    if (!this.options.isEnabledForSession(sessionKey)) return empty();
    const query = extractAgentUserPlainText(userMessage);
    this.correctionTargets.delete(sessionKey);
    if (isExplicitUnderstandingCorrection(query)) {
      try {
        const trace = setLatestMemoryInjectFeedback({
          sessionKey,
          requireSelectedRecords: true,
          feedback: {
            outcome: 'not_helpful',
            source: 'system',
            reason: 'detected_explicit_user_correction',
          },
        });
        if (trace?.selectedRecordIds.length) {
          this.correctionTargets.set(sessionKey, trace.selectedRecordIds);
        }
      } catch (err) {
        log.debug({ err, sessionKey }, 'Understanding correction feedback was not persisted');
      }
    }
    const turn = (this.userTurn.get(sessionKey) ?? 0) + 1;
    this.userTurn.set(sessionKey, turn);
    if (!shouldPlanUserContextThisTurn(config, turn)) return empty();
    return this.planner.plan({
      memoryManager: this.options.getMemoryManagerForSession(sessionKey),
      sessionKey,
      query,
      userMessage,
    });
  }

  async afterTurn(sessionKey: string, userPlainText: string): Promise<void> {
    if (!this.options.isEnabledForSession(sessionKey)) return;
    const memoryManager = this.options.getMemoryManagerForSession(sessionKey);
    const assistantContent = this.options.getLastAssistantContent(sessionKey) ?? '';
    const correctionTargetRecordIds = this.correctionTargets.get(sessionKey);
    this.correctionTargets.delete(sessionKey);
    try {
      await memoryManager.captureTurnUnderstanding(
        userPlainText,
        assistantContent,
        { sessionId: sessionKey, correctionTargetRecordIds },
      );
    } catch (err) {
      log.warn({ err, sessionKey }, 'Turn understanding capture failed');
    }
    void memoryManager.syncProvidersForTurn(userPlainText, assistantContent, { sessionId: sessionKey });
    memoryManager.queuePrefetchAll(userPlainText, { sessionId: sessionKey });
  }
}
