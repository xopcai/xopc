import type { MemoryTraceEventPayload } from '../storage/sqlite/memory-records-repository.js';

export function summarizeMemoryUseAudit(traces: MemoryTraceEventPayload[]): {
  total: number;
  injectTurns: number;
  turnsUsingMemory: number;
  selectedRecords: number;
  helpful: number;
  notHelpful: number;
  skippedReasons: Record<string, number>;
} {
  const injects = traces.filter((trace) => trace.phase === 'inject');
  const skippedReasons: Record<string, number> = {};
  let selectedRecords = 0;
  let helpful = 0;
  let notHelpful = 0;
  for (const trace of injects) {
    selectedRecords += trace.selectedRecordIds.length;
    if (trace.skippedReason) skippedReasons[trace.skippedReason] = (skippedReasons[trace.skippedReason] ?? 0) + 1;
    const responseFeedback = trace.feedback.find((item) => item.level === 'response');
    if (responseFeedback?.rating === 'helpful') helpful += 1;
    if (responseFeedback?.rating === 'not_helpful' || responseFeedback?.rating === 'irrelevant') notHelpful += 1;
  }
  return {
    total: traces.length,
    injectTurns: injects.length,
    turnsUsingMemory: injects.filter((trace) => trace.selectedRecordIds.length > 0).length,
    selectedRecords,
    helpful,
    notHelpful,
    skippedReasons,
  };
}
