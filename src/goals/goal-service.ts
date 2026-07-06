import type { Config } from '../config/schema.js';
import { defaultMaxTurns } from '../agent/goals/state.js';
import { publishAutomationProductEvent } from '../automations/product-events.js';
import { GoalStore } from './goal-store.js';
import type {
  CreateGoalInput,
  Goal,
  GoalChecklistAddedBy,
  GoalChecklistStatus,
  GoalContextAttachment,
  GoalJudgeDecision,
  GoalListQuery,
  GoalSource,
  GoalStatus,
  GoalUiLocale,
  GoalWithDetails,
} from './types.js';

function normalizeTitle(title: string): string {
  const t = title.trim();
  if (!t) throw new Error('Goal title is required');
  return t;
}

function toTerminalStatus(verdict: GoalJudgeDecision['verdict']): GoalStatus {
  if (verdict === 'done') return 'done';
  if (verdict === 'blocked') return 'blocked';
  if (verdict === 'needs_input') return 'needs_input';
  return 'active';
}

function publishGoalEvent(
  type: 'goal.created' | 'goal.status_changed',
  goal: Goal,
  extra?: Record<string, unknown>,
): void {
  publishAutomationProductEvent({
    type,
    source: 'goals',
    payload: {
      goalId: goal.id,
      title: goal.title,
      status: goal.status,
      priority: goal.priority,
      sessionKey: goal.activeSessionKey,
      agentId: goal.agentId,
      source: goal.source,
      ...extra,
    },
  });
}

function publishGoalStatusEvent(
  goal: Goal,
  previousStatus?: GoalStatus,
  reason?: string,
): void {
  if (previousStatus === goal.status) return;
  publishGoalEvent('goal.status_changed', goal, {
    previousStatus,
    reason,
  });
}

export class GoalService {
  private readonly store: GoalStore;

  constructor(store = new GoalStore()) {
    this.store = store;
  }

  create(input: Omit<CreateGoalInput, 'maxTurns' | 'agentId'> & {
    maxTurns?: number;
    agentId?: string;
    config?: Config;
  }): Goal {
    const sessionKey = input.sessionKey;
    const cfg = input.config?.goals;
    const goal = this.store.create({
      title: normalizeTitle(input.title),
      description: input.description,
      agentId: input.agentId ?? 'main',
      sessionKey,
      priority: input.priority,
      deadlineAt: input.deadlineAt,
      judgeModelRef: input.judgeModelRef ?? cfg?.judgeModelRef,
      maxTurns: input.maxTurns ?? defaultMaxTurns(cfg),
      uiLocale: input.uiLocale,
      source: input.source,
      projectId: input.projectId,
    });
    publishGoalEvent('goal.created', goal);
    return goal;
  }

  get(goalId: string): GoalWithDetails | null {
    const goal = this.store.get(goalId);
    if (!goal) return null;
    return {
      ...goal,
      checklist: this.store.listChecklist(goalId),
      latestRun: this.store.listRuns(goalId, 1)[0],
      contextMessage: this.store.getContextMessage(goalId) ?? undefined,
    };
  }

  getActiveForSession(sessionKey: string): GoalWithDetails | null {
    const goal = this.store.getActiveForSession(sessionKey);
    return goal ? this.get(goal.id) : null;
  }

  list(query: GoalListQuery = {}): GoalWithDetails[] {
    return this.store.list(query).map((goal) => ({
      ...goal,
      checklist: this.store.listChecklist(goal.id),
      latestRun: this.store.listRuns(goal.id, 1)[0],
      contextMessage: this.store.getContextMessage(goal.id) ?? undefined,
    }));
  }

  setContextMessage(input: {
    goalId: string;
    text: string;
    attachments?: GoalContextAttachment[];
  }): GoalWithDetails | null {
    if (!this.store.get(input.goalId)) return null;
    this.store.setContextMessage(input);
    return this.get(input.goalId);
  }

  update(goalId: string, patch: Partial<Pick<
    Goal,
    | 'title'
    | 'description'
    | 'priority'
    | 'deadlineAt'
    | 'maxTurns'
    | 'judgeModelRef'
    | 'nextAction'
    | 'blockedReason'
    | 'activeSessionKey'
    | 'uiLocale'
    | 'projectId'
  >>): GoalWithDetails | null {
    const normalized: typeof patch = { ...patch };
    if (typeof normalized.title === 'string') {
      normalized.title = normalizeTitle(normalized.title);
    }
    if (typeof normalized.description === 'string') {
      normalized.description = normalized.description.trim() || undefined;
    }
    if (typeof normalized.judgeModelRef === 'string') {
      normalized.judgeModelRef = normalized.judgeModelRef.trim() || undefined;
    }
    if (typeof normalized.nextAction === 'string') {
      normalized.nextAction = normalized.nextAction.trim() || undefined;
    }
    if (typeof normalized.blockedReason === 'string') {
      normalized.blockedReason = normalized.blockedReason.trim() || undefined;
    }
    if (typeof normalized.maxTurns === 'number') {
      normalized.maxTurns = Math.max(1, Math.min(500, Math.floor(normalized.maxTurns)));
    }
    const goal = this.store.update(goalId, normalized);
    return goal ? this.get(goal.id) : null;
  }

