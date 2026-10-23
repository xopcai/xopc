import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

if (process.argv.includes('--configured-models')) process.env.XOPC_ALLOCATION_LIVE = '1';
if (process.env.XOPC_ALLOCATION_LIVE !== '1') throw new Error('Set XOPC_ALLOCATION_LIVE=1 to authorize configured real models');
const args = process.argv.slice(2);
const option = (key: string, fallback: string) => { const index = args.indexOf(key); return index < 0 ? fallback : args[index + 1] ?? fallback; };
const adapter = option('--adapter', 'scripts/personal-repair-live-smoke-v2.mts');
if (!['scripts/personal-repair-live-smoke.mts', 'scripts/personal-repair-live-smoke-v2.mts'].includes(adapter)) throw new Error('Unknown versioned adapter');
const rounds = Number(option('--rounds', '2'));
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 5) throw new Error('Expected 1–5 rounds');
const scenarios = option('--scenarios', 'web,conflict,file,direction').split(',');
if (!scenarios.every(scenario => ['web', 'conflict', 'file', 'direction', 'mixed'].includes(scenario))) throw new Error('Unknown scenario');
const directory = resolve(option('--output-dir', '.xopc-evals/personal/p2-live'));
mkdirSync(directory, { recursive: true });
const trials: Array<Record<string, any>> = [];
let stopAfterTrial = false;
process.on('SIGUSR1', () => { stopAfterTrial = true; });
const percentile = (values: number[], fraction: number) => values.length ? [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)] : null;
const save = () => {
  const passed = trials.filter(trial => trial.success).length;
  const groups = Object.fromEntries(scenarios.map(scenario => { const group = trials.filter(trial => trial.scenario === scenario);
    return [scenario, { total: group.length, passed: group.filter(trial => trial.success).length }]; }));
  const hashes = new Set(trials.map(trial => JSON.stringify(trial.sourceHashes)).filter(value => value !== undefined));
  const report = { schemaVersion: 1, suite: 'personal-delivery-live-repair', suiteVersion: adapter.endsWith('-v2.mts') ? 6 : 1, adapter, mode: 'real-model-isolated-gateway',
    createdAt: new Date().toISOString(), requestedRounds: rounds, requestedScenarios: scenarios,
    total: trials.length, passed, failed: trials.length - passed, sourceVersions: hashes.size,
    sameSourceAcrossTrials: hashes.size === 1, groups,
    observations: { totalMedianMs: percentile(trials.map(trial => trial.totalMs).filter(Number.isFinite), .5),
      totalP95Ms: percentile(trials.map(trial => trial.totalMs).filter(Number.isFinite), .95),
      fallbackCount: trials.reduce((sum, trial) => sum + trial.fallbackCount, 0),
      repairRoundCount: trials.reduce((sum, trial) => sum + trial.repairs, 0),
      conciseReplies: trials.filter(trial => trial.replyCharacters <= 600).length },
    limitations: ['Small sample: percentiles are descriptive, not SLA estimates.', 'Live MDN retrieval; other sales/prices are frozen synthetic fixtures.',
      'Conflict/file faults are disclosed injections; no production files are deleted.', 'No failed round is discarded or automatically replaced.',
      'Source hashes distinguish revisions; compare only unchanged versions.', 'Length is a style proxy, not a human naturalness score.'], trials };
  writeFileSync(join(directory, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
};
trialLoop: for (let round = 1; round <= rounds; round++) for (const scenario of scenarios) {
  const reportPath = join(directory, `${scenario}-round-${round}.json`);
  if (existsSync(reportPath)) throw new Error(`Refusing to replace an existing trial: ${reportPath}`);
  console.log(JSON.stringify({ stage: 'trial_start', round, scenario, reportPath }));
  const code = await new Promise<number | null>((resolveCode, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', adapter], {
      cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, XOPC_REPAIR_SCENARIO: scenario, XOPC_ALLOCATION_REPORT: reportPath },
    });
    const timeout = setTimeout(() => child.kill('SIGTERM'), 12 * 60_000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); resolveCode(code); });
  });
  const result = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : { failure: 'Runner exited before saving report' };
  trials.push({ round, scenario, reportPath, exitCode: code,
    success: code === 0 && result.success === true && !result.benchmark?.sourceChangedDuringRun,
    failure: result.failure, sourceChangedDuringRun: result.benchmark?.sourceChangedDuringRun,
    sourceHashes: result.benchmark?.sourceHashes, models: result.models, totalMs: result.durationMs?.total,
    fallbackCount: result.compositionFallbackEvents?.length ?? 0, repairs: result.repairEvents?.length ?? 0,
    replyCharacters: result.replyCharacters, mainInputPreRead: result.mainInputPreRead, mainStrategy: result.mainStrategy, acceptanceDisposition: result.acceptanceDisposition, repairDisposition: result.repairDisposition, injections: result.injections, downloads: result.downloads?.length,
    checks: result.research?.checks.length, instructionChecks: result.research?.instructionChecks?.length });
  save(); console.log(JSON.stringify({ stage: 'trial_finished', round, scenario, success: trials.at(-1)!.success }));
  if (stopAfterTrial) { console.log(JSON.stringify({ stage: 'stopped_after_trial', completed: trials.length })); break trialLoop; }
}
process.exitCode = trials.length === rounds * scenarios.length && trials.every(trial => trial.success) ? 0 : 1;
