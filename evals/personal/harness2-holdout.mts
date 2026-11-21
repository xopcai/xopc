import { spawn } from 'node:child_process';
import { createHash, randomInt } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import type { CampaignPlan } from '../control/campaign.js';
import { reconcileJob } from '../control/reconciliation.js';
import { expectedMonthResults, matchesMonthResults } from './harness2-table-grade.mjs';

const [command, directory] = process.argv.slice(2);
if (!directory) throw new Error('Usage: node --import tsx evals/personal/harness2-holdout.mts prepare|run|assess <stage directory>');
const root = resolve(directory);
const holdout = join(root, 'holdout');
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const write = (path: string, data: unknown) => writeFileSync(path, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const arms = ['single', 'repeat', 'tuned'] as const;
const cases = ['year-boundary', 'net-adjustments'] as const;
const titles = ['monthly_summary.csv', 'report.md', 'reproduce.mjs'];
const requestBudget = 120;

function freshSales(id: string) {
  const base = randomInt(29, 49) * 10;
  if (id === 'year-boundary') {
    return `date,amount\n2026-02-20,${base - 62}\n2025-12-05,71\n2026-01-06,178\n2026-02-02,62\n2025-12-14,${base - 71}\n2026-01-18,${base * 2 - 178}\n`;
  }
  return `date,amount\n2026-05-05,${base * 1.5}\n2026-04-01,${base + 47}\n2026-06-02,${base * 1.2 + 83}\n2026-05-12,31\n2026-04-20,-47\n2026-05-17,-31\n2026-06-12,-83\n`;
}

function jobIds(arm: typeof arms[number]) {
  return arm === 'repeat' ? ['repeat-1', 'repeat-2'] : [arm];
}

function prepare() {
  const development = read(join(root, 'development', 'campaign.json'));
  const result = read(join(root, 'development', 'host-repair', 'multi-file-round-1.json'));
  const plan = read(join(root, 'development-plan.json')) as CampaignPlan;
  const fixture = plan.jobs[0].args[plan.jobs[0].args.indexOf('--harness2-sales-fixture') + 1];
  const treatment = plan.jobs[0].args[plan.jobs[0].args.indexOf('--harness2-treatment') + 1];
  const treatmentBytes = readFileSync(treatment);
  const devAudit = reconcileJob(join(root, 'development'), 'host-repair');
  const developmentGradePassed = result.success === true && result.deliveryStatus === 'succeeded'
    && result.acceptanceDisposition === 'completed' && result.restoredArtifactIds?.length === 2
    && matchesMonthResults(result.validationTable ?? '', expectedMonthResults(readFileSync(fixture, 'utf8')));
  if (development.status !== 'completed' || development.validity !== 'valid' || !developmentGradePassed
    || !devAudit.usageMatched || !devAudit.perRequestMatched || hash(treatmentBytes) !== result.benchmark.treatmentSha256) {
    throw new Error('Complete and reconcile the development delivery before generating the holdout');
  }
  mkdirSync(holdout, { mode: 0o700 });
  const candidatePath = join(holdout, 'frozen-treatment.json');
  writeFileSync(candidatePath, treatmentBytes, { flag: 'wx', mode: 0o600 });
  const fixtureHashes: Record<string, string> = {};
  for (const id of cases) {
    const sales = freshSales(id);
    const salesPath = join(holdout, id + '.csv');
    writeFileSync(salesPath, sales, { flag: 'wx', mode: 0o600 });
    fixtureHashes[id] = hash(sales);
    for (const arm of arms) {
      const template = plan.jobs[0];
      const jobs = jobIds(arm).map(jobId => {
        const args = template.args.map(arg => arg.replaceAll('{output}/host-repair', '{output}/' + jobId));
        args[args.indexOf('--harness2-sales-fixture') + 1] = salesPath;
        const treatmentIndex = args.indexOf('--harness2-treatment');
        if (arm === 'tuned') args[treatmentIndex + 1] = candidatePath;
        else args.splice(treatmentIndex, 2);
        return { ...template, id: jobId, args,
          evidence: template.evidence?.map(item => ({ ...item, path: item.path.replace('{output}/host-repair', '{output}/' + jobId) })) };
      });
      write(join(holdout, `${id}-${arm}.json`), { ...plan, id: `harness2-holdout-${id}-${arm}`,
        concurrency: jobs.length, maxRequests: requestBudget, jobs });
    }
  }
  write(join(holdout, 'registration.json'), { registeredAt: new Date().toISOString(), cases, arms, budgets: { requestsPerCaseArm: requestBudget, wallMs: plan.maxWallMs },
    fixtureHashes, treatmentSha256: hash(treatmentBytes), developmentPlanSha256: hash(readFileSync(join(root, 'development-plan.json'))),
    selection: 'Repeat selects by count of available requested files, then successful delivery status, then earlier scheduled draw. Compute the independent score after selection.',
    accounting: 'Each case-arm has the same online request-admission cap. The two repeat attempts share that cap. Physical requests and tokens are reported as observed. Exploration before candidate freeze is separate.',
    scope: 'Frozen guidance versus fixed harness, both using identical current host repair and review runtime.' });
  console.log(`Registered ${cases.length} new cases with a shared ${requestBudget}-request ceiling per case and arm.`);
}

async function run() {
  const registration = read(join(holdout, 'registration.json'));
  if (registration.budgets.requestsPerCaseArm !== requestBudget
    || hash(readFileSync(join(holdout, 'frozen-treatment.json'))) !== registration.treatmentSha256
    || cases.some(id => hash(readFileSync(join(holdout, id + '.csv'))) !== registration.fixtureHashes[id])) {
    throw new Error('Holdout inputs or budget changed after registration');
  }
  const results = [];
  for (const id of cases) {
    const attempts = arms.map(async (arm, index) => {
      // Stagger SQLite initialization while still running the arms together.
      await delay(index * 1200);
      return launch(`${id}-${arm}`, 1);
    });
    const first = await Promise.all(attempts);
    results.push(...first);
    for (const result of first) {
      if (existsSync(join(holdout, result.name))) continue;
      results.push(await launch(result.name, 2));
    }
    console.log(`All arms finished for ${id}`);
  }
  write(join(holdout, 'execution.json'), results);
}

function launch(name: string, launchAttempt: number): Promise<{ name: string; launchAttempt: number; code: number | null; error?: string }> {
  console.log(`Starting ${name}`);
  const log = openSync(join(holdout, `${name}-launcher-${launchAttempt}.log`), 'wx', 0o600);
  return new Promise(resolveResult => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'evals/control/cli.ts', 'run',
      '--plan', join(holdout, name + '.json'), '--output', join(holdout, name)], { stdio: ['ignore', log, log] });
    closeSync(log);
    child.once('error', error => resolveResult({ name, launchAttempt, code: null, error: error.message }));
    child.once('close', code => resolveResult({ name, launchAttempt, code }));
  });
}

