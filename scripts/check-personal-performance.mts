/** Read-only acceptance gate: never turn functional success into an implied latency pass. */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';

import { assessMainResponseBudget, latencyDistribution, PERSONAL_PERFORMANCE_BUDGETS } from '../src/personal-agent/performance.js';

const input = resolve(process.argv[2] ?? 'docs/design/technical/personal-performance-live-2026-10-15.json');
const report = JSON.parse(readFileSync(input, 'utf8'));
const readyReads = JSON.parse(readFileSync(input.replace(/\.json$/, '-reads.json'), 'utf8'));
const regression = process.argv[3] ? JSON.parse(readFileSync(resolve(process.argv[3]), 'utf8')) : undefined;
const fallbackFaultTest = regression?.testResults?.flatMap((file: { assertionResults?: Array<{ fullName: string; status: string }> }) => file.assertionResults ?? [])
  .find((test: { fullName: string; status: string }) => test.fullName.includes('persists simultaneous completions within the fallback budget') && test.status === 'passed');
type Observation = { phase: string; index: number; runId: string; status: string; firstTextMs?: number; backgroundRunning: boolean; completeMs: number; responseText?: string };
const observations: Observation[] = report.observations ?? [];
const baseline = observations.filter(row => row.phase === 'baseline');
const loaded = observations.filter(row => row.phase === 'background');
const failures = [...baseline, ...loaded].filter(row => row.status !== 'completed' || row.firstTextMs === undefined).length;
const main = assessMainResponseBudget(baseline.flatMap(row => row.firstTextMs === undefined ? [] : [row.firstTextMs]),
  loaded.flatMap(row => row.firstTextMs === undefined ? [] : [row.firstTextMs]), failures);
const db = new DatabaseSync(join(report.isolatedStateDirectory, 'xopc.db'), { readOnly: true });
const query = (sql: string) => db.prepare(sql).all();
const trace = {
  inputs: query('SELECT id,run_id,task_run_id,status,created_at_ms FROM session_inputs ORDER BY created_at_ms'),
  runs: query('SELECT run_id,task_id,parent_run_id,contract_version,status,queued_at,started_at,completed_at FROM task_runs WHERE task_id IS NOT NULL ORDER BY queued_at'),
  revisions: query('SELECT revision_id,task_id,contract_version,baseline_delivery_id,instruction_entry_id,input_id,created_at FROM task_work_revisions'),
  directions: query(`SELECT e.entry_id,e.task_id,e.sequence,e.kind,e.causation_id,e.created_at,d.status,d.assignment_epoch,d.updated_at
    FROM task_collaboration_entries e LEFT JOIN task_collaboration_deliveries d ON e.entry_id=d.entry_id ORDER BY e.created_at`),
  deliveries: query(`SELECT d.delivery_id,d.task_run_id,d.status,d.reply_status,d.attempts,d.reply_attempts,d.created_at,d.delivered_at,
    e.created_at AS chat_persisted_at FROM task_result_deliveries d LEFT JOIN transcript_entries e ON e.entry_id=d.reply_message_entry_id`),
  usage: query(`SELECT operation,provider,model,status,count(*) AS calls,sum(duration_ms) AS duration_ms,
    sum(input_tokens) AS input_tokens,sum(output_tokens) AS output_tokens,sum(estimated_cost_microusd) AS estimated_cost_microusd
    FROM ai_usage_events GROUP BY operation,provider,model,status`),
};
const workerFailures = query(`SELECT e.payload_json FROM transcript_entries e JOIN transcripts t ON t.transcript_id=e.transcript_id
  WHERE e.role='toolResult' AND json_extract(e.payload_json,'$.isError')=1`).map(row => {
    const value = JSON.parse(String(row.payload_json));
    return { tool: value.toolName, toolCallId: value.toolCallId, status: value.details?.status,
      error: value.content?.filter((part: { type: string }) => part.type === 'text').map((part: { text: string }) => part.text).join('\n').slice(0, 2500) };
  });
const sourceCitations = query("SELECT payload_json FROM transcript_entries WHERE role='assistant'").flatMap(row => {
  const message = JSON.parse(String(row.payload_json));
  return Array.isArray(message.content) ? message.content.filter((part: { type: string; name: string }) => part.type === 'toolCall' && part.name === 'publish_task_result')
    .flatMap((part: { arguments?: { sources?: Array<{ toolCallId?: string; excerptRange?: unknown }> } }) => part.arguments?.sources ?? []) : [];
});
const hostRangeCitations = sourceCitations.filter(source => source.toolCallId && source.excerptRange).length;
const calls = query("SELECT payload_json FROM transcript_entries WHERE role='assistant'").flatMap(row => {
  const message = JSON.parse(String(row.payload_json));
  return Array.isArray(message.content) ? message.content.filter((part: { type: string }) => part.type === 'toolCall') : [];
});
const failedInputs = workerFailures.map(failure => calls.find(call => call.id === failure.toolCallId)).filter(Boolean);
const repeatedFailedInputs = failedInputs.filter((call, index) => failedInputs.slice(0, index)
  .some(previous => previous.name === call.name && isDeepStrictEqual(previous.arguments, call.arguments))).length;
const sampledRuns = new Set([...baseline, ...loaded].map(row => row.runId));
const mainUsage = query('SELECT run_id,count(*) AS calls FROM ai_usage_events GROUP BY run_id')
  .filter(row => sampledRuns.has(String(row.run_id)));
