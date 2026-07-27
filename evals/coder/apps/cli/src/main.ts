#!/usr/bin/env node
import { parseArgs } from 'node:util';

import { MockAdapter } from '@agent-evals/adapter-mock';
import { XopcGatewayAdapter } from '@agent-evals/adapter-xopc';
import type { EvalCase, EvalSuite, ExperimentSpec } from '@agent-evals/protocol';
import { EvalRunner, loadExperiment, loadSuite } from '@agent-evals/runner';
import { ArtifactStore, EvalStore } from '@agent-evals/storage';

function usage(): never {
  console.error(`Usage:
  pnpm run eval:coder run --suite <suite.yaml> --experiment <experiment.yaml>
  pnpm run eval:coder list
  pnpm run eval:coder show --experiment-id <id>
  pnpm run eval:coder run-show --run-id <id>
  pnpm run eval:coder compare --experiment-id <id>
  pnpm run eval:coder gate --experiment-id <id> [--baseline <variant>] [--candidate <variant>]
  pnpm run eval:coder trend [--suite-id <suite>] [--limit <count>]
  pnpm run eval:coder reproduce --run-id <id>
  pnpm run eval:coder annotate --run-id <id> --category <type> --note <text>

Options:
  --db <path>          Default: .xopc-evals/evals.db
  --artifacts <path>   Default: .xopc-evals/artifacts
  --max-pass-regression <rate>          Default: 0
  --max-failure-rate-increase <rate>    Default: 0
  --keep-workspaces    Preserve temporary workspaces for debugging`);
  process.exit(2);
}

const [command, ...argv] = process.argv.slice(2);
const { values } = parseArgs({
  args: argv,
  options: {
    suite: { type: 'string' },
    experiment: { type: 'string' },
    'experiment-id': { type: 'string' },
    'run-id': { type: 'string' },
    category: { type: 'string' },
    note: { type: 'string' },
    baseline: { type: 'string' },
    candidate: { type: 'string' },
    'suite-id': { type: 'string' },
    limit: { type: 'string', default: '100' },
    'max-pass-regression': { type: 'string', default: '0' },
    'max-failure-rate-increase': { type: 'string', default: '0' },
    db: { type: 'string', default: '.xopc-evals/evals.db' },
    artifacts: { type: 'string', default: '.xopc-evals/artifacts' },
    'keep-workspaces': { type: 'boolean', default: false },
  },
  allowPositionals: false,
});

const store = new EvalStore(values.db!);

const CBM_TOOLS = new Set([
  'code_search',
  'code_read_symbol',
  'code_trace',
  'code_impact',
  'code_architecture',
]);
const DIRECT_DISCOVERY_TOOLS = new Set(['grep', 'find', 'read_file', 'list_dir']);

