import { z } from 'zod';
import { ComputerEvaluationPlanSchema, ComputerEvaluationRunSchema, evaluateComputerRuns } from './evaluation.js';

const ReleaseEvidenceSchema = z.object({
  plan: ComputerEvaluationPlanSchema,
  runs: z.array(ComputerEvaluationRunSchema),
  evidence: z.record(z.string(), z.string().min(1).max(2_000)),
}).passthrough();

/** Recompute the gate and require a distinct evidence artifact for every run. */
export function assertComputerReleaseEvidence(raw: unknown) {
  const report = ReleaseEvidenceSchema.parse(raw);
  const summary = evaluateComputerRuns(report.plan, report.runs);
  if (!summary.betaGatePassed) throw new Error('COMPUTER_RELEASE_QUALITY_GATE_FAILED');
  const references = report.runs.map(run => report.evidence[`${run.taskId}:${run.repetition}`]);
  if (references.some(reference => !reference) || new Set(references).size !== references.length) {
    throw new Error('COMPUTER_RELEASE_EVIDENCE_INCOMPLETE');
  }
  return summary;
}
