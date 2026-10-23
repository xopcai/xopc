import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, closeSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createFixture } from '../suites/coding-core/create-fixture.mjs';

const repository = fileURLToPath(new URL('../../../', import.meta.url));

export function settingsFromEnv(env, options = {}) {
  const model = env.CODER_EVAL_MODEL?.trim();
  if (!model || !/^[a-z][a-z0-9-]*\/[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(model)) {
    throw new Error('CODER_EVAL_MODEL must be a registered provider/model reference.');
  }
  const provider = model.split('/')[0];
  if (['openai-codex', 'github-copilot', 'google-gemini-cli', 'google-antigravity', 'amazon-bedrock', 'google-vertex', 'azure-openai-responses'].includes(provider)) {
    throw new Error('This workflow supports single API-key providers, not OAuth or cloud credential bundles.');
  }
  const reasoning = env.CODER_EVAL_REASONING || 'high';
  if (!(options.benchmark ? ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] : ['off', 'low', 'medium', 'high']).includes(reasoning)) throw new Error('Invalid reasoning level.');
  const repetitions = Number(env.CODER_EVAL_REPETITIONS || '1');
  if (![1, 2, 3].includes(repetitions)) throw new Error('Repetitions must be 1, 2 or 3.');
  const apiKey = env.CODER_EVAL_API_KEY?.trim();
  if (!apiKey || /[\r\n]/.test(apiKey)) throw new Error('Set the CODER_EVAL_API_KEY repository secret to a single API key.');
  return { model, provider, reasoning, repetitions, apiKey };
}

export function gatewayConfig(model, workspace, port, token) {
  return {
    gateway: {
      mode: 'local', bind: 'loopback', port,
      auth: { mode: 'token', token },
    },
    browser: { enabled: false },
    runtimeTools: { enabled: false },
    userContext: { enabled: false },
    channels: {},
    update: { checkOnStart: false },
  };
}

export function evalAgentCatalogSeed(model, workspace, maxTurns = 40) {
  return {
    defaultAgentId: 'coder',
    defaults: {
      models: { chat: { primary: model, fallbacks: [] }, intents: {} },
      skills: { mode: 'selected', include: [] },
      tools: {},
      runtime: { maxTurns, timeoutMs: 300_000 },
    },
    agent: { id: 'coder', enabled: true, workspace },
  };
}

export async function prepareEvalAgentCatalog(state, model, workspace, maxTurns = 40) {
  const [{ AgentCatalogRepository }, { closeXopcDatabase, openXopcDatabase }] = await Promise.all([
    import('../../../src/agent-catalog/repository.ts'),
    import('../../../src/storage/sqlite/connection.ts'),
  ]);
  const seed = evalAgentCatalogSeed(model, workspace, maxTurns);
  openXopcDatabase({ path: join(state, 'xopc.db') });
  try {
    const repository = new AgentCatalogRepository();
    repository.ensureInitialized(seed.defaults);
    repository.markProvisioned('main');
    repository.create(seed.agent, { ready: true });
    repository.setDefault(seed.defaultAgentId, repository.getSettings().revision);
  } finally {
    closeXopcDatabase();
  }
}

export async function waitForGateway(baseUrl, token, child, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Gateway exited before readiness. See gateway.log.');
    try {
      const response = await fetch(`${baseUrl}/api/health`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2000),
      });
      if (response.ok && (await response.json()).ready === true) {
        const identity = await fetch(`${baseUrl}/api/eval/runtime-identity?agentId=coder`, {
          headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2000),
        });
        if (identity.ok) return;
      }
    } catch { /* Startup may not have bound its port yet. */ }
    await delay(500);
  }
  throw new Error('Gateway readiness timed out. See gateway.log.');
}

export function scrub(text, secrets) {
  for (const secret of secrets.filter(Boolean)) {
    for (const value of [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)]) {
      text = text.replaceAll(value, '[REDACTED]');
    }
  }
  return text;
}