  setStatus(goalId: string, status: GoalStatus, opts?: { reason?: string }): GoalWithDetails | null {
    const previous = this.store.get(goalId);
    const now = Date.now();
    const goal = this.store.update(goalId, {
      status,
      completedAt: status === 'done' ? now : undefined,
      archivedAt: status === 'archived' ? now : undefined,
      blockedReason: status === 'blocked' || status === 'needs_input' ? opts?.reason : undefined,
    });
    if (goal) publishGoalStatusEvent(goal, previous?.status, opts?.reason);
    return goal ? this.get(goal.id) : null;
  }

  pause(goalId: string, reason = 'user-paused'): GoalWithDetails | null {
    const previous = this.store.get(goalId);
    const goal = this.store.update(goalId, {
      status: 'paused',
      blockedReason: reason,
      completedAt: undefined,
      archivedAt: undefined,
    });
    if (goal) publishGoalStatusEvent(goal, previous?.status, reason);
    return goal ? this.get(goal.id) : null;
  }

  resume(goalId: string): GoalWithDetails | null {
    const previous = this.store.get(goalId);
    const goal = this.store.update(goalId, {
      status: 'active',
      blockedReason: undefined,
      completedAt: undefined,
      archivedAt: undefined,
      turnsUsed: 0,
    });
    if (goal) publishGoalStatusEvent(goal, previous?.status);
    return goal ? this.get(goal.id) : null;
  }

  reopen(goalId: string): GoalWithDetails | null {
    const previous = this.store.get(goalId);
    const goal = this.store.update(goalId, {
      status: 'active',
      blockedReason: undefined,
      completedAt: undefined,
      archivedAt: undefined,
      turnsUsed: 0,
    });
    if (goal) publishGoalStatusEvent(goal, previous?.status);
    return goal ? this.get(goal.id) : null;
  }

  complete(goalId: string): GoalWithDetails | null {
    return this.setStatus(goalId, 'done');
  }

  archive(goalId: string): GoalWithDetails | null {
    return this.setStatus(goalId, 'archived');
  }

  unarchive(goalId: string): GoalWithDetails | null {
    const previous = this.store.get(goalId);
    const goal = this.store.update(goalId, {
      status: 'paused',
      archivedAt: undefined,
      completedAt: undefined,
      blockedReason: undefined,
    });
    if (goal) publishGoalStatusEvent(goal, previous?.status);
    return goal ? this.get(goal.id) : null;
  }

  attachSession(goalId: string, sessionKey: string): GoalWithDetails | null {
    const goal = this.store.update(goalId, { activeSessionKey: sessionKey });
    return goal ? this.get(goal.id) : null;
  }

  updateChecklist(goalId: string, op: {
    type: 'add';
    text: string;
    addedBy?: GoalChecklistAddedBy;
  } | {
    type: 'mark';
    itemId: string;
    status: GoalChecklistStatus;
    evidenceSummary?: string;
  } | {
    type: 'remove';
    itemId: string;
  } | {
    type: 'reset';
  }): GoalWithDetails | null {
    if (op.type === 'add') {
      const text = op.text.trim();
      if (!text) throw new Error('Checklist item text is required');
      this.store.addChecklistItem({ goalId, text, addedBy: op.addedBy ?? 'user' });
    } else if (op.type === 'mark') {
      this.store.updateChecklistItem(op.itemId, {
        status: op.status,
        evidenceSummary: op.evidenceSummary,
      });
    } else if (op.type === 'remove') {
      this.store.removeChecklistItem(op.itemId);
    } else {
      this.store.clearChecklist(goalId);
    }
    return this.get(goalId);
  }

  recordJudgeDecision(input: {
    goalId: string;
    sessionKey: string;
    source: GoalSource;
    decision: GoalJudgeDecision;
  }): GoalWithDetails | null {
    const goal = this.store.get(input.goalId);
    if (!goal) return null;
    const previousStatus = goal.status;
    const nextStatus = toTerminalStatus(input.decision.verdict);
    const turnsUsed = goal.turnsUsed + 1;
    const status = turnsUsed >= goal.maxTurns && nextStatus === 'active' ? 'paused' : nextStatus;
    const reason =
      status === 'paused' && turnsUsed >= goal.maxTurns
        ? `turn budget exhausted (${turnsUsed}/${goal.maxTurns})`
        : input.decision.reason;

    const run = this.store.appendRun({
      goalId: input.goalId,
      sessionKey: input.sessionKey,
      source: input.source,
      status: 'succeeded',
      finishedAt: Date.now(),
      verdict: input.decision.verdict,
      reason: input.decision.reason,
      nextAction: input.decision.nextAction,
      assistantPreview: input.decision.assistantPreview,
      checklistProgress: input.decision.checklistProgress,
      confidence: input.decision.confidence,
      missingEvidence: input.decision.missingEvidence,
      userQuestion: input.decision.userQuestion,
      completedChecklistItemIds: input.decision.completedChecklistItemIds,
    });

    const updated = this.store.update(input.goalId, {
      status,
      turnsUsed,
      currentRunId: run.id,
      nextAction: input.decision.nextAction,
      blockedReason: status === 'blocked' || status === 'needs_input' || status === 'paused' ? reason : undefined,
      completedAt: status === 'done' ? Date.now() : undefined,
    });
    if (updated) publishGoalStatusEvent(updated, previousStatus, reason);

    return this.get(input.goalId);
  }

