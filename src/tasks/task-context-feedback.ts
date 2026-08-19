import { setMemoryTraceFeedback } from '../storage/sqlite/index.js';
import type { ExecutionReceipt } from '../storage/sqlite/execution-receipt-repository.js';
import { ContextCompiler } from '../user-context/context-compiler.js';

export function recordTaskContextFeedback(receipt: ExecutionReceipt): void {
  const snapshotId = receipt.context.contextTraceId;
  if (!snapshotId || !receipt.completionVerdict) return;
  if (receipt.completionVerdict === 'partial') return;
  const snapshot = new ContextCompiler().get(snapshotId);
  if (!snapshot?.traceId) return;
  const helpful = receipt.completionVerdict === 'achieved';
  setMemoryTraceFeedback({
    traceId: snapshot.traceId,
    feedback: {
      rating: helpful ? 'helpful' : 'not_helpful',
      score: helpful ? 1 : 0,
      reason: helpful ? 'task_achieved' : 'task_not_achieved',
      source: receipt.completionVerdictSource === 'user' ? 'user' : 'evaluator',
    },
  });
}
