import type { Config } from '../config/schema.js';
import { getAgentDefaultModelRef } from '../config/schema.js';
import { renderWorkflowText } from '../agent/workflow/snapshot.js';
import { evaluateAfterTurnHermesLike } from '../agent/goals/evaluate-turn.js';
import { resolveGoalUiLocale } from '../agent/goals/goal-locale.js';
import type { PersistentGoalState } from '../agent/goals/state.js';
import type { WorkflowRunView } from '../workflows/domain/index.js';
import { runViewToSnapshot } from '../workflows/service/run-view-to-snapshot.js';
import { createLogger } from '../utils/logger.js';

import { GoalService } from './goal-service.js';

const log = createLogger('GoalWorkflowJudge');

export interface GoalWorkflowJudgeInput {
  config: Config | undefined;
  view: WorkflowRunView;
  sessionKey: string;
}

export class GoalWorkflowJudge {
  private readonly goals = new GoalService();

  async handleTerminalWorkflowRun(input: GoalWorkflowJudgeInput): Promise<void> {
    const goalId = input.view.run.metadata?.goalId?.trim();
    if (!goalId) return;

    const goal = this.goals.get(goalId);
    if (!goal) return;

    const resultText = renderWorkflowText(
      runViewToSnapshot(input.view),
      input.view.run.status === 'succeeded',
      { showResultPreviews: true },
    );

    if (input.view.run.status !== 'succeeded') {
      this.markBlockedFromFailedWorkflow({
        goalId,
        sessionKey: input.sessionKey,
        view: input.view,
        resultText,
      });
      return;
    }

    const judgeModelRef = input.config?.goals?.judgeModelRef?.trim()
      || goal.judgeModelRef?.trim()
      || (input.config ? getAgentDefaultModelRef(input.config) : undefined);
    if (!judgeModelRef) {
      log.warn({ goalId, workflowRunId: input.view.run.id }, 'Workflow goal judge skipped: no judge model');
      return;
    }

    const state: PersistentGoalState = {
      goal: goal.title,
      status: 'active',
      turnsUsed: goal.turnsUsed,
      maxTurns: goal.maxTurns,
      createdAt: goal.createdAt,
      lastTurnAt: goal.updatedAt,
      lastReason: goal.blockedReason,
      judgeModelRef: goal.judgeModelRef,
      decomposed: goal.checklist.length > 0 ? true : undefined,
      uiLocale: goal.uiLocale,
      checklist: goal.checklist.map((item) => ({
        text: item.text,
        status: item.status,
        addedBy: item.addedBy,
        addedAt: item.addedAt,
        completedAt: item.completedAt,
        evidence: item.evidenceSummary,
      })),
    };

    const decision = await evaluateAfterTurnHermesLike(state, resultText, judgeModelRef, undefined, {
      goalsSlice: input.config?.goals,
      historyExcerpt: resultText,
      uiLocale: resolveGoalUiLocale(state),
    });

    if (!decision.newState) return;
    const next = decision.newState;
    const completedChecklistItemIds = decision.completedChecklistItemIndexes
      ?.map((index) => goal.checklist[index]?.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

    const updatedGoal = this.goals.syncPostTurnState({
      goalId,
      sessionKey: input.sessionKey,
      source: 'workflow',
      status: next.status === 'done'
        ? 'done'
        : decision.verdict === 'blocked'
          ? 'blocked'
          : decision.verdict === 'needs_input'
            ? 'needs_input'
            : next.status === 'paused'
              ? 'paused'
              : 'active',
      turnsUsed: next.turnsUsed,
      maxTurns: next.maxTurns,
      reason: next.pausedReason ?? decision.reason,
      nextAction: decision.continuationPrompt ?? undefined,
      assistantPreview: resultText,
      verdict: decision.verdict === 'done'
        ? 'done'
        : decision.verdict === 'decompose'
          ? 'decompose'
          : decision.verdict === 'blocked'
            ? 'blocked'
            : decision.verdict === 'needs_input'
              ? 'needs_input'
              : 'continue',
      confidence: decision.confidence,
      missingEvidence: decision.missingEvidence,
      userQuestion: decision.userQuestion,
      completedChecklistItemIds,
      checklist: next.checklist?.map((item) => ({
        text: item.text,
        status: item.status,
        addedBy: item.addedBy,
        addedAt: item.addedAt,
        completedAt: item.completedAt,
        evidenceSummary: item.evidence,
      })),
    });

    this.recordWorkflowEvidence({
      goalId,
      runId: updatedGoal?.currentRunId,
      view: input.view,
      summary: decision.reason || `Workflow ${input.view.run.definitionId} succeeded`,
    });
  }

  private markBlockedFromFailedWorkflow(input: {
    goalId: string;
    sessionKey: string;
    view: WorkflowRunView;
    resultText: string;
  }): void {
    const current = this.goals.get(input.goalId);
    const reason = input.view.run.error?.message
      || `Workflow ${input.view.run.definitionId} finished with status ${input.view.run.status}`;
    const goal = this.goals.syncPostTurnState({
      goalId: input.goalId,
      sessionKey: input.sessionKey,
      source: 'workflow',
      status: 'blocked',
      turnsUsed: (current?.turnsUsed ?? 0) + 1,
      maxTurns: current?.maxTurns ?? 10,
      verdict: 'blocked',
      reason,
      nextAction: `Investigate workflow ${input.view.run.id} failure.`,
      assistantPreview: input.resultText,
    });
    this.recordWorkflowEvidence({
      goalId: input.goalId,
      runId: goal?.currentRunId,
      view: input.view,
      summary: reason,
    });
  }

  private recordWorkflowEvidence(input: {
    goalId: string;
    runId?: string;
    view: WorkflowRunView;
    summary: string;
  }): void {
    this.goals.addEvidence({
      goalId: input.goalId,
      runId: input.runId,
      kind: 'artifact',
      title: `Workflow ${input.view.run.definitionId} ${input.view.run.status}`,
      summary: input.summary,
      uri: `workflow:${input.view.run.id}`,
      data: {
        workflowRunId: input.view.run.id,
        status: input.view.run.status,
        metrics: input.view.run.metrics,
      },
    });
    for (const artifact of input.view.artifacts) {
      this.goals.addEvidence({
        goalId: input.goalId,
        runId: input.runId,
        kind: 'artifact',
        title: artifact.title || artifact.name,
        summary: `${artifact.mimeType} · ${artifact.sizeBytes} bytes`,
        uri: `workflow:${input.view.run.id}:artifact:${artifact.id}`,
        data: artifact,
      });
    }
  }
}