  syncPostTurnState(input: {
    goalId: string;
    sessionKey: string;
    source: GoalSource;
    status: GoalStatus;
    turnsUsed: number;
    maxTurns: number;
    reason?: string;
    nextAction?: string;
    assistantPreview?: string;
    verdict: 'continue' | 'done' | 'blocked' | 'needs_input' | 'decompose';
    confidence?: number;
    missingEvidence?: string[];
    userQuestion?: string;
    completedChecklistItemIds?: string[];
    checklist?: Array<{
      text: string;
      status: 'pending' | 'completed' | 'impossible';
      addedBy: 'user' | 'judge';
      addedAt?: number;
      completedAt?: number;
      evidenceSummary?: string;
    }>;
  }): GoalWithDetails | null {
    const goal = this.store.get(input.goalId);
    if (!goal) return null;
    const previousStatus = goal.status;
    if (input.checklist) {
      this.store.replaceChecklist(input.goalId, input.checklist);
    }
    const total = input.checklist?.length ?? this.store.listChecklist(input.goalId).length;
    const done = (input.checklist ?? this.store.listChecklist(input.goalId)).filter(
      (it) => it.status === 'completed' || it.status === 'impossible',
    ).length;
    const run = this.store.appendRun({
      goalId: input.goalId,
      sessionKey: input.sessionKey,
      source: input.source,
      status: 'succeeded',
      finishedAt: Date.now(),
      verdict: input.verdict,
      reason: input.reason,
      nextAction: input.nextAction,
      assistantPreview: input.assistantPreview,
      checklistProgress: total > 0 ? { done, total } : undefined,
      confidence: input.confidence,
      missingEvidence: input.missingEvidence,
      userQuestion: input.userQuestion,
      completedChecklistItemIds: input.completedChecklistItemIds,
    });
    for (const item of input.checklist ?? []) {
      if ((item.status === 'completed' || item.status === 'impossible') && item.evidenceSummary?.trim()) {
        this.store.addEvidence({
          goalId: input.goalId,
          runId: run.id,
          kind: 'message',
          title: `Checklist evidence: ${item.text.slice(0, 80)}`,
          summary: item.evidenceSummary.trim(),
        });
      }
    }
    for (const missing of input.missingEvidence ?? []) {
      if (!missing.trim()) continue;
      this.store.addEvidence({
        goalId: input.goalId,
        runId: run.id,
        kind: 'message',
        title: `Missing evidence: ${missing.slice(0, 80)}`,
        summary: missing,
      });
    }
    if (input.userQuestion?.trim()) {
      this.store.addEvidence({
        goalId: input.goalId,
        runId: run.id,
        kind: 'message',
        title: 'User input requested',
        summary: input.userQuestion.trim(),
      });
    }
    const updated = this.store.update(input.goalId, {
      status: input.status,
      turnsUsed: input.turnsUsed,
      maxTurns: input.maxTurns,
      currentRunId: run.id,
      nextAction: input.nextAction,
      blockedReason:
        input.status === 'blocked' || input.status === 'needs_input' || input.status === 'paused'
          ? input.reason
          : undefined,
      completedAt: input.status === 'done' ? Date.now() : undefined,
    });
    if (updated) publishGoalStatusEvent(updated, previousStatus, input.reason);
    return this.get(input.goalId);
  }

  listRuns(goalId: string, limit?: number) {
    return this.store.listRuns(goalId, limit);
  }

  listRunsForSession(sessionKey: string, limit?: number) {
    return this.store.listRunsForSession(sessionKey, limit);
  }

  listEvents(goalId: string, limit?: number) {
    return this.store.listEvents(goalId, limit);
  }

  addEvidence(input: Parameters<GoalStore['addEvidence']>[0]) {
    return this.store.addEvidence(input);
  }

  listEvidence(goalId: string, limit?: number) {
    return this.store.listEvidence(goalId, limit);
  }
}

export function normalizeGoalUiLocale(raw: unknown): GoalUiLocale | undefined {
  return raw === 'en' || raw === 'zh' ? raw : undefined;
}
