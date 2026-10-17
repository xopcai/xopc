#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { runGrader } from '@agent-evals/graders';
import { TraceEmitter, type EvalCase, type ExperimentSpec } from '@agent-evals/protocol';
import { loadSuite } from '@agent-evals/runner';
import { GitCloneSandbox } from '@agent-evals/sandbox';
import { ArtifactStore, EvalStore } from '@agent-evals/storage';

const { values } = parseArgs({ options: { input: { type: 'string' }, output: { type: 'string' } } });
if (!values.input || !values.output) throw new Error('Pass --input <original benchmark directory> --output <fresh directory>');
const input = resolve(values.input);
const output = resolve(values.output);
const originalManifest = JSON.parse(readFileSync(join(input, 'manifest.json'), 'utf8')) as Record<string, any>;
assert.equal(originalManifest.benchmark, 'xopc-core');
assert.equal(originalManifest.evidenceClass, 'live-direct-agent', 'Only original live execution evidence may be regraded');
assert.equal(originalManifest.sourceDrift, false, 'Source-drift trials cannot become a clean baseline');
mkdirSync(dirname(output), { recursive: true });
mkdirSync(output);
const temporary = mkdtempSync(join(tmpdir(), 'xopc-regrade-'));
const source = new EvalStore(join(input, 'evals.db'));
const target = new EvalStore(join(output, 'evals.db'));
const artifacts = new ArtifactStore(join(output, 'artifacts'));
const sandbox = new GitCloneSandbox();
try {
  const originalSummary = JSON.parse(readFileSync(join(input, 'summary.json'), 'utf8')) as { experimentId: string };
  const original = source.getExperiment(originalSummary.experimentId)!;
  assert.ok(original);
  const fixture = join(temporary, 'fixture');
  execFileSync('git', ['clone', '--quiet', join(input, 'fixture.bundle'), fixture]);
  copyFileSync(join(input, 'fixture.bundle'), join(output, 'fixture.bundle'));
  process.env.EVAL_FIXTURE_REPO = fixture;
  process.env.EVAL_FIXTURE_COMMIT = String(originalManifest.fixtureCommit);
  const suitePath = fileURLToPath(new URL('../../../suites/xopc-core/suite.yaml', import.meta.url));
  const suite = await loadSuite(suitePath);
  const spec = JSON.parse(String(original.experiment.spec_json)) as ExperimentSpec;
  const expectedRuns = suite.cases.length * (spec.repetitions ?? 1) * spec.variants.length;
  assert.equal(original.runs.length, expectedRuns, 'Regrading requires a complete original attempt matrix');
  const experimentId = randomUUID();
  target.createExperiment({ id: experimentId, name: `${spec.name} — artifact regrade`, suiteId: suite.id,
    suiteVersion: suite.version, suiteHash: suite.contentHash, spec });
  const rows: Array<Record<string, any>> = [];
  for (const row of original.runs) {
    const evalCase = suite.cases.find(c => c.id === row.case_id)!;
    assert.ok(evalCase, 'Case sets must match');
    const prior = JSON.parse(String(row.case_json)) as EvalCase;
    for (const field of ['task', 'followUps', 'budget', 'prepare', 'setup'] as const) {
      assert.deepEqual(evalCase[field], prior[field], `Execution contract changed: ${evalCase.id}/${field}; run a new model trial`);
    }
    assert.equal(String(row.source_commit), originalManifest.fixtureCommit);
    const environment = await sandbox.prepare(evalCase);
    const runId = randomUUID();
    target.createRun({ id: runId, experimentId, evalCase, variantId: String(row.variant_id), adapter: 'artifact-regrade',
      sourceCommit: environment.sourceCommit, fixtureCommit: environment.fixtureCommit });
    const trace = new TraceEmitter(runId, event => target.appendEvent(event));
    try {
      const detail = source.getRun(String(row.id))!;
      const diffRows = detail.artifacts.filter(a => a.kind === 'workspace-diff');
      assert.ok(diffRows.length <= 1, 'Ambiguous workspace snapshot');
      for (const artifact of diffRows) {
        const path = String(artifact.path);
        assert.ok(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink());
        const bytes = readFileSync(path);
        assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.sha256, 'Snapshot content hash mismatch');
        const patch = join(temporary, `${runId}.patch`);
        writeFileSync(patch, bytes);
        execFileSync('git', ['apply', '--binary', patch], { cwd: environment.workspace });
        const copy = artifacts.putText(runId, 'workspace-diff', bytes.toString('utf8'), 'text/x-diff');
        target.recordArtifact(copy);
      }
      const trajectory = artifacts.putText(runId, 'original-trajectory', JSON.stringify(detail.events), 'application/json');
      target.recordArtifact(trajectory);
      await trace.emit('agent.event', { kind: 'regrade.original_execution', sourceExperimentId: originalSummary.experimentId,
        originalRunId: row.id, originalStatus: row.status, modelRequestsIssuedByRegrader: 0 }, { artifactRefs: [trajectory.id] });
      const grades = [];
      for (const [index, grader] of evalCase.graders.entries()) {
        const grade = await runGrader(grader, index, { runId, workspace: environment.workspace, artifactStore: artifacts,
          store: target, finalText: String(row.final_text) });
        target.recordGrade(runId, grade);
        grades.push(grade);
      }
      const artifactChecksPassed = grades.filter(g => g.required).every(g => g.passed);
      // Regrading cannot turn an execution error, timeout or budget breach into success.
      const status = ['passed', 'failed'].includes(String(row.status))
        ? artifactChecksPassed ? 'passed' : 'failed' : String(row.status);
      const totalWeight = grades.reduce((sum, grade) => sum + grade.weight, 0);
      const score = totalWeight > 0 ? grades.reduce((sum, grade) => sum + grade.score * grade.weight, 0) / totalWeight : 0;
      target.completeRun(runId, { status, score, finalText: String(row.final_text),
        usage: JSON.parse(String(row.usage_json)), runtimeIdentity: JSON.parse(String(row.runtime_identity_json)),
        ...(row.error ? { error: String(row.error) } : {}) });
      await trace.emit('run.completed', { status, originalStatus: row.status, regraded: true });
      rows.push({ caseId: evalCase.id, variantId: row.variant_id, runId, originalRunId: row.id, originalStatus: row.status,
        status, artifactChecksPassed, executionDurationMs: Date.parse(String(row.ended_at)) - Date.parse(String(row.started_at)),
        changed: status !== row.status });
      console.log(`${evalCase.id}: ${row.status} -> ${status}`);
    } finally { sandbox.cleanup(environment); }
  }
  const sourceDrift = (await loadSuite(suitePath)).contentHash !== suite.contentHash;
  const passed = !sourceDrift && rows.every(row => row.status === 'passed');
  target.completeExperiment(experimentId, passed ? 'completed' : 'failed');
  const variants = spec.variants.map(variant => {
    const cases = rows.filter(row => String(row.variantId).replace(/#\d+$/, '') === variant.id);
    const expected = suite.cases.length * (spec.repetitions ?? 1);
    return { id: variant.id, expectedRuns: expected, observedRuns: cases.length, passed: cases.filter(row => row.status === 'passed').length,
      statuses: Object.fromEntries(['passed','failed','error','timed_out','budget_exceeded'].map(status => [status, cases.filter(row => row.status === status).length])),
      categories: ['research','data','change','recovery'].map(category => {
        const ids = new Set(suite.cases.filter(c => c.tags.includes(category)).map(c => c.id));
        return { category, expectedRuns: ids.size * (spec.repetitions ?? 1), passed: cases.filter(row => ids.has(row.caseId) && row.status === 'passed').length };
      }) };
  });
  const manifest = { ...originalManifest, evidenceClass: 'regraded-live-direct-agent', executionSuiteHash: originalManifest.suiteHash,
    executionSuiteVersion: originalManifest.version, version: suite.version, suiteHash: suite.contentHash,
    sourceExperimentId: originalSummary.experimentId, sourceDirectory: input, sourceDrift,
    regradeScriptHash: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
    modelRequestsIssuedByRegrader: 0, regradedAt: new Date().toISOString() };
  const summary = { schemaVersion: 1, evidenceClass: manifest.evidenceClass, experimentId, sourceExperimentId: originalSummary.experimentId,
    suiteHash: suite.contentHash, passed, sourceDrift, variants, cases: rows, modelRequestsIssuedByRegrader: 0,
    costPerSuccess: null, falseCompletionRate: null,
    note: 'Original live trajectories and output bytes were regraded. No model was rerun; original execution failures are preserved.' };
  writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  writeFileSync(join(output, 'results.json'), JSON.stringify(target.getExperiment(experimentId), null, 2));
  writeFileSync(join(output, 'summary.md'), [`# xopc benchmark v1 — artifact regrade`, '',
    ...variants.map(v => `- ${v.id}: ${v.passed}/${v.expectedRuns}`), '',
    '| Case | Original status | Regraded status | Artifact checks |', '| --- | --- | --- | --- |',
    ...rows.map(row => `| ${row.caseId} | ${row.originalStatus} | ${row.status} | ${row.artifactChecksPassed ? 'pass' : 'fail'} |`), '',
    summary.note, 'Single live repetition; not a production reliability estimate.', ''].join('\n'));
  if (!passed) process.exitCode = 1;
  console.log(`Report: ${output}`);
} catch (error) {
  writeFileSync(join(output, 'error.json'), JSON.stringify({ status: 'regrade_error', message: error instanceof Error ? error.message : String(error) }, null, 2));
  throw error;
} finally { source.close(); target.close(); rmSync(temporary, { recursive: true, force: true }); }
