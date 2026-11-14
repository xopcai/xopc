import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

type GatewayBenchSample = {
  durationMs: number;
  readyMs: number | null;
  httpListeningMs: number | null;
  maxRssMb: number | null;
  exitCode: number | null;
  signal: string | null;
  outputTail: string;
  startupTrace: Record<string, number>;
};

type GatewayBenchSummary = {
  avgReadyMs: number | null;
  p50ReadyMs: number | null;
  p95ReadyMs: number | null;
  maxReadyMs: number | null;
  avgMaxRssMb: number | null;
  passedBudget: boolean;
};

type GatewayBenchResult = {
  entry: string;
  executable: string;
  warmup: number;
  freshCompileCache: boolean;
  skipChannels: boolean;
  port: number;
  samples: GatewayBenchSample[];
  summary: GatewayBenchSummary;
};

const DEFAULT_ENTRY = 'dist/src/cli/bin.js';
const DEFAULT_RUNS = 3;
const DEFAULT_WARMUP = 1;
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_READY_BUDGET_MS = 15_000;
const DEFAULT_RSS_BUDGET_MB = 512;

function parseFlagValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function tail(value: string, maxLength = 4000): string {
  return value.length > maxLength ? value.slice(-maxLength) : value;
}

async function reservePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to reserve port')));
        return;
      }
      const port = address.port;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

function probeHealth(port: number): Promise<{ ready: boolean; httpListening: boolean }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/health',
        method: 'GET',
        timeout: 2_000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk.toString();
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body) as { ready?: boolean; status?: string };
            resolve({
              ready: res.statusCode === 200 && parsed.ready === true,
              httpListening: res.statusCode === 200 && (parsed.status === 'starting' || parsed.status === 'ok'),
            });
          } catch {
            resolve({ ready: false, httpListening: false });
          }
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('health probe timeout'));
    });
    req.on('error', reject);
    req.end();
  });
}

function parseStartupTrace(output: string): Record<string, number> {
  const trace: Record<string, number> = {};
  for (const line of output.split('\n')) {
    const match = line.match(/startup trace: ([^\s]+) ([0-9.]+)ms total=([0-9.]+)ms/);
    if (!match) continue;
    trace[match[1]!] = Number.parseFloat(match[2]!);
  }
  return trace;
}

