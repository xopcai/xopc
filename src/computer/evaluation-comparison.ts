import { z } from 'zod';
import { ComputerEvaluationPlanSchema, ComputerEvaluationRunSchema, evaluateComputerRuns,
  isAutonomousComputerSuccess, type ComputerEvaluationRun } from './evaluation.js';

const ReportSchema = z.object({ plan: ComputerEvaluationPlanSchema, runs: z.array(ComputerEvaluationRunSchema) });

/** Pair the same tasks and repetitions; never compare different environments or evidence classes. */
export function compareComputerEvaluations(rawBaseline: unknown, rawCandidate: unknown) {
  const baseline = ReportSchema.parse(rawBaseline), candidate = ReportSchema.parse(rawCandidate);
  const baselineSummary = evaluateComputerRuns(baseline.plan, baseline.runs);
  const candidateSummary = evaluateComputerRuns(candidate.plan, candidate.runs);
  if (baseline.plan.environment !== candidate.plan.environment || baseline.plan.evidence !== candidate.plan.evidence
    || baseline.plan.repetitions !== candidate.plan.repetitions
    || JSON.stringify([...baseline.plan.taskIds].sort()) !== JSON.stringify([...candidate.plan.taskIds].sort())) {
    throw new Error('COMPUTER_EVALUATION_INCOMPARABLE_PLANS');
  }
  const key = (run: ComputerEvaluationRun) => JSON.stringify([run.taskId, run.repetition]);
  const candidates = new Map(candidate.runs.map(run => [key(run), run]));
  const pairs = baseline.runs.flatMap(run => candidates.has(key(run)) ? [[run, candidates.get(key(run))!] as const] : []);
  let wins = 0, losses = 0, ties = 0;
  for (const [before, after] of pairs) {
    const b = isAutonomousComputerSuccess(before), c = isAutonomousComputerSuccess(after);
    if (c && !b) wins++; else if (b && !c) losses++; else ties++;
  }
  const metric = (name: 'durationMs' | 'modelRequests' | 'actions' | 'unchangedInputs' | 'observationChanges' | 'rescueAttempts' | 'rescueExhaustions' | 'cost') => {
    const measured = pairs.filter(([before, after]) => before[name] != null && after[name] != null);
    if (!measured.length) return { pairedMeasurements: 0, baselineMean: null, candidateMean: null, deltaMean: null };
    const baselineMean = measured.reduce((sum, [before]) => sum + before[name]!, 0) / measured.length;
    const candidateMean = measured.reduce((sum, [, after]) => sum + after[name]!, 0) / measured.length;
    return { pairedMeasurements: measured.length, baselineMean, candidateMean, deltaMean: candidateMean - baselineMean };
  };
  return { baseline: baselineSummary, candidate: candidateSummary,
    expectedPairs: baselineSummary.expectedRuns, pairedRuns: pairs.length,
    missingPairs: baselineSummary.expectedRuns - pairs.length,
    complete: pairs.length === baselineSummary.expectedRuns,
    wins, losses, ties, pairedSuccessRateDelta: pairs.length ? (wins - losses) / pairs.length : null,
    metrics: { durationMs: metric('durationMs'), modelRequests: metric('modelRequests'), actions: metric('actions'),
      unchangedInputs: metric('unchangedInputs'), observationChanges: metric('observationChanges'),
      rescueAttempts: metric('rescueAttempts'), rescueExhaustions: metric('rescueExhaustions'), cost: metric('cost') } };
}
