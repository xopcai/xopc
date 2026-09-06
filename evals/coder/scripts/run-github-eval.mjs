import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createFixture } from '../suites/coding-core/create-fixture.mjs';

const repository = fileURLToPath(new URL('../../../', import.meta.url));

export function settingsFromEnv(env) {
  const model = env.CODER_EVAL_MODEL?.trim();
  if (!model || !/^[a-z][a-z0-9-]*\/[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(model)) {
    throw new Error('CODER_EVAL_MODEL must be a registered provider/model reference.');
  }
  const provider = model.split('/')[0];
  if (['openai-codex', 'github-copilot', 'google-gemini-cli', 'google-antigravity', 'amazon-bedrock', 'google-vertex', 'azure-openai-responses'].includes(provider)) {
    throw new Error('This workflow supports single API-key providers, not OAuth or cloud credential bundles.');
  }
  const reasoning = env.CODER_EVAL_REASONING || 'high';
  if (!['off', 'low', 'medium', 'high'].includes(reasoning)) throw new Error('Invalid reasoning level.');
  const repetitions = Number(env.CODER_EVAL_REPETITIONS || '1');
  if (![1, 2, 3].includes(repetitions)) throw new Error('Repetitions must be 1, 2 or 3.');
  const apiKey = env.CODER_EVAL_API_KEY?.trim();
  if (!apiKey || /[\r\n]/.test(apiKey)) throw new Error('Set the CODER_EVAL_API_KEY repository secret to a single API key.');
  return { model, provider, reasoning, repetitions, apiKey };
}

export function gatewayConfig(model, workspace, port, token) {
  return {
    agents: {
      default: 'coder',
      defaults: {
        models: { chat: { primary: model, fallbacks: [] } },
        skills: { mode: 'selected', include: [] },
        runtime: { maxTurns: 40, timeoutMs: 300_000 },
      },
      list: [{ id: 'coder', enabled: true, workspace }],
    },
    gateway: {
      mode: 'local', bind: 'loopback', port,
      auth: { mode: 'token', token },
      heartbeat: { enabled: false, intervalMs: 1_800_000 },
    },
    browser: { enabled: false },
    runtimeTools: { enabled: false },
    userContext: { enabled: false, understanding: { enabled: false }, dreaming: { mode: 'off' } },
    channels: {},
    update: { checkOnStart: false },
  };
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

export async function main() {
  const settings = settingsFromEnv(process.env);
  const state = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'xopc-live-eval-'));
  const output = resolve('coder-eval-results');
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
  const onSignal = () => { stopGateway(gateway, 'SIGKILL'); process.exit(130); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    const { ConfigSchema } = await import('../../../src/config/schema.ts');
    const config = ConfigSchema.parse(gatewayConfig(settings.model, workspace, port, token));
    writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
    const runtimeEnv = {
      ...process.env,
      XOPC_CONFIG: configPath, XOPC_CONFIG_PATH: configPath, XOPC_STATE_DIR: state,
      XOPC_WORKSPACE: workspace, XOPC_HOME: state, XOPC_SKIP_CHANNELS: '1',
      XOPC_NO_RESPAWN: '1', XOPC_LOG_LEVEL: 'info', XOPC_LOG_FILE: 'false',
      [`${settings.provider.toUpperCase().replaceAll('-', '_')}_API_KEY`]: settings.apiKey,
    };
    gateway = spawn(process.execPath, ['--import', 'tsx', 'src/cli/bin.ts', 'gateway', '--port', String(port), '--bind', 'loopback', '--no-hot-reload'], {
      cwd: repository, env: runtimeEnv, detached: true, stdio: ['ignore', logFd, logFd],
    });
    gateway.on('error', () => { failed = true; });
    await waitForGateway(baseUrl, token, gateway);
    console.log('Gateway ready.');
    if (process.argv.includes('--preflight-only')) {
      writeFileSync(join(output, 'summary.md'), 'Preflight passed: authenticated Gateway startup only; no model requests or coding score.\n');
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
    stopGateway(gateway, 'SIGTERM');
    if (gateway?.exitCode === null && gateway.signalCode === null) {
      await Promise.race([new Promise(done => gateway.once('exit', done)), delay(5000)]);
    }
    stopGateway(gateway, 'SIGKILL');
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