export function assertSafeArtifacts(directory, secrets) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error('Refusing to upload an artifact symlink.');
    if (stat.isDirectory()) assertSafeArtifacts(path, secrets);
    else {
      const bytes = readFileSync(path);
      for (const secret of secrets.filter(Boolean)) {
        const values = [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)];
        if (values.some(value => bytes.includes(Buffer.from(value)))) {
          throw new Error('Credential detected in evaluation artifacts; upload disabled.');
        }
      }
    }
  }
}

async function freePort() {
  const server = createServer();
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const port = server.address().port;
  await new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
  return port;
}

function stopGateway(child, signal) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, signal); } catch { child.kill(signal); }
}

export async function main(options = {}) {
  const settings = settingsFromEnv(process.env, { benchmark: options.benchmark === true });
  const state = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'xopc-live-eval-'));
  const output = resolve(options.outputDirectory ?? 'coder-eval-results');
  mkdirSync(output); // Never mix credentials or results with a previous run.
  const token = randomBytes(32).toString('hex');
  const secrets = [settings.apiKey, token];
  if (process.env.GITHUB_ACTIONS) console.log(`::add-mask::${token}`);
  delete process.env.CODER_EVAL_API_KEY;
  const workspace = join(state, 'workspace');
  mkdirSync(workspace);
  const configPath = join(state, 'xopc.json');
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const rawLog = join(state, 'gateway.log');
  const logFd = openSync(rawLog, 'w', 0o600);
  let gateway;
  let store;
  let failed = false;
  let interrupted = false;
  const onSignal = () => { interrupted = true; failed = true; process.exitCode = 130; };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    const { ConfigSchema } = await import('../../../src/config/schema.ts');
    const config = ConfigSchema.parse(gatewayConfig(settings.model, workspace, port, token));
    writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
    await prepareEvalAgentCatalog(state, settings.model, workspace, options.maxTurns ?? 40);
    const sharedRoot = process.env.XOPC_STATE_DIR ?? join(homedir(), '.xopc');
    if (settings.provider === 'xopc-cloud' && existsSync(join(sharedRoot, 'cache/model-catalog'))) {
      cpSync(join(sharedRoot, 'cache/model-catalog'), join(state, 'cache/model-catalog'), { recursive: true });
    }
    const runtimeEnv = {
      ...process.env,
      XOPC_CONFIG: configPath, XOPC_CONFIG_PATH: configPath, XOPC_STATE_DIR: state,
      XOPC_WORKSPACE: workspace, XOPC_HOME: state, XOPC_SKIP_CHANNELS: '1',
      XOPC_NO_RESPAWN: '1', XOPC_LOG_LEVEL: 'info', XOPC_LOG_FILE: 'false',
      ...(settings.provider === 'xopc-cloud'
        ? { XOPC_CREDENTIALS_DIR: process.env.XOPC_CREDENTIALS_DIR ?? join(sharedRoot, 'credentials') }
        : { [`${settings.provider.toUpperCase().replaceAll('-', '_')}_API_KEY`]: settings.apiKey }),
    };
    let executable = process.execPath, prefix = [];
    if (options.sealGrader) {
      if (process.platform !== 'darwin') throw new Error('Sealed local grader requires the macOS OS sandbox; no permissive fallback');
      const relativeRoot = `evals/coder/suites/${options.benchmarkSuite}`;
      const originFile = join(repository, '.xopc-source-origin.json');
      const origin = existsSync(originFile) ? JSON.parse(readFileSync(originFile, 'utf8')).origin : repository;
      const roots = [...new Set([join(repository, relativeRoot), join(origin, relativeRoot)])];
      const profile = '(version 1)(allow default)' + roots.map(path => `(deny file-read* file-write* (subpath ${JSON.stringify(path)}))`).join('');
      const probe = 'try{require("node:fs").readFileSync(process.argv[1]);process.exit(2)}catch(e){if(!["EPERM","EACCES"].includes(e.code))throw e}';
      for (const root of roots) execFileSync('/usr/bin/sandbox-exec', ['-p', profile, process.execPath, '-e', probe, join(root,'hidden/check.mjs')]);
      writeFileSync(join(output, 'sealed-boundary.json'), JSON.stringify({ mechanism:'macOS sandbox-exec', deniedRoots:roots, readAndWriteDenied:true, denialProbePassed:true, appliesToGatewayAndDescendants:true },null,2));
      executable = '/usr/bin/sandbox-exec'; prefix = ['-p', profile, process.execPath];
    }
    gateway = spawn(executable, [...prefix, '--import', 'tsx', 'src/cli/bin.ts', 'gateway', '--port', String(port), '--bind', 'loopback', '--no-hot-reload'], {
      cwd: repository, env: runtimeEnv, detached: true, stdio: ['ignore', logFd, logFd],
    });
    gateway.on('error', () => { failed = true; });
    await waitForGateway(baseUrl, token, gateway);
    console.log('Gateway ready.');
    if (process.argv.includes('--preflight-only')) {
      writeFileSync(join(output, 'summary.md'), 'Preflight passed: authenticated Gateway startup only; no model requests or coding score.\n');
      return;
    }

    if (options.benchmark) {
      const benchmarkOutput = join(output, 'benchmark');
      try {
        execFileSync(process.execPath, ['--import', 'tsx', 'evals/coder/apps/cli/src/benchmark.ts',
          '--suite', options.benchmarkSuite ?? 'xopc-core',
          '--mode', 'live', '--base-url', baseUrl, '--model', settings.model,
          '--reasoning', settings.reasoning, '--repetitions', String(settings.repetitions),
          ...(options.benchmarkCases ? ['--cases', options.benchmarkCases] : []),
          '--output', benchmarkOutput], {
          cwd: repository, stdio: 'inherit', timeout: 120 * 60_000,
          env: { ...process.env, XOPC_EVAL_TOKEN: token },
        });
      } catch { failed = true; }
      const summaryPath = join(benchmarkOutput, 'summary.md');
      if (existsSync(summaryPath)) writeFileSync(join(output, 'summary.md'), readFileSync(summaryPath));
      return;
    }

    const { EvalRunner, loadSuite } = await import('@agent-evals/runner');
    const { ArtifactStore, EvalStore } = await import('@agent-evals/storage');
    const { XopcGatewayAdapter } = await import('@agent-evals/adapter-xopc');
    const fixture = createFixture(state);
    execFileSync('git', ['bundle', 'create', join(output, 'fixture.bundle'), '--all'], { cwd: fixture.repo });
    process.env.EVAL_FIXTURE_REPO = fixture.repo;
    process.env.EVAL_FIXTURE_COMMIT = fixture.commit;
    process.env.XOPC_EVAL_TOKEN = token;
    const suite = await loadSuite(join(repository, 'evals/coder/suites/coding-core/suite.yaml'));
    const spec = {
      name: 'GitHub coding-core live evaluation', repetitions: settings.repetitions,
      randomSeed: 'coding-core-v1',
      variants: [{ id: 'candidate', adapter: 'xopc', agentId: 'coder', model: settings.model,
        reasoning: settings.reasoning, config: { baseUrl, cleanupSession: true } }],
    };
    const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim();
    writeFileSync(join(output, 'manifest.json'), JSON.stringify({ sourceCommit, fixture, suiteHash: suite.contentHash, spec }, null, 2));
    store = new EvalStore(join(output, 'evals.db'));
    const adapter = new XopcGatewayAdapter();
    const originalRun = adapter.run.bind(adapter);
    adapter.run = async (...args) => {
      console.log(`Running ${args[0].evalCase.id} (${args[0].variant.id})`);
      return originalRun(...args);
    };
    const runner = new EvalRunner({ store, artifactStore: new ArtifactStore(join(output, 'artifacts')), adapters: [adapter] });
    const result = await runner.runExperiment(suite, spec);
    const detail = store.getExperiment(result.experimentId);
    writeFileSync(join(output, 'results.json'), JSON.stringify(detail, null, 2));
    const passed = result.runs.filter(run => run.status === 'passed').length;
    failed = result.runs.some(run => run.status !== 'passed');
    const lines = [
      '# Coding core live evaluation', '',
      `Model: ${settings.model}; reasoning: ${settings.reasoning}; source: ${sourceCommit}`, '',
      `Passed: **${passed}/${result.runs.length}**. Experiment: ${result.experimentId}`, '',
      '| Task | Variant | Status | Score | Run |', '| --- | --- | --- | --- | --- |',
      ...detail.runs.map(run => `| ${run.case_id} | ${run.variant_id} | ${run.status} | ${Number(run.score).toFixed(2)} | ${run.id} |`),
      '', 'Small repair regression suite; this is not a production success rate or a Codex/Claude Code comparison.', '',
    ];
    writeFileSync(join(output, 'summary.md'), lines.join('\n'));
    console.log(`Passed ${passed}/${result.runs.length}; experiment ${result.experimentId}.`);
  } catch (error) {
    failed = true;
    const message = scrub(error instanceof Error ? error.message : String(error), secrets);
    console.error(message);
    writeFileSync(join(output, 'error.txt'), message);
  } finally {
    store?.close();
    // Let bounded auxiliary calls finish so their usage is part of the same evidence bundle.
    const drainDeadline = Date.now() + (interrupted ? 1500 : 60_000);
    let idleSince = null;
    let drainComplete = false;
    while (gateway?.exitCode === null && Date.now() < drainDeadline) {
      let usage;
      try {
        usage = new DatabaseSync(join(state, 'xopc.db'), { readOnly: true });
        const pending = Number(usage.prepare("SELECT COUNT(*) AS n FROM ai_usage_events WHERE status='running'").get().n);
        const journal = process.env.XOPC_EVAL_AUDIT_PATH;
        const events = journal && existsSync(journal) ? readFileSync(journal, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
        const started = events.filter(e => e.event === 'start'), ended = new Set(events.filter(e => e.event === 'end').map(e => e.requestId));
        const tails = started.filter(e => !ended.has(e.requestId)).length;
        if (!pending && !tails) {
          idleSince ??= Date.now();
          if (Date.now() - idleSince >= 750) { drainComplete = true; break; }
        } else idleSince = null;
      } catch { break; }
      finally { usage?.close(); }
      await delay(200);
    }
    stopGateway(gateway, 'SIGTERM');
    if (gateway?.exitCode === null && gateway.signalCode === null) {
      await Promise.race([new Promise(done => gateway.once('exit', done)), delay(5000)]);
    }
    stopGateway(gateway, 'SIGKILL');
    if (existsSync(join(state, 'xopc.db'))) {
    const usageDb = new DatabaseSync(join(state, 'xopc.db'), { readOnly: true });
    try {
      const rows = usageDb.prepare('SELECT id,provider,model,operation,status,started_at,finished_at,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,total_tokens,cloud_request_id,cloud_billing_json FROM ai_usage_events ORDER BY started_at,id').all();
      writeFileSync(join(output, 'runtime-usage.json'), JSON.stringify({ mode: 'post-gateway-stop', drainComplete, interrupted, finalSnapshotGuaranteed: gateway?.exitCode !== null || gateway?.signalCode !== null, rows }, null, 2));
    } finally { usageDb.close(); }
    }
    closeSync(logFd);
    writeFileSync(join(output, 'gateway.log'), scrub(readFileSync(rawLog, 'utf8'), secrets));
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    delete process.env.XOPC_EVAL_TOKEN;
    try {
      assertSafeArtifacts(output, secrets);
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'artifacts_safe=true\n');
      if (process.env.GITHUB_STEP_SUMMARY && existsSync(join(output, 'summary.md'))) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, readFileSync(join(output, 'summary.md')));
      }
    } finally {
      rmSync(state, { recursive: true, force: true });
    }
    if (failed) process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