function toolNameFromPayload(value: unknown, depth = 0): string | undefined {
  if (depth > 4 || !value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.toolName === 'string') return record.toolName;
  for (const child of Object.values(record)) {
    const found = toolNameFromPayload(child, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function traceStats(runId: string): {
  tools: number;
  cbmTools: number;
  directDiscoveryTools: number;
  modelRequests: number;
} {
  const detail = store.getRun(runId);
  const stats = { tools: 0, cbmTools: 0, directDiscoveryTools: 0, modelRequests: 0 };
  for (const event of detail?.events ?? []) {
    if (event.type === 'model.request') stats.modelRequests += 1;
    if (event.type !== 'tool.started') continue;
    stats.tools += 1;
    try {
      const name = toolNameFromPayload(JSON.parse(String(event.payload_json)));
      if (name && CBM_TOOLS.has(name)) stats.cbmTools += 1;
      if (name && DIRECT_DISCOVERY_TOOLS.has(name)) stats.directDiscoveryTools += 1;
    } catch {
      // Malformed third-party events still count as tool calls.
    }
  }
  return stats;
}

function wilsonInterval(passed: number, runs: number): [number, number] {
  if (runs === 0) return [0, 0];
  const z = 1.96;
  const proportion = passed / runs;
  const denominator = 1 + (z * z) / runs;
  const center = (proportion + (z * z) / (2 * runs)) / denominator;
  const margin = z * Math.sqrt(
    (proportion * (1 - proportion) / runs) + (z * z) / (4 * runs * runs),
  ) / denominator;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

interface VariantStats {
  runs: number;
  passed: number;
  executionFailures: number;
  score: number;
  durationMs: number;
  tools: number;
  cbmTools: number;
  directDiscoveryTools: number;
  modelRequests: number;
  outcomes: Map<string, boolean>;
}

function collectVariantStats(runs: Array<Record<string, unknown>>): Map<string, VariantStats> {
  const variants = new Map<string, VariantStats>();
  for (const run of runs) {
    const id = String(run.variant_id).replace(/#\d+$/, '');
    const current = variants.get(id) ?? {
      runs: 0,
      passed: 0,
      executionFailures: 0,
      score: 0,
      durationMs: 0,
      tools: 0,
      cbmTools: 0,
      directDiscoveryTools: 0,
      modelRequests: 0,
      outcomes: new Map<string, boolean>(),
    };
    current.runs += 1;
    const status = String(run.status);
    if (status === 'passed') current.passed += 1;
    if (status === 'error' || status === 'timed_out' || status === 'budget_exceeded') {
      current.executionFailures += 1;
    }
    current.score += Number(run.score ?? 0);
    if (run.ended_at) {
      current.durationMs += Date.parse(String(run.ended_at)) - Date.parse(String(run.started_at));
    }
    const trace = traceStats(String(run.id));
    current.tools += trace.tools;
    current.cbmTools += trace.cbmTools;
    current.directDiscoveryTools += trace.directDiscoveryTools;
    current.modelRequests += trace.modelRequests;
    const rawVariantId = String(run.variant_id);
    const repetition = rawVariantId.match(/#(\d+)$/)?.[1] ?? '1';
    current.outcomes.set(`${String(run.case_id)}#${repetition}`, status === 'passed');
    variants.set(id, current);
  }
  return variants;
}

function parseRate(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${name} must be a number between 0 and 1`);
  }
  return parsed;
}

function createRunner(): EvalRunner {
  return new EvalRunner({
    store,
    artifactStore: new ArtifactStore(values.artifacts!),
    adapters: [new MockAdapter(), new XopcGatewayAdapter()],
    keepWorkspaces: values['keep-workspaces'],
  });
}

try {
  if (command === 'run') {
    if (!values.suite || !values.experiment) usage();
    const [suite, experiment] = await Promise.all([
      loadSuite(values.suite),
      loadExperiment(values.experiment),
    ]);
    const result = await createRunner().runExperiment(suite, experiment);
    console.log(`Experiment ${result.experimentId}`);
    console.log('CASE\tVARIANT\tSTATUS\tSCORE\tRUN');
    for (const run of result.runs) {
      const detail = store.getRun(run.runId)!;
      console.log([
        detail.run.case_id,
        detail.run.variant_id,
        run.status,
        run.score.toFixed(2),
        run.runId,
      ].join('\t'));
    }
  } else if (command === 'list') {
    console.log(JSON.stringify(store.listExperiments(), null, 2));
  } else if (command === 'show') {
    if (!values['experiment-id']) usage();
    const detail = store.getExperiment(values['experiment-id']);
    if (!detail) throw new Error(`Experiment not found: ${values['experiment-id']}`);
    console.log(JSON.stringify(detail, null, 2));
  } else if (command === 'run-show') {
    if (!values['run-id']) usage();
    const detail = store.getRun(values['run-id']);
    if (!detail) throw new Error(`Run not found: ${values['run-id']}`);
    console.log(JSON.stringify(detail, null, 2));
  } else if (command === 'compare') {
    if (!values['experiment-id']) usage();
    const detail = store.getExperiment(values['experiment-id']);
    if (!detail) throw new Error(`Experiment not found: ${values['experiment-id']}`);
    const variants = collectVariantStats(detail.runs);
    console.log('VARIANT\tPASS\tRATE\tPASS_CI95\tAVG_SCORE\tAVG_DURATION_MS\tAVG_TOOLS\tAVG_CBM_TOOLS\tAVG_DIRECT_DISCOVERY\tAVG_MODEL_REQUESTS');
    for (const [id, value] of variants) {
      const [low, high] = wilsonInterval(value.passed, value.runs);
      console.log([
        id,
        `${value.passed}/${value.runs}`,
        (value.passed / value.runs).toFixed(3),
        `[${low.toFixed(3)},${high.toFixed(3)}]`,
        (value.score / value.runs).toFixed(3),
        Math.round(value.durationMs / value.runs),
        (value.tools / value.runs).toFixed(1),
        (value.cbmTools / value.runs).toFixed(1),
        (value.directDiscoveryTools / value.runs).toFixed(1),
        (value.modelRequests / value.runs).toFixed(1),
      ].join('\t'));
    }
    const spec = JSON.parse(String(detail.experiment.spec_json)) as ExperimentSpec;
    const baselineId = spec.variants[0]?.id;
    const baseline = baselineId ? variants.get(baselineId) : undefined;
    if (baseline) {
      console.log('\nBASELINE\tCANDIDATE\tPAIRS\tWINS\tLOSSES\tTIES\tPASS_DELTA');
      for (const [candidateId, candidate] of variants) {
        if (candidateId === baselineId) continue;
        let pairs = 0;
        let wins = 0;
        let losses = 0;
        let ties = 0;
        let delta = 0;
        for (const [key, baselinePassed] of baseline.outcomes) {
          const candidatePassed = candidate.outcomes.get(key);
          if (candidatePassed === undefined) continue;
          pairs += 1;
          delta += Number(candidatePassed) - Number(baselinePassed);
          if (candidatePassed === baselinePassed) ties += 1;
          else if (candidatePassed) wins += 1;
          else losses += 1;
        }
        console.log([
          baselineId,
          candidateId,
          pairs,
          wins,
          losses,
          ties,
          pairs ? (delta / pairs).toFixed(3) : 'n/a',
        ].join('\t'));
      }
    }
  } else if (command === 'gate') {
    if (!values['experiment-id']) usage();
    const detail = store.getExperiment(values['experiment-id']);
    if (!detail) throw new Error(`Experiment not found: ${values['experiment-id']}`);
    const spec = JSON.parse(String(detail.experiment.spec_json)) as ExperimentSpec;
    const baselineId = values.baseline ?? spec.variants[0]?.id;
    const candidateId = values.candidate ?? spec.variants[1]?.id;
    if (!baselineId || !candidateId) {
      throw new Error('Gate requires baseline and candidate variants');
    }
    const variants = collectVariantStats(detail.runs);
    const baseline = variants.get(baselineId);
    const candidate = variants.get(candidateId);
    if (!baseline || !candidate) {
      throw new Error(`Missing results for baseline=${baselineId} or candidate=${candidateId}`);
    }
    const maxPassRegression = parseRate(
      values['max-pass-regression']!,
      '--max-pass-regression',
    );
    const maxFailureRateIncrease = parseRate(
      values['max-failure-rate-increase']!,
      '--max-failure-rate-increase',
    );
    const baselinePassRate = baseline.passed / baseline.runs;
    const candidatePassRate = candidate.passed / candidate.runs;
    const baselineFailureRate = baseline.executionFailures / baseline.runs;
    const candidateFailureRate = candidate.executionFailures / candidate.runs;
    const passRegression = baselinePassRate - candidatePassRate;
    const failureRateIncrease = candidateFailureRate - baselineFailureRate;
    const passed = passRegression <= maxPassRegression &&
      failureRateIncrease <= maxFailureRateIncrease;
    console.log(JSON.stringify({
      passed,
      baseline: {
        id: baselineId,
        runs: baseline.runs,
        passRate: baselinePassRate,
        executionFailureRate: baselineFailureRate,
      },
      candidate: {
        id: candidateId,
        runs: candidate.runs,
        passRate: candidatePassRate,
        executionFailureRate: candidateFailureRate,
      },
      observed: { passRegression, failureRateIncrease },
      thresholds: { maxPassRegression, maxFailureRateIncrease },
    }, null, 2));
    if (!passed) process.exitCode = 1;
  } else if (command === 'trend') {
    const limit = Number.parseInt(values.limit!, 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new Error('--limit must be an integer between 1 and 500');
    }
    const rows = store.listTrend({
      ...(values['suite-id'] ? { suiteId: values['suite-id'] } : {}),
      limit,
    });
    console.log(
      'CREATED\tSUITE\tEXPERIMENT\tVARIANT\tPASS\tRATE\tEXEC_FAILURE_RATE\tAVG_SCORE\tAVG_DURATION_MS',
    );
    for (const row of rows) {
      const runs = Number(row.run_count);
      const passed = Number(row.passed_count);
      const failures = Number(row.execution_failure_count);
      console.log([
        row.created_at,
        `${String(row.suite_id)}@${String(row.suite_version)}`,
        row.experiment_id,
        row.variant_id,
        `${passed}/${runs}`,
        (passed / runs).toFixed(3),
        (failures / runs).toFixed(3),
        Number(row.average_score ?? 0).toFixed(3),
        Math.round(Number(row.average_duration_ms ?? 0)),
      ].join('\t'));
    }
  } else if (command === 'reproduce') {
    if (!values['run-id']) usage();
    const detail = store.getRun(values['run-id']);
    if (!detail) throw new Error(`Run not found: ${values['run-id']}`);
    const sourceExperiment = store.getExperiment(String(detail.run.experiment_id));
    if (!sourceExperiment) throw new Error('Source experiment is unavailable');
    const sourceSpec = JSON.parse(String(sourceExperiment.experiment.spec_json)) as ExperimentSpec;
    const variantId = String(detail.run.variant_id).replace(/#\d+$/, '');
    const variant = sourceSpec.variants.find((candidate) => candidate.id === variantId);
    if (!variant) throw new Error(`Variant is unavailable: ${variantId}`);
    const evalCase = JSON.parse(String(detail.run.case_json)) as EvalCase;
    const suite: EvalSuite = {
      id: String(sourceExperiment.experiment.suite_id),
      version: String(sourceExperiment.experiment.suite_version),
      sourcePath: 'stored-run',
      contentHash: String(sourceExperiment.experiment.suite_hash),
      cases: [evalCase],
    };
    const result = await createRunner().runExperiment(suite, {
      name: `Reproduce ${values['run-id']}`,
      variants: [variant],
    });
    console.log(JSON.stringify({ experimentId: result.experimentId, run: result.runs[0] }, null, 2));
  } else if (command === 'annotate') {
    if (!values['run-id'] || !values.note) usage();
    const detail = store.getRun(values['run-id']);
    if (!detail) throw new Error(`Run not found: ${values['run-id']}`);
    const id = store.annotateRun(values['run-id'], {
      note: values.note,
      ...(values.category ? { failureCategory: values.category } : {}),
    });
    console.log(`Annotation ${id}`);
  } else {
    usage();
  }
} finally {
  store.close();
}
