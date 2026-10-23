#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { XopcGatewayAdapter } from '@agent-evals/adapter-xopc';
import type { ExperimentSpec } from '@agent-evals/protocol';
import { EvalRunner, loadSuite } from '@agent-evals/runner';
import { ArtifactStore, EvalStore } from '@agent-evals/storage';

import { calibrationAdapter } from './benchmark-calibration.js';
import { summarizeToolTrace } from './benchmark-diagnostics.js';
import { growthCalibrationAdapter } from './growth-calibration.js';

const repository = fileURLToPath(new URL('../../../../../', import.meta.url));
const { values } = parseArgs({ options: {
  suite: { type: 'string', default: 'xopc-core' },
  mode: { type: 'string', default: 'calibration' },
  output: { type: 'string' },
  repetitions: { type: 'string', default: '1' },
  model: { type: 'string' },
  agent: { type: 'string', default: 'coder' },
  reasoning: { type: 'string', default: 'off' },
  'base-url': { type: 'string' },
  cases: { type: 'string' },
  concurrency: { type: 'string', default: '1' },
} });
if (!['xopc-core', 'xopc-agent-growth', 'xopc-delivery-holdout', 'xopc-ledger-holdout'].includes(values.suite!)) throw new Error('Unknown benchmark suite');
const suiteDirectory = join(repository, 'evals/coder/suites', values.suite!);
const growth = values.suite === 'xopc-agent-growth';
if (!['calibration', 'live'].includes(values.mode!)) throw new Error('--mode must be calibration or live');
const repetitions = Number(values.repetitions);
const concurrency = Number(values.concurrency);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error('--concurrency must be 1–16');
if (values.mode === 'live' && concurrency > 1) throw new Error('Live direct-agent parallelism requires separate isolated Gateway workers; use campaign concurrency instead');
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 20) throw new Error('--repetitions must be 1–20');
if (values.mode === 'live' && (!values.model || !values['base-url'])) throw new Error('Live mode requires --model provider/model and --base-url for an isolated Gateway; set XOPC_EVAL_TOKEN in the environment.');
const output = resolve(values.output ?? `.xopc-evals/${values.suite}/${new Date().toISOString().replaceAll(':', '-')}`);
mkdirSync(dirname(output), { recursive: true });
mkdirSync(output, { recursive: false }); // Refuse to mix or overwrite experiment evidence.
const temporary = mkdtempSync(join(tmpdir(), 'xopc-benchmark-v1-'));
const store = new EvalStore(join(output, 'evals.db'));
function fingerprint() {
  const files: Record<string, string> = {};
  function walk(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files[relative(repository, path)] = createHash('sha256').update(readFileSync(path)).digest('hex');
    }
  }
  for (const path of ['evals/coder/packages', 'evals/coder/apps/cli/src', 'evals/coder/scripts', `evals/coder/suites/${values.suite}`]) walk(join(repository, path));
  const runtimePaths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'src', 'packages', 'extensions'], { cwd: repository, encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const path of runtimePaths) {
    try { files[path] = createHash('sha256').update(readFileSync(join(repository, path))).digest('hex'); } catch { files[path] = 'missing'; }
  }
  files['package.json'] = createHash('sha256').update(readFileSync(join(repository, 'package.json'))).digest('hex');
  files['pnpm-lock.yaml'] = createHash('sha256').update(readFileSync(join(repository, 'pnpm-lock.yaml'))).digest('hex');
  return files;
}
const initialHashes = fingerprint();
const manifest: Record<string, unknown> = { harnessTreatment: { maxTurns: Number(process.env.XOPC_EVAL_MAX_TURNS ?? 40) }, schemaVersion: 1, benchmark: values.suite, version: growth ? '0.1.0' : '1.0.2',
  evidenceClass: values.mode === 'live' ? 'live-direct-agent' : 'harness-calibration',
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
  sourceHashes: initialHashes, startedAt: new Date().toISOString(), node: process.version,
  limitations: ['Direct agent workspace evaluation; does not grade asynchronous Personal Task delivery or authenticated artifact downloads.',
    growth ? 'No mid-run requirement changes, autonomous fault recovery or full production-repository tasks in this slice.' : 'Changes occur between completed turns; artifact restoration is explicitly requested.',
    growth ? 'Six development scenarios in dependency-free multi-module fixture projects; not a held-out generalization or large-repository score.' : 'Frozen synthetic research facts; prose semantics are not independently model-graded.',
    'Calibration uses supplied reference answers and must never be reported as model performance.'] };
writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
try {
  const fixture = JSON.parse(execFileSync(process.execPath, [join(suiteDirectory, 'create-fixture.mjs'), temporary], { encoding: 'utf8' })) as { repo: string; commit: string; caseCommits?: Record<string, string> };
  execFileSync('git', ['bundle', 'create', join(output, 'fixture.bundle'), '--all'], { cwd: fixture.repo });
  process.env.EVAL_FIXTURE_REPO = fixture.repo;
  process.env.EVAL_FIXTURE_COMMIT = fixture.commit;
  for (const [id, commit] of Object.entries(fixture.caseCommits ?? {})) process.env[`EVAL_FIXTURE_${id}_COMMIT`] = commit;
  const suite = await loadSuite(join(suiteDirectory, 'suite.yaml'));
  if (values.cases) {
    const ids = values.cases.split(',');
    if (new Set(ids).size !== ids.length || ids.some(id => !suite.cases.some(c => c.id === id))) throw new Error('Unknown or duplicate case selection');
    suite.cases = suite.cases.filter(c => ids.includes(c.id));
  }
  const spec: ExperimentSpec = { name: `${suite.id}@${suite.version} (${values.mode})`, concurrency, repetitions, randomSeed: growth ? `${suite.id}@${suite.version}` : 'xopc-core-v1',
    variants: values.mode === 'live'
      ? [{ id: 'candidate', adapter: 'xopc', agentId: values.agent!, model: values.model!, reasoning: values.reasoning!, config: { baseUrl: values['base-url']! } }]
      : [{ id: 'broken', adapter: growth ? 'xopc-growth-calibration' : 'xopc-core-calibration' }, { id: 'reference', adapter: growth ? 'xopc-growth-calibration' : 'xopc-core-calibration' }] };
  Object.assign(manifest, { version: suite.version, fixtureCommit: fixture.commit, ...(fixture.caseCommits ? { fixtureCaseCommits: fixture.caseCommits } : {}), suiteHash: suite.contentHash,
    selectionHash: createHash('sha256').update(JSON.stringify(suite.cases.map(c => c.id))).digest('hex'),
    graderHash: createHash('sha256').update(suite.contentHash).update(JSON.stringify(suite.cases.map(c => c.graders))).digest('hex'),
    budget: Object.fromEntries(suite.cases.map(c => [c.id, c.budget])),
    model: values.mode === 'live' ? values.model : 'not_applicable/reference-adapter',
    reasoning: values.mode === 'live' ? values.reasoning : 'not_applicable',
    lockfileHash: initialHashes['pnpm-lock.yaml'],
    environmentHash: createHash('sha256').update(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch })).digest('hex'),
    expected: suite.cases.length * repetitions * spec.variants.length, spec });
  writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const adapter = values.mode === 'live' ? new XopcGatewayAdapter() : growth ? growthCalibrationAdapter() : calibrationAdapter();
  const originalRun = adapter.run.bind(adapter);
  adapter.run = async (...args) => {
    console.log(`${args[0].evalCase.id} / ${args[0].variant.id}`);
    return originalRun(...args);
  };
  const abort = new AbortController();
  const cancel = () => abort.abort();
  process.on('SIGTERM', cancel); process.on('SIGINT', cancel);
  const result = await new EvalRunner({ store, artifactStore: new ArtifactStore(join(output, 'artifacts')), adapters: [adapter], signal: abort.signal,
    onSchedule: state => {
      writeFileSync(join(output, 'schedule.tmp'), JSON.stringify({ ...state, updatedAt: new Date().toISOString() }));
      // The campaign consumes a complete checkpoint, never a half-written JSON document.
      renameSync(join(output, 'schedule.tmp'), join(output, 'schedule.json'));
    },
  }).runExperiment(suite, spec).finally(() => { process.removeListener('SIGTERM', cancel); process.removeListener('SIGINT', cancel); });
  const detail = store.getExperiment(result.experimentId)!;
  writeFileSync(join(output, 'results.json'), JSON.stringify(detail, null, 2));
  const cases = result.runs.map(run => {
    const runDetail = store.getRun(run.runId)!;
    const record = runDetail.run;
    const usageEvents = store.getRun(run.runId)!.events.filter(event => event.type === 'model.response')
      .map(event => (JSON.parse(String(event.payload_json)) as { payload?: { usage?: Record<string, number> } }).payload?.usage);
    const observedTokens = usageEvents.length > 0 && usageEvents.every(usage => typeof usage?.total === 'number')
      ? usageEvents.reduce((sum, usage) => sum + usage!.total!, 0) : null;
    return { caseId: String(record.case_id), variantId: String(record.variant_id), runId: run.runId,
      status: run.status, artifactChecksPassed: run.grades.length > 0 && run.grades.every(grade => grade.passed),
      durationMs: record.ended_at ? Date.parse(String(record.ended_at)) - Date.parse(String(record.started_at)) : null,
      observedResponseTokens: observedTokens,
      usageCoverage: 'Observed completed responses only; interrupted requests may be unreported.',
      ...(growth ? { diagnostics: summarizeToolTrace(runDetail.events, runDetail.artifacts) } : {}) };
  });
  const sourceDrift = JSON.stringify(initialHashes) !== JSON.stringify(fingerprint());
  const variants = spec.variants.map(variant => {
    const rows = detail.runs.filter(run => String(run.variant_id).replace(/#\d+$/, '') === variant.id);
    const expectedRuns = suite.cases.length * repetitions;
    const passed = rows.filter(run => run.status === 'passed').length;
    const usage = rows.map(run => JSON.parse(String(run.usage_json ?? '{}')) as Record<string, number>);
    const totalCost = !String(values.model ?? '').startsWith('xopc-cloud/') && usage.length === expectedRuns && usage.every(item => typeof item.cost === 'number')
      ? usage.reduce((sum, item) => sum + item.cost!, 0) : null;
    const durationsMs = rows.map(run => run.ended_at ? Date.parse(String(run.ended_at)) - Date.parse(String(run.started_at)) : null);
    return { id: variant.id, expectedRuns, observedRuns: rows.length, passed, successRate: passed / expectedRuns,
      reportedEstimatedCost: totalCost, reportedEstimatedCostPerSuccess: totalCost !== null && passed > 0 ? totalCost / passed : null,
      durationsMs, totalReportedTokens: usage.length === expectedRuns && usage.every(item => typeof item.total === 'number')
        ? usage.reduce((sum, item) => sum + item.total!, 0) : null,
      statuses: Object.fromEntries(['passed','failed','error','timed_out','budget_exceeded'].map(status => [status, rows.filter(run => run.status === status).length])),
      categories: (growth ? ['information','convergence','project'] : ['research','data','change','recovery']).map(category => {
        const ids = new Set(suite.cases.filter(c => c.tags.includes(category)).map(c => c.id));
        return { category, expectedRuns: ids.size * repetitions, passed: rows.filter(run => ids.has(String(run.case_id)) && run.status === 'passed').length };
      }) };
  });
  const calibrated = values.mode === 'calibration' && variants.every(v => v.observedRuns === v.expectedRuns && v.passed === (v.id === 'reference' ? v.expectedRuns : 0));
  const passed = !sourceDrift && (values.mode === 'live' ? variants.every(v => v.passed === v.expectedRuns) : calibrated);
  const summary = { schemaVersion: 1, evidenceClass: manifest.evidenceClass, experimentId: result.experimentId, suiteHash: suite.contentHash,
    passed, sourceDrift, variants, cases, falseCompletionRate: null, costPerSuccess: null,
    unmeasured: ['false-completion semantics', 'complete provider cost coverage', 'autonomous background recovery', 'research prose quality'] };
  writeFileSync(join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  writeFileSync(join(output, 'summary.md'), [`# ${suite.id}@${suite.version} — ${manifest.evidenceClass}`, '',
    ...variants.map(v => `- ${v.id}: ${v.passed}/${v.expectedRuns} (${v.observedRuns} observed)`), '',
    '| Case | Variant | Status | Artifact checks | Observed response tokens |',
    '| --- | --- | --- | --- | --- |',
    ...cases.map(c => `| ${c.caseId} | ${c.variantId} | ${c.status} | ${c.artifactChecksPassed ? 'pass' : 'fail'} | ${c.observedResponseTokens ?? 'unknown'} |`), '',
    `Source drift: ${sourceDrift}. Evaluation gate: ${passed ? 'passed' : 'failed'}.`, '',
    ...(manifest.limitations as string[]).map(text => `- ${text}`), ''].join('\n'));
  Object.assign(manifest, { completedAt: new Date().toISOString(), sourceDrift });
  writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`Report: ${output}`);
  if (!passed) process.exitCode = 1;
} catch (error) {
  writeFileSync(join(output, 'error.json'), JSON.stringify({ status: 'harness_error', message: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
  console.error('Benchmark interrupted or failed to initialize; inspect error.json and evals.db.');
} finally {
  store.close();
  rmSync(temporary, { recursive: true, force: true });
}
