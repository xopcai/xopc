import type { ExecutionReceipt } from '../../storage/sqlite/execution-receipt-repository.js';
import { verifyExecutionCompletion } from './execution-verifier.js';

export interface ExecutionEvaluationReplay {
  total: number;
  falseCompletions: number;
  verificationDrift: number;
  supportMismatches: number;
  recoverySuccessRate: number;
  judgmentCoverage: number;
  userInterventionRate: number;
  channelConsistencyGap: number;
  byChannel: Record<string, {
    total: number;
    verified: number;
    helpful: number;
    rated: number;
  }>;
  cases: Array<{
    runId: string;
    storedVerification: string;
    replayedVerification: string;
  }>;
}

export function replayExecutionEvaluation(tasks: ExecutionReceipt[]): ExecutionEvaluationReplay {
  const completed = tasks.filter(
    (task): task is ExecutionReceipt & { status: Exclude<ExecutionReceipt['status'], 'running'> } =>
      task.status !== 'running',
  );
  const byChannel: ExecutionEvaluationReplay['byChannel'] = {};
  const cases: ExecutionEvaluationReplay['cases'] = [];
  let falseCompletions = 0;
  let supportMismatches = 0;
  let recoveryAttempts = 0;
  let recoverySuccesses = 0;
  let judgments = 0;
  let userInterventions = 0;
  for (const task of completed) {
    const replayed = verifyExecutionCompletion({
      status: task.status,
      acceptanceCriteria: task.contract?.acceptanceCriteria ?? [],
      evidence: task.evidence,
      startedAt: task.startedAt,
    });
    if (replayed.status !== task.verification.status) {
      cases.push({
        runId: task.runId,
        storedVerification: task.verification.status,
        replayedVerification: replayed.status,
      });
    }
    if (task.status === 'succeeded' && replayed.status !== 'passed') falseCompletions += 1;
    if (task.feedback?.supportFit === false) supportMismatches += 1;
    if (task.context.triggerKind === 'retry') {
      recoveryAttempts += 1;
      if (task.completionVerdict === 'achieved') recoverySuccesses += 1;
    }
    if (task.judgment) judgments += 1;
    if (task.needsUser) userInterventions += 1;
    const channel = byChannel[task.channel] ?? { total: 0, verified: 0, helpful: 0, rated: 0 };
    channel.total += 1;
    if (replayed.status === 'passed') channel.verified += 1;
    if (task.feedback) {
      channel.rated += 1;
      if (task.feedback.rating === 'helpful') channel.helpful += 1;
    }
    byChannel[task.channel] = channel;
  }
  const verificationRates = Object.values(byChannel)
    .filter((item) => item.total > 0)
    .map((item) => item.verified / item.total);
  return {
    total: completed.length,
    falseCompletions,
    verificationDrift: cases.length,
    supportMismatches,
    recoverySuccessRate: recoveryAttempts ? recoverySuccesses / recoveryAttempts : 0,
    judgmentCoverage: completed.length ? judgments / completed.length : 0,
    userInterventionRate: completed.length ? userInterventions / completed.length : 0,
    channelConsistencyGap: verificationRates.length > 1
      ? Math.max(...verificationRates) - Math.min(...verificationRates)
      : 0,
    byChannel,
    cases,
  };
}