const modelCallCoverage = { sampledRuns: sampledRuns.size, linkedRuns: mainUsage.length,
  singleCallRuns: mainUsage.filter(row => Number(row.calls) === 1).length };
const costCoverage = query('SELECT cost_source,count(*) AS calls,sum(estimated_cost_microusd) AS estimated_cost_microusd FROM ai_usage_events GROUP BY cost_source');
db.close();
const sourceChangesAfterRun = Object.entries(report.sourceHashes as Record<string, string>)
  .filter(([path, hash]) => createHash('sha256').update(readFileSync(path)).digest('hex') !== hash).map(([path]) => path);
const remainingConfigFiles = readdirSync(report.isolatedStateDirectory).filter(name => name === 'xopc.json' || name.startsWith('xopc.json.'));
const local = latencyDistribution((report.submissionMs ?? []).map((row: { durationMs: number }) => row.durationMs));
const hot = readyReads.runs?.reportArtifact;
const fallback = (report.performanceSamples ?? []).filter((row: { phase: string }) => row.phase === 'busy_fallback');
const fallbackLatency = latencyDistribution(fallback.map((row: { durationMs: number }) => row.durationMs));
const originalDelivery = latencyDistribution((report.performanceSamples ?? []).filter((row: { phase: string }) => row.phase === 'result_to_chat')
  .map((row: { durationMs: number }) => row.durationMs));
const checks = {
  functionalChain: report.success === true,
  regressionPassed: regression?.success === true && regression.numFailedTests === 0,
  basicAnswerQuality: [...baseline, ...loaded].every(row => {
    const text = row.responseText?.trim().replace(/[。.!！]+$/u, '');
    return row.index % 4 === 0 ? text === '收到' : row.index % 4 === 1 ? text === '42' : Boolean(text);
  }),
  unchangedRuntime: report.sourceChangedDuringRun === false,
  unchangedRuntimeAfterRun: sourceChangesAfterRun.length === 0,
  isolatedConfigCleaned: remainingConfigFiles.length === 0,
  noAdditionalMainModelCall: sampledRuns.size >= 80 && modelCallCoverage.singleCallRuns === sampledRuns.size,
  mainP95: main.verdict === 'passed',
  fullBackgroundOverlap: loaded.length >= 40 && loaded.every(row => row.backgroundRunning),
  hotReadP95: readyReads.success === true && hot?.count >= 40 && hot.readyCount === hot.count
    && hot.p95Ms <= PERSONAL_PERFORMANCE_BUDGETS.hot_read.p95Ms && hot.maxOutputChars <= 8000,
  retainedOldAndRevisedContentReadable: readyReads.originalTailReadable === true && readyReads.revisedTailReadable === true,
  localWriteSmoke: local.count >= 2 && local.maxMs !== null && local.maxMs <= PERSONAL_PERFORMANCE_BUDGETS.local_write.p95Ms,
  foregroundInputReadSmoke: Number.isFinite(report.mainInputReadMs) && report.mainInputReadMs <= 100
    && report.mainInputReadChars?.every((chars: number) => chars <= 12000),
  originalDeliverySmoke: originalDelivery.count >= 2 && originalDelivery.maxMs! <= PERSONAL_PERFORMANCE_BUDGETS.result_to_chat.p95Ms,
  fallbackBudget: fallbackLatency.count > 0 ? fallbackLatency.p95Ms! <= PERSONAL_PERFORMANCE_BUDGETS.busy_fallback.p95Ms : Boolean(fallbackFaultTest),
  noSourceValidationFailures: !workerFailures.some(row => row.error?.includes('source_quote_mismatch')),
  noUnchangedFailedRetries: repeatedFailedInputs === 0,
  allFailuresTraceable: failedInputs.length === workerFailures.length,
  verifiedTerminalRecovery: report.success === true && report.finalDeliveries?.length === 2
    && report.finalDeliveries.every((delivery: { outcome: { status: string } }) => delivery.outcome.status === 'succeeded'),
  hostRangeProvenance: hostRangeCitations > 0,
  noMaterializationMisuse: report.materializationErrors === 0,
  preservedVersionedDelivery: report.oldArtifactUnchanged === true && report.exactSingleReplacement === true,
};
const acceptance = { passed: Object.values(checks).every(Boolean), checks, main, localWriteSmoke: local,
  hotRead: hot, bodyRead: readyReads.runs?.body, originalDeliverySmoke: originalDelivery, busyFallback: fallbackLatency,
  fallbackCoverage: fallbackLatency.count ? 'real_chain' : fallbackFaultTest ? 'injected_clock_regression' : 'not_observed',
  regression: regression ? { success: regression.success, passedTests: regression.numPassedTests, failedTests: regression.numFailedTests } : undefined,
  workerFailures, repeatedFailedInputs, zeroToolFailures: workerFailures.length === 0, hostRangeCitations,
  modelCallCoverage, costCoverage, sourceChangesAfterRun, remainingConfigFiles, trace,
  scope: 'Same-source isolated real-model idle/background comparison, not a pre-change code or production baseline. Local writes have smoke coverage only. Failed calls are retained: acceptance requires verified final outputs and no identical failed retries, rather than claiming models never make rejected calls. A failed or unsampled gate remains visible.' };
const output = input.replace(/\.json$/, '-acceptance.json');
writeFileSync(output, JSON.stringify(acceptance, null, 2) + '\n');
console.log(JSON.stringify({ output, passed: acceptance.passed, checks, main }));
process.exitCode = acceptance.passed ? 0 : 1;
