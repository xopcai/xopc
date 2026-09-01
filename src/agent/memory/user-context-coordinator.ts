import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { Config } from '../../config/schema.js';
import { parseSessionKey } from '../../routing/session-key.js';
import { UserContextPlanner } from '../../user-context/planner.js';
import type { UserContextPlan } from './context/types.js';
import type { MemoryManager } from './manager.js';
import {
  shouldPlanUserContextThisTurn,
} from './memory-config.js';
import { extractAgentUserPlainText } from './user-message-text.js';
import { assembleTaskContext } from '../../tasks/task-context-assembler.js';
import { consumeTurnMemoryProvenance, markTurnRecalledContext } from './turn-provenance.js';
import { planTrustedRecall } from './trusted-recall.js';
import { prependAgentContext } from '../../user-context/planner.js';

export interface UserContextCoordinatorOptions {
  getConfig: () => Config | undefined;
  isEnabledForSession: (sessionKey: string) => boolean;
  getWorkspaceIdForSession?: (sessionKey: string) => string;
  getProjectIdForSession?: (sessionKey: string) => string | undefined;
  getMemoryManagerForSession: (sessionKey: string) => MemoryManager;
  getLastAssistantContent: (sessionKey: string) => string | null;
}

function isPrivateSession(sessionKey: string): boolean {
  const parsed = parseSessionKey(sessionKey);
  return !parsed || parsed.peerKind === 'direct';
}

export class UserContextCoordinator {
  private readonly userTurn = new Map<string, number>();
  private readonly lastTurnId = new Map<string, string>();
  private readonly planner = new UserContextPlanner();

  constructor(private readonly options: UserContextCoordinatorOptions) {}

  forgetSession(sessionKey: string): void {
    this.userTurn.delete(sessionKey);
    this.lastTurnId.delete(sessionKey);
  }

  clear(): void {
    this.userTurn.clear();
    this.lastTurnId.clear();
  }

  async prepare(userMessage: AgentMessage, sessionKey: string, turnId: string): Promise<UserContextPlan> {
    const empty = (): UserContextPlan => ({
      traceId: '',
      modelMessage: userMessage,
      items: [],
      rejected: [],
      consentRequests: [],
      estimatedTokens: 0,
      contextChars: 0,
      contextItemCount: 0,
    });
    if (!this.options.isEnabledForSession(sessionKey)) return empty();
    const config = this.options.getConfig();
    if (!isPrivateSession(sessionKey)) return empty();
    const userQuery = extractAgentUserPlainText(userMessage);
    const taskContext = assembleTaskContext(sessionKey, userQuery);
    const query = taskContext.retrievalQuery;
    this.lastTurnId.set(sessionKey, turnId);
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
      allocation: taskContext.allocation,
    });
    const totalChars = taskContext.allocation.maxChars;
    const remainingChars = Math.max(0, totalChars - plan.contextChars);
    const remainingResults = Math.max(0, taskContext.allocation.maxResults - plan.contextItemCount);
    const memoryBudget = Math.min(1_600, Math.floor(totalChars * 0.2), remainingChars);
    const memoryManager = this.options.getMemoryManagerForSession(sessionKey);
    const recallResults = memoryBudget >= 256
      ? await memoryManager.search({
        query,
        scope: {
          workspaceId: this.options.getWorkspaceIdForSession?.(sessionKey),
          projectId: this.options.getProjectIdForSession?.(sessionKey),
          sessionKey,
        },
        maxResults: 8,
        minScore: 0.25,
        trustedOnly: true,
      })
      : [];
    const recall = planTrustedRecall(recallResults, memoryBudget, remainingResults);
    if (plan.contextChars > 0 || recall.selected.length > 0) {
      markTurnRecalledContext(sessionKey, turnId);
    }
    for (const result of recall.selected) {
      memoryManager.recordSignal({
        source: 'context_injection',
        recordId: result.record.id,
        score: result.score,
        metadata: {
          sessionKey,
          turnId,
          workspaceId: this.options.getWorkspaceIdForSession?.(sessionKey),
          budgetChars: memoryBudget,
          injectedChars: recall.usedChars,
        },
      });
    }
    return {
      ...plan,
      modelMessage: prependAgentContext(plan.modelMessage, recall.block),
      memoryRecordIds: recall.selected.map((result) => result.record.id),
      contextChars: plan.contextChars + recall.usedChars,
      contextItemCount: plan.contextItemCount + recall.selected.length,
      estimatedTokens: Math.ceil((plan.contextChars + recall.usedChars) / 4),
    };
  }

  async afterTurn(sessionKey: string, userPlainText: string): Promise<void> {
    if (!this.options.isEnabledForSession(sessionKey)) return;
    const memoryManager = this.options.getMemoryManagerForSession(sessionKey);
    const assistantContent = this.options.getLastAssistantContent(sessionKey) ?? '';
    if (!isPrivateSession(sessionKey)) return;
    const turnId = this.lastTurnId.get(sessionKey);
    const provenance = turnId
      ? consumeTurnMemoryProvenance(sessionKey, turnId)
      : undefined;
    void memoryManager.syncProvidersForTurn(userPlainText, assistantContent, {
      sessionId: sessionKey,
      turnId,
      provenance,
    });
    memoryManager.queuePrefetchAll(userPlainText, { sessionId: sessionKey });
  }
}
