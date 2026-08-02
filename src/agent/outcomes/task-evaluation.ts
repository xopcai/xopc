import type { TaskOutcome } from '../../storage/sqlite/task-outcome-repository.js';
import { verifyTaskCompletion } from './task-verifier.js';

export interface TaskEvaluationReplay {
  total: number;
  falseCompletions: number;
  verificationDrift: number;
  supportMismatches: number;
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

export function replayTaskEvaluation(outcomes: TaskOutcome[]): TaskEvaluationReplay {
  const completed = outcomes.filter(
    (outcome): outcome is TaskOutcome & { status: Exclude<TaskOutcome['status'], 'running'> } =>
      outcome.status !== 'running',
  );
  const byChannel: TaskEvaluationReplay['byChannel'] = {};
  const cases: TaskEvaluationReplay['cases'] = [];
  let falseCompletions = 0;
  let supportMismatches = 0;
  for (const outcome of completed) {
    const replayed = verifyTaskCompletion({
      status: outcome.status,
      acceptanceCriteria: outcome.contract?.acceptanceCriteria ?? [],
      evidence: outcome.evidence,
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
    channelConsistencyGap: verificationRates.length > 1
      ? Math.max(...verificationRates) - Math.min(...verificationRates)
      : 0,
    byChannel,
    cases,
  };
}