function assess() {
  const registration = read(join(holdout, 'registration.json'));
  for (const id of cases) for (const arm of arms) {
    const path = join(holdout, `${id}-${arm}`, 'campaign.json');
    if (!existsSync(path) || ['running', 'paused', 'draining'].includes(read(path).status)) {
      throw new Error(`Wait for ${id}-${arm} to finish before scoring the holdout`);
    }
  }
  const evidence = cases.map(id => {
    const input = readFileSync(join(holdout, id + '.csv'), 'utf8');
    const expected = expectedMonthResults(input);
    return { id, arms: arms.map(arm => {
      const directory = join(holdout, `${id}-${arm}`);
      const campaign = read(join(directory, 'campaign.json'));
      const attempts = jobIds(arm).map(jobId => {
        const path = join(directory, jobId, 'multi-file-round-1.json');
        const result = existsSync(path) ? read(path) : {};
        const preview = result.deliveryArtifacts ?? [];
        const visibleFiles = titles.filter(title => preview.some((item: { title: string; availability: string }) =>
          item.title === title && item.availability === 'available')).length;
        const audit = reconcileJob(directory, jobId);
        return { jobId, result, visibleFiles, audit };
      });
      const ranked = [...attempts].sort((left, right) => right.visibleFiles - left.visibleFiles
        || Number(right.result.deliveryStatus === 'succeeded') - Number(left.result.deliveryStatus === 'succeeded'));
      const selected = ranked[0].jobId;
      const grades = attempts.map(({ jobId, result, audit, visibleFiles }) => {
        const valid = audit.perRequestMatched && audit.usageMatched && audit.unknownRequests === 0
          && result.benchmark?.frozenReproduction === true && result.benchmark?.sourceChangedDuringRun === false
          && result.benchmark?.salesSha256 === registration.fixtureHashes[id] && hash(input) === registration.fixtureHashes[id]
          && result.benchmark?.treatmentSha256 === (arm === 'tuned' ? registration.treatmentSha256 : null);
        const csvCorrect = matchesMonthResults(result.validationTable ?? '', expected);
        return { jobId, valid, passed: valid && result.success === true && result.deliveryStatus === 'succeeded'
          && result.acceptanceDisposition === 'completed' && csvCorrect && result.restoredArtifactIds?.length === 2,
          csvCorrect, visibleFiles, failure: result.failure ?? null, latency: result.durationMs ?? null,
          requests: audit.physicalRequests, tokens: audit.wireTokens, models: result.models ?? null };
      });
      const requests = grades.reduce((sum, row) => sum + row.requests, 0);
      const valid = campaign.validity === 'valid' && campaign.sourceChanged === false && campaign.pool?.maxRequests === requestBudget
        && Date.parse(registration.registeredAt) < Date.parse(campaign.startedAt)
        && requests === campaign.admittedRequests && requests <= requestBudget && grades.every(row => row.valid);
      return { arm, valid, source: campaign.sourceHash, selected, passed: valid && grades.find(row => row.jobId === selected)?.passed === true,
        requests, tokens: grades.every(row => row.tokens !== null) ? grades.reduce((sum, row) => sum + Number(row.tokens), 0) : null, grades };
    }) };
  });
  const results = evidence.flatMap(row => row.arms);
  const valid = results.every(row => row.valid) && new Set(results.map(row => row.source)).size === 1
    && new Set(results.flatMap(row => row.grades.map(grade => JSON.stringify(grade.models)))).size === 1;
  const groups = Object.fromEntries(arms.map(arm => {
    const rows = results.filter(row => row.arm === arm);
    return [arm, { passed: rows.filter(row => row.passed).length, valid: rows.filter(row => row.valid).length, expected: cases.length,
      requests: rows.reduce((sum, row) => sum + row.requests, 0),
      tokens: rows.every(row => row.tokens !== null) ? rows.reduce((sum, row) => sum + Number(row.tokens), 0) : null }];
  }));
  const decision = !valid ? 'insufficient_evidence' : groups.tuned.passed > groups.repeat.passed && groups.tuned.passed === cases.length
    ? 'tuned_passes' : 'tuned_did_not_clear_gate';
  write(join(holdout, 'assessment.json'), { decision, valid, groups, evidence, registrationSha256: hash(readFileSync(join(holdout, 'registration.json'))) });
  console.log(JSON.stringify({ decision, groups }, null, 2));
}

if (command === 'prepare') prepare();
else if (command === 'run') await run();
else if (command === 'assess') assess();
else throw new Error('Unknown holdout command');
