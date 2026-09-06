import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { XopcGatewayAdapter } from '@agent-evals/adapter-xopc';
import { expect, it } from 'vitest';

import { gatewayConfig, waitForGateway } from '../scripts/run-github-eval.mjs';

it('runs the evaluator through the real Gateway with a local scripted model service', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gateway-adapter-contract-'));
  const repo = fileURLToPath(new URL('../../../', import.meta.url));
  let modelRequests = 0;
  let sawToolResult = false;
  const provider = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    if (req.url !== '/v1/chat/completions') { res.writeHead(404); res.end(); return; }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    sawToolResult ||= body.messages.some(message => message.role === 'tool' && JSON.stringify(message.content).includes('fixture-content'));
    const isAgentRequest = body.tools?.some(tool => tool.function?.name === 'read_file') === true;
    if (isAgentRequest) modelRequests++;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const chunk = (delta, finish_reason = null, usage) => `data: ${JSON.stringify({ id: 'smoke', object: 'chat.completion.chunk', created: 1, model: 'smoke', choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}) })}\n\n`;
    if (isAgentRequest && modelRequests === 1) {
      res.write(chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_read_fixture', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: join(workspace, 'probe.txt') }) } }] }));
      res.write(chunk({}, 'tool_calls', { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }));
    } else {
      res.write(chunk({ role: 'assistant', content: 'Gateway smoke passed.' }));
      res.write(chunk({}, 'stop', { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }));
    }
    res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  const portProbe = createServer();
  await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
  const port = portProbe.address().port;
  await new Promise(resolve => portProbe.close(resolve));
  const workspace = join(root, 'workspace');
  mkdirSync(workspace);
  writeFileSync(join(workspace, 'probe.txt'), 'fixture-content');
  const configPath = join(root, 'xopc.json');
  const modelsPath = join(root, 'models.json');
  const model = 'eval-fixture/smoke';
  const token = 'gateway-integration-token';
  writeFileSync(configPath, JSON.stringify(gatewayConfig(model, workspace, port, token)));
  writeFileSync(modelsPath, JSON.stringify({ providers: { 'eval-fixture': {
    baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, apiKey: 'test-only-key', api: 'openai-completions',
    models: [{ id: 'smoke', name: 'Smoke', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
  } } }));
  let logs = '';
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli/bin.ts', 'gateway', '--port', String(port), '--bind', 'loopback', '--no-hot-reload'], {
    cwd: repo, env: { ...process.env, XOPC_CONFIG: configPath, XOPC_CONFIG_PATH: configPath,
      XOPC_STATE_DIR: root, XOPC_HOME: root, XOPC_WORKSPACE: workspace, XOPC_MODELS_JSON: modelsPath,
      XOPC_SKIP_CHANNELS: '1', XOPC_NO_RESPAWN: '1', XOPC_LOG_FILE: 'false', XOPC_LOG_LEVEL: 'error' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', data => { logs = (logs + data).slice(-12000); });
  child.stderr.on('data', data => { logs = (logs + data).slice(-12000); });
  const adapter = new XopcGatewayAdapter();
  const events = [];
  try {
    await waitForGateway(`http://127.0.0.1:${port}`, token, child, 45000);
    const result = await adapter.run({
      runId: 'gateway-smoke', experimentId: 'contract',
      evalCase: { id: 'contract', repo: { source: 'local', path: workspace, commit: 'HEAD' }, task: 'Reply with Gateway smoke passed.', budget: { timeoutMs: 20000 }, graders: [], tags: [] },
      variant: { id: 'smoke', adapter: 'xopc', agentId: 'coder', model, reasoning: 'off', config: { baseUrl: `http://127.0.0.1:${port}`, token } },
      environment: { workspace, sourceCommit: 'head', fixtureCommit: 'fixture', metadata: {} },
    }, event => { events.push(event); }, AbortSignal.timeout(20000));
    expect(result, logs).toMatchObject({ status: 'completed', finalText: 'Gateway smoke passed.' });
    expect(result.usage).toMatchObject({ input: 20, output: 8, total: 28 });
    expect(modelRequests).toBe(2);
    expect(sawToolResult).toBe(true);
    expect(events.some(event => event.type === 'tool.started')).toBe(true);
    expect(events.some(event => event.type === 'model.request'), JSON.stringify(events.map(event => ({ type: event.type, rawType: event.payload.rawType, payload: event.payload.payload })))).toBe(true);
    expect(events.at(-1).type).toBe('run.completed');
  } catch (error) {
    throw new Error(`${error.message}\nGateway log:\n${logs}`, { cause: error });
  } finally {
    await adapter.cleanup('gateway-smoke');
    child.kill('SIGTERM');
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise(resolve => { const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000); child.once('exit', () => { clearTimeout(timer); resolve(); }); });
    }
    await new Promise(resolve => provider.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
}, 75000);