async function runOnce(params: {
  entry: string;
  executable: string;
  port: number;
  timeoutMs: number;
  compileCacheDir: string;
  skipChannels: boolean;
}): Promise<GatewayBenchSample> {
  const tempRoot = mkdtempSync(join(tmpdir(), 'xopc-gateway-bench-'));
  const configPath = join(tempRoot, 'xopc.json');
  const workspacePath = join(tempRoot, 'workspace');
  mkdirSync(workspacePath, { recursive: true });
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        gateway: {
          mode: 'local',
          bind: 'loopback',
          port: params.port,
          auth: { mode: 'token', token: randomBytes(32).toString('base64url') },
        },
        browser: { enabled: false },
      },
      null,
      2,
    )}\n`,
  );

  const inheritedEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(XOPC_|PI_)/.test(key) && !/(API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key),
  ));
  const startedAt = performance.now();
  let output = '';
  let readyMs: number | null = null;
  let httpListeningMs: number | null = null;
  let finished = false;

  return await new Promise<GatewayBenchSample>((resolve) => {
    const child = spawn(
      params.executable,
      [params.entry, 'gateway', '--port', String(params.port), '--bind', 'loopback', '--no-hot-reload'],
      {
        env: {
          ...inheritedEnv,
          XOPC_CONFIG_PATH: configPath,
          XOPC_CONFIG: configPath,
          XOPC_WORKSPACE: workspacePath,
          XOPC_STATE_DIR: tempRoot,
          XOPC_HOME: tempRoot,
          PI_CODING_AGENT_DIR: join(tempRoot, 'pi'),
          XOPC_SKIP_CHANNELS: params.skipChannels ? '1' : '0',
          XOPC_SKIP_PROVIDERS: '0',
          XOPC_GATEWAY_STARTUP_TRACE: process.env.XOPC_GATEWAY_BENCH_TRACE === '1' ? '1' : '0',
          NODE_COMPILE_CACHE: params.compileCacheDir,
          XOPC_LOG_CONSOLE: process.env.XOPC_GATEWAY_BENCH_TRACE === '1' ? 'true' : 'false',
          ...(process.env.XOPC_GATEWAY_BENCH_TRACE === '1' ? { XOPC_LOG_LEVEL: 'info' } : {}),
          XOPC_LOG_FILE: 'false',
          XOPC_NO_RESPAWN: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
    }, params.timeoutMs);

    const appendOutput = (chunk: Buffer) => {
      output += chunk.toString();
    };
    child.stdout.on('data', appendOutput);
    child.stderr.on('data', appendOutput);

    const poll = async (): Promise<void> => {
      if (finished) {
        return;
      }
      try {
        const health = await probeHealth(params.port);
        if (finished) return;
        if (health.httpListening && httpListeningMs === null) {
          httpListeningMs = performance.now() - startedAt;
        }
        if (health.ready) {
          readyMs = performance.now() - startedAt;
          child.kill('SIGTERM');
          return;
        }
      } catch {
        // still booting
      }
      if (!finished && performance.now() - startedAt < params.timeoutMs) {
        pollTimer = setTimeout(() => {
          void poll();
        }, 5);
      }
    };

    void poll();

    child.once('error', (err) => {
      output += `\n${err.message}\n`;
    });
    child.once('close', (exitCode, signal) => {
      finished = true;
      clearTimeout(timeout);
      clearTimeout(pollTimer);
      rmSync(tempRoot, { recursive: true, force: true });
      resolve({
        durationMs: performance.now() - startedAt,
        readyMs,
        httpListeningMs,
        maxRssMb: null,
        exitCode,
        signal,
        outputTail: tail(output),
        startupTrace: parseStartupTrace(output),
      });
    });
  });
}

function summarize(samples: GatewayBenchSample[], readyBudgetMs: number, rssBudgetMb: number): GatewayBenchSummary {
  const readyValues = samples
    .map((sample) => sample.readyMs)
    .filter((value): value is number => value !== null)
    .toSorted((a, b) => a - b);
  const rssValues = samples
    .map((sample) => sample.maxRssMb)
    .filter((value): value is number => value !== null);

  const avgReadyMs =
    readyValues.length > 0
      ? Math.round(readyValues.reduce((sum, value) => sum + value, 0) / readyValues.length)
      : null;
  const p95Ready =
    readyValues.length > 0
      ? readyValues[Math.ceil(readyValues.length * 0.95) - 1]!
      : null;
  const p95ReadyMs = p95Ready === null ? null : Math.round(p95Ready);
  const p50ReadyMs = readyValues.length > 0
    ? Math.round(readyValues[Math.ceil(readyValues.length / 2) - 1]!)
    : null;
  const maxReadyMs = readyValues.length > 0 ? Math.round(readyValues.at(-1)!) : null;
  const avgMaxRssMb =
    rssValues.length > 0
      ? Math.round((rssValues.reduce((sum, value) => sum + value, 0) / rssValues.length) * 10) / 10
      : null;

  const passedBudget =
    p95Ready !== null &&
    readyValues.length === samples.length &&
    p95Ready <= readyBudgetMs &&
    (avgMaxRssMb === null || avgMaxRssMb <= rssBudgetMb);

  return { avgReadyMs, p50ReadyMs, p95ReadyMs, maxReadyMs, avgMaxRssMb, passedBudget };
}

async function main(): Promise<void> {
  if (hasFlag('--help')) {
    console.log(
      [
        'Usage: node --import tsx scripts/bench-gateway-startup.ts [options]',
        '',
        'Options:',
        '  --entry <path>            CLI entry (default: dist/src/cli/bin.js)',
        '  --executable <path>       Runtime executable (defaults to current Node.js)',
        '  --runs <n>                Measured runs (default: 3)',
        '  --warmup <n>              Warmup runs (default: 1)',
        '  --fresh-compile-cache    Use an empty V8 compile cache for every sample',
        '  --with-channels          Run normal channel initialization',
        '  --timeout-ms <ms>         Per-run timeout (default: 45000)',
        '  --ready-budget-ms <ms>    Fail if p95 ready exceeds this (default: 15000)',
        '  --rss-budget-mb <mb>      Fail if avg RSS exceeds this (default: 512)',
        '  --output <path>           Write JSON report',
        '  --json                    Print JSON report to stdout',
      ].join('\n'),
    );
    return;
  }

  const entry = parseFlagValue('--entry') ?? DEFAULT_ENTRY;
  const executable = parseFlagValue('--executable') ?? process.execPath;
  const runs = parsePositiveInt(parseFlagValue('--runs'), DEFAULT_RUNS);
  const warmupFlag = parseFlagValue('--warmup');
  const warmup = warmupFlag === '0' ? 0 : parsePositiveInt(warmupFlag, DEFAULT_WARMUP);
  const freshCompileCache = hasFlag('--fresh-compile-cache');
  const skipChannels = !hasFlag('--with-channels');
  const timeoutMs = parsePositiveInt(parseFlagValue('--timeout-ms'), DEFAULT_TIMEOUT_MS);
  const readyBudgetMs = parsePositiveInt(parseFlagValue('--ready-budget-ms'), DEFAULT_READY_BUDGET_MS);
  const rssBudgetMb = parsePositiveInt(parseFlagValue('--rss-budget-mb'), DEFAULT_RSS_BUDGET_MB);
  const output = parseFlagValue('--output');
  const json = hasFlag('--json');
  const port = await reservePort();

  const samples: GatewayBenchSample[] = [];
  const compileCacheDir = mkdtempSync(join(tmpdir(), 'xopc-gateway-bench-cache-'));
  try {
    for (let index = 0; index < warmup + runs; index += 1) {
      const sample = await runOnce({
        entry,
        executable,
        port: port + index + 1,
        timeoutMs,
        compileCacheDir: freshCompileCache ? join(compileCacheDir, String(index)) : compileCacheDir,
        skipChannels,
      });
      if (index >= warmup) samples.push(sample);
    }
  } finally {
    rmSync(compileCacheDir, { recursive: true, force: true });
  }

  const result: GatewayBenchResult = {
    entry,
    executable,
    warmup,
    freshCompileCache,
    skipChannels,
    port,
    samples,
    summary: summarize(samples, readyBudgetMs, rssBudgetMb),
  };

  if (output) {
    mkdirSync(join(output, '..'), { recursive: true });
    writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  }

  if (json || !output) {
    console.log(JSON.stringify(result, null, 2));
  }

  if (!result.summary.passedBudget) {
    console.error(
      `Gateway startup bench failed: p95ReadyMs=${result.summary.p95ReadyMs ?? 'n/a'} budget=${readyBudgetMs}, avgMaxRssMb=${result.summary.avgMaxRssMb ?? 'n/a'} budget=${rssBudgetMb}`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
