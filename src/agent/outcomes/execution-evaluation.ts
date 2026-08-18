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

export function replayExecutionEvaluation(outcomes: ExecutionReceipt[]): ExecutionEvaluationReplay {
  const completed = outcomes.filter(
    (outcome): outcome is ExecutionReceipt & { status: Exclude<ExecutionReceipt['status'], 'running'> } =>
      outcome.status !== 'running',
  );
  const byChannel: ExecutionEvaluationReplay['byChannel'] = {};
  const cases: ExecutionEvaluationReplay['cases'] = [];
  let falseCompletions = 0;
  let supportMismatches = 0;
  let recoveryAttempts = 0;
  let recoverySuccesses = 0;
  let judgments = 0;
  let userInterventions = 0;
  for (const outcome of completed) {
    const replayed = verifyExecutionCompletion({
      status: outcome.status,
      acceptanceCriteria: outcome.contract?.acceptanceCriteria ?? [],
      evidence: outcome.evidence,
      startedAt: outcome.startedAt,
    });
    if (replayed.status !== outcome.verification.status) {
      cases.push({
        runId: outcome.runId,
        storedVerification: outcome.verification.status,
        replayedVerification: replayed.status,
      });
    }
    if (outcome.status === 'succeeded' && replayed.status !== 'passed') falseCompletions += 1;
    if (outcome.feedback?.supportFit === false) supportMismatches += 1;
    if (outcome.context.triggerKind === 'retry') {
      recoveryAttempts += 1;
      if (outcome.completionVerdict === 'achieved') recoverySuccesses += 1;
    }
    if (outcome.judgment) judgments += 1;
    if (outcome.needsUser) userInterventions += 1;
    const channel = byChannel[outcome.channel] ?? { total: 0, verified: 0, helpful: 0, rated: 0 };
    channel.total += 1;
    if (replayed.status === 'passed') channel.verified += 1;
    if (outcome.feedback) {
      channel.rated += 1;
      if (outcome.feedback.outcome === 'helpful') channel.helpful += 1;
    }
    byChannel[outcome.channel] = channel;
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
