import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';

type BenchCase = {
  id: string;
  args: string[];
  firstOutputBudgetMs?: number;
  exitBudgetMs?: number;
};

type BenchSample = {
  durationMs: number;
  firstOutputMs: number | null;
  exitCode: number | null;
  signal: string | null;
  stdoutTail: string;
  stderrTail: string;
};

type BenchResult = {
  entry: string;
  cases: Array<BenchCase & { samples: BenchSample[]; summary: BenchSummary }>;
};

type BenchSummary = {
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  firstOutputAvgMs: number | null;
  passedBudget: boolean;
};

// Budgets are cold per-process spawns (warmup does not carry across processes).
// Use generous first-byte limits so slower laptops / AV scanning do not flake;
// regressions that pull the full app graph into `--version` still blow past these.
const DEFAULT_CASES: BenchCase[] = [
  { id: 'version', args: ['--version'], firstOutputBudgetMs: 800, exitBudgetMs: 1500 },
  { id: 'help', args: ['--help'], firstOutputBudgetMs: 1000, exitBudgetMs: 1500 },
  { id: 'gatewayHelp', args: ['gateway', '--help'], firstOutputBudgetMs: 1000, exitBudgetMs: 1500 },
  { id: 'configShowHelp', args: ['config', '--help'], firstOutputBudgetMs: 1000, exitBudgetMs: 1500 },
];

function parseFlagValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function resolveCases(): BenchCase[] {
  const requested = parseFlagValue('--case');
  if (!requested) return DEFAULT_CASES;
  const requestedIds = new Set(requested.split(',').map((value) => value.trim()).filter(Boolean));
  return DEFAULT_CASES.filter((benchCase) => requestedIds.has(benchCase.id));
}

function tail(value: string): string {
  const maxLength = 2000;
  return value.length > maxLength ? value.slice(-maxLength) : value;
}

function summarize(samples: BenchSample[], benchCase: BenchCase): BenchSummary {
  const sortedDurations = samples.map((sample) => sample.durationMs).toSorted((left, right) => left - right);
  const firstOutputs = samples
    .map((sample) => sample.firstOutputMs)
    .filter((value): value is number => value !== null)
    .toSorted((left, right) => left - right);
  const average = sortedDurations.reduce((sum, value) => sum + value, 0) / sortedDurations.length;
  const firstOutputAverage =
    firstOutputs.length > 0 ? firstOutputs.reduce((sum, value) => sum + value, 0) / firstOutputs.length : null;
  const p50Index = Math.min(sortedDurations.length - 1, Math.floor(sortedDurations.length * 0.5));
  const p95Index = Math.min(sortedDurations.length - 1, Math.ceil(sortedDurations.length * 0.95) - 1);
  const exitBudgetPassed = benchCase.exitBudgetMs === undefined || sortedDurations[p95Index]! <= benchCase.exitBudgetMs;
  const firstOutputBudgetPassed =
    benchCase.firstOutputBudgetMs === undefined ||
    firstOutputAverage === null ||
    firstOutputAverage <= benchCase.firstOutputBudgetMs;
  return {
    avgMs: Math.round(average),
    p50Ms: Math.round(sortedDurations[p50Index]!),
    p95Ms: Math.round(sortedDurations[p95Index]!),
    minMs: Math.round(sortedDurations[0]!),
    maxMs: Math.round(sortedDurations[sortedDurations.length - 1]!),
    firstOutputAvgMs: firstOutputAverage === null ? null : Math.round(firstOutputAverage),
    passedBudget: exitBudgetPassed && firstOutputBudgetPassed,
  };
}

function runOnce(params: { entry: string; args: string[]; timeoutMs: number }): Promise<BenchSample> {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    let firstOutputMs: number | null = null;
    let stdout = '';
    let stderr = '';
    const child = spawn(process.execPath, [params.entry, ...params.args], {
      env: {
        ...process.env,
        XOPC_LOG_CONSOLE: 'false',
        XOPC_LOG_FILE: 'false',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
    }, params.timeoutMs);

    const markFirstOutput = (): void => {
      firstOutputMs ??= performance.now() - startedAt;
    };

    child.stdout.on('data', (chunk: Buffer) => {
      markFirstOutput();
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      markFirstOutput();
      stderr += chunk.toString();
    });
    child.on('exit', (exitCode, signal) => {
      clearTimeout(timeout);
      resolve({
        durationMs: performance.now() - startedAt,
        firstOutputMs,
        exitCode,
        signal,
        stdoutTail: tail(stdout),
        stderrTail: tail(stderr),
      });
    });
  });
}

async function main(): Promise<void> {
  const entry = parseFlagValue('--entry') ?? 'dist/src/cli/bin.js';
  const runs = parsePositiveInt(parseFlagValue('--runs'), 5);
  const warmup = parsePositiveInt(parseFlagValue('--warmup'), 1);
  const timeoutMs = parsePositiveInt(parseFlagValue('--timeout-ms'), 10000);
  const output = parseFlagValue('--output');
  const json = hasFlag('--json');
  const cases = resolveCases();

  const result: BenchResult = { entry, cases: [] };
  for (const benchCase of cases) {
    for (let index = 0; index < warmup; index += 1) {
      await runOnce({ entry, args: benchCase.args, timeoutMs });
    }
    const samples: BenchSample[] = [];
    for (let index = 0; index < runs; index += 1) {
      samples.push(await runOnce({ entry, args: benchCase.args, timeoutMs }));
    }
    result.cases.push({ ...benchCase, samples, summary: summarize(samples, benchCase) });
  }

  if (output) {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  }

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  for (const benchCase of result.cases) {
    const summary = benchCase.summary;
    const status = summary.passedBudget ? 'PASS' : 'FAIL';
    console.log(
      `${status} ${benchCase.id}: p50=${summary.p50Ms}ms p95=${summary.p95Ms}ms first=${summary.firstOutputAvgMs ?? 'n/a'}ms`,
    );
  }

  if (result.cases.some((benchCase) => !benchCase.summary.passedBudget)) {
    process.exitCode = 1;
  }
}

await main();
