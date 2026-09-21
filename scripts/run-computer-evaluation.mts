import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { evaluateComputerRuns } from '../src/computer/evaluation.js';
import { runComputerEvaluationManifest } from '../src/computer/evaluation-harness.js';
import { writeTextAtomic } from '../src/infra/write-file-atomic.js';

const [manifestPath, outputPath] = process.argv.slice(2);
if (!manifestPath || !outputPath) throw new Error('Usage: node --import tsx scripts/run-computer-evaluation.mts <manifest.json> <report.json>');
const manifest = JSON.parse(await readFile(resolve(manifestPath), 'utf8'));
const destination = resolve(outputPath);
const runs: unknown[] = [];
const evidence: Record<string, string> = {};
const result = await runComputerEvaluationManifest(manifest, { onRun: async (run, evidenceRef) => {
  runs.push(run);
  evidence[`${run.taskId}:${run.repetition}`] = evidenceRef;
  await writeTextAtomic(destination, JSON.stringify({ plan: manifest.plan, runs, evidence }, null, 2), { mode: 0o600 });
} });
const summary = evaluateComputerRuns(result.plan, result.runs);
await writeTextAtomic(destination, JSON.stringify({ ...result, summary }, null, 2), { mode: 0o600 });
console.log(JSON.stringify(summary, null, 2));
if (!summary.betaGatePassed) process.exitCode = 1;
