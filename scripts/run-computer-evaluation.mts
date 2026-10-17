import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { evaluateComputerRuns } from '../src/computer/evaluation.js';
import { ComputerEvaluationHarnessManifestSchema, runComputerEvaluationManifest } from '../src/computer/evaluation-harness.js';
import { classifyComputerFailure } from '../src/computer/diagnostics.js';
import { writeTextAtomic } from '../src/infra/write-file-atomic.js';

const [manifestPath, outputPath] = process.argv.slice(2);
if (!manifestPath || !outputPath) throw new Error('Usage: node --import tsx scripts/run-computer-evaluation.mts <manifest.json> <report.json>');
const manifest = ComputerEvaluationHarnessManifestSchema.parse(JSON.parse(await readFile(resolve(manifestPath), 'utf8')));
const destination = resolve(outputPath);
const runs: unknown[] = [];
const evidence: Record<string, string> = {};
const controller = new AbortController();
const abort = () => controller.abort(new Error('COMPUTER_EVALUATION_ABORTED'));
process.once('SIGINT', abort); process.once('SIGTERM', abort);
try {
  await writeTextAtomic(destination, JSON.stringify({ plan: manifest.plan, runs, evidence, interrupted: false }, null, 2), { mode: 0o600 });
  const result = await runComputerEvaluationManifest(manifest, { signal: controller.signal, onRun: async (run, evidenceRef) => {
    runs.push(run);
    if (evidenceRef) evidence[`${run.taskId}:${run.repetition}`] = evidenceRef;
    await writeTextAtomic(destination, JSON.stringify({ plan: manifest.plan, runs, evidence }, null, 2), { mode: 0o600 });
  } });
  const summary = evaluateComputerRuns(result.plan, result.runs);
  await writeTextAtomic(destination, JSON.stringify({ ...result, summary }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(summary, null, 2));
  if (result.interrupted || !summary.betaGatePassed) process.exitCode = 1;
} catch (error) {
  const summary = evaluateComputerRuns(manifest.plan, runs);
  await writeTextAtomic(destination, JSON.stringify({ plan: manifest.plan, runs, evidence, interrupted: true,
    interruption: classifyComputerFailure(error, 'executor', 'unknown', controller.signal.aborted), summary }, null, 2), { mode: 0o600 });
  throw new Error(controller.signal.aborted ? 'COMPUTER_EVALUATION_ABORTED' : 'COMPUTER_EVALUATION_FAILED');
} finally { process.off('SIGINT', abort); process.off('SIGTERM', abort); }
