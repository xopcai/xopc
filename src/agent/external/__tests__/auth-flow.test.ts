import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import {
  cancelExternalRuntimeAuthFlow,
  getExternalRuntimeAuthFlow,
  logoutExternalAgentRuntime,
  probeExternalAgentRuntime,
  respondExternalRuntimeAuthFlow,
  startExternalRuntimeAuth,
} from '../index.js';

function createFakeCodexBinary(dir: string, stateFile: string): string {
  const scriptPath = join(dir, 'fake-codex');
  const script = `#!${process.execPath}
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';

const stateFile = ${JSON.stringify(stateFile)};

if (process.argv.includes('--version')) {
  process.stdout.write('codex-cli 0.120.0\\n');
  process.exit(0);
}

const send = (frame) => process.stdout.write(JSON.stringify(frame) + '\\n');
const readState = () => (existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : null);
const writeState = (val) => writeFileSync(stateFile, JSON.stringify(val), 'utf8');

let callbackServer;
const rl = createInterface({ input: process.stdin });

rl.on('line', (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') {
    send({ id: msg.id, result: { userAgent: 'fake-codex/0.120.0' } });
    return;
  }
  if (msg.method === 'account/read') {
    const saved = readState();
    send({ id: msg.id, result: { account: saved, requiresOpenaiAuth: true } });
    return;
  }
  if (msg.method === 'model/list') {
    const saved = readState();
    if (!saved) {
      send({ id: msg.id, error: { code: -32000, message: 'Unauthorized: login required' } });
      return;
    }
    send({ id: msg.id, result: { data: [{ model: 'gpt-5.3-codex', displayName: 'GPT-5.3 Codex', isDefault: true }] } });
    return;
  }
  if (msg.method === 'account/rateLimits/read') {
    send({
      id: msg.id,
      result: {
        rateLimits: {
          planType: 'pro',
          primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 3600 },
        },
      },
    });
    return;
  }
  if (msg.method === 'skills/list') {
    send({
      id: msg.id,
      result: {
        data: [{ skills: [{ name: 'review', description: 'Review current changes', enabled: true }] }],
      },
    });
    return;
  }
  if (msg.method === 'account/logout') {
    if (existsSync(stateFile)) rmSync(stateFile);
    send({ id: msg.id, result: {} });
    return;
  }
  if (msg.method === 'account/login/cancel') {
    callbackServer?.close();
    send({ id: msg.id, result: { status: 'canceled' } });
    return;
  }
  if (msg.method === 'account/login/start') {
    const type = msg.params?.type;
    if (type === 'apiKey') {
      writeState({ type: 'apiKey' });
      send({ id: msg.id, result: { type: 'apiKey' } });
      return;
    }
    if (type === 'chatgptDeviceCode') {
      send({
        id: msg.id,
        result: {
          type: 'chatgptDeviceCode',
          loginId: 'dev-1',
          verificationUrl: 'https://auth.openai.com/codex/device',
          userCode: 'ABCD-1234',
        },
      });
      return;
    }
    if (type === 'chatgpt') {
      callbackServer = createServer((req, res) => {
        const parsed = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (parsed.pathname === '/auth/callback' && parsed.searchParams.get('code') === 'good-code') {
          writeState({ type: 'chatgpt', email: 'dev@example.com', planType: 'pro' });
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('ok');
          callbackServer.close();
          send({
            method: 'account/login/completed',
            params: { loginId: 'login-1', success: true, error: null },
          });
          return;
        }
        res.writeHead(400);
        res.end('bad');
      });
      callbackServer.listen(0, '127.0.0.1', () => {
        const addr = callbackServer.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        const redirect = encodeURIComponent(\`http://127.0.0.1:\${port}/auth/callback\`);
        send({
          id: msg.id,
          result: {
            type: 'chatgpt',
            loginId: 'login-1',
            authUrl: \`https://auth.openai.com/oauth/authorize?state=codex-state-1&redirect_uri=\${redirect}&response_type=code\`,
          },
        });
      });
    }
  }
});
`;
  writeFileSync(scriptPath, script, 'utf8');
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function createFakeAgyLoginBinary(dir: string, tokenFile: string): string {
  const scriptPath = join(dir, 'fake-agy');
  const script = `#!${process.execPath}
import { existsSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const tokenFile = ${JSON.stringify(tokenFile)};
const rl = createInterface({ input: process.stdin });

if (process.argv.includes('--login')) {
  process.stdout.write('Open the following link:\\n');
  process.stdout.write('https://accounts.google.com/o/oauth2/auth?response_type=code&state=agy-state-99&redirect_uri=https%3A%2F%2Fantigravity.google%2Foauth-callback\\n');
  rl.once('line', (line) => {
    const code = line.trim();
    if (code === 'valid-agy-code' || code.includes('code=valid-agy-code')) {
      writeFileSync(tokenFile, 'signed-in', 'utf8');
      process.exit(0);
    }
    process.stderr.write('Invalid authorization code\\n');
    process.exit(1);
  });
} else {
  const send = (frame) => process.stdout.write(JSON.stringify(frame) + '\\n');
  rl.on('line', (line) => {
    if (!line.trim()) return;
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: 1,
          agentInfo: { name: 'antigravity', version: '1.5.12' },
          agentCapabilities: {},
        },
      });
      return;
    }
    if (msg.method === 'session/new') {
      if (!existsSync(tokenFile)) {
        send({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'Sign in required' } });
        return;
      }
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          sessionId: 'agy-s1',
          configOptions: [{
            id: 'model',
            type: 'select',
            currentValue: 'gemini-3-pro',
            options: [{ value: 'gemini-3-pro', name: 'Gemini 3 Pro' }],
          }],
        },
      });
    }
  });
}
`;
  writeFileSync(scriptPath, script, 'utf8');
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

async function waitForTerminalPhase(flowId: string, timeoutMs = 6_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const flow = getExternalRuntimeAuthFlow(flowId);
    if (!flow) throw new Error('Flow disappeared');
    if (flow.phase === 'succeeded' || flow.phase === 'failed' || flow.phase === 'cancelled') return flow;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error('Timed out waiting for auth flow completion');
}

let tempDir: string | undefined;
afterEach(() => {
  if (tempDir) rmSync(tempDir, { force: true, recursive: true });
  tempDir = undefined;
});

it('completes Codex ChatGPT OAuth flow with callback forwarding, probes account & models, and supports logout', async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'xopc-codex-auth-'));
  const bin = createFakeCodexBinary(tempDir, join(tempDir, 'state.json'));

  const initialProbe = await probeExternalAgentRuntime({ kind: 'codex', binaryPath: bin });
  expect(initialProbe.status).toBe('unauthenticated');

  const started = await startExternalRuntimeAuth({
    execution: { kind: 'codex', binaryPath: bin },
    mode: 'browser',
  });
  expect(started.phase).toBe('waiting');
  expect(started.authorizationUrl).toContain('https://auth.openai.com/oauth/authorize');
  expect(started.inputKind).toBe('callback_url');

  const redirectUri = new URL(started.authorizationUrl!).searchParams.get('redirect_uri')!;
  await expect(
    respondExternalRuntimeAuthFlow(started.flowId, `${redirectUri}?code=good-code&state=wrong-state`),
  ).rejects.toThrow('state parameter does not match');

  await respondExternalRuntimeAuthFlow(started.flowId, `${redirectUri}?code=good-code&state=codex-state-1`);
  const done = await waitForTerminalPhase(started.flowId);
  expect(done.phase).toBe('succeeded');
  expect(done.probe?.status).toBe('ready');
  expect(done.probe?.account).toEqual({ label: 'dev@example.com', authMode: 'pro' });
  expect(done.probe?.models).toEqual([{ id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', isDefault: true }]);

  const afterLogout = await logoutExternalAgentRuntime({ kind: 'codex', binaryPath: bin });
  expect(afterLogout.status).toBe('unauthenticated');
});

it('supports Codex device code, cancellation, and API key login', async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'xopc-codex-auth-modes-'));
  const bin = createFakeCodexBinary(tempDir, join(tempDir, 'state.json'));

  const device = await startExternalRuntimeAuth({
    execution: { kind: 'codex', binaryPath: bin },
    mode: 'device_code',
  });
  expect(device.phase).toBe('waiting');
  expect(device.userCode).toBe('ABCD-1234');
  expect(device.authorizationUrl).toBe('https://auth.openai.com/codex/device');
  const cancelled = await cancelExternalRuntimeAuthFlow(device.flowId);
  expect(cancelled?.phase).toBe('cancelled');

  const apiKeyFlow = await startExternalRuntimeAuth({
    execution: { kind: 'codex', binaryPath: bin },
    mode: 'api_key',
    apiKey: 'sk-test-123',
  });
  expect(apiKeyFlow.phase).toBe('succeeded');
  expect(apiKeyFlow.probe?.status).toBe('ready');
  expect(apiKeyFlow.probe?.account?.label).toBe('OpenAI API key');
});

it('completes Antigravity (AGY) OAuth code flow via agy acp --login and auto-probes models', async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'xopc-agy-auth-flow-'));
  const bin = createFakeAgyLoginBinary(tempDir, join(tempDir, 'token.txt'));

  const before = await probeExternalAgentRuntime({ kind: 'agy', binaryPath: bin });
  expect(before.status).toBe('unauthenticated');

  const started = await startExternalRuntimeAuth({
    execution: { kind: 'agy', binaryPath: bin },
    mode: 'browser',
  });
  expect(started.phase).toBe('waiting');
  expect(started.authorizationUrl).toContain('https://accounts.google.com/o/oauth2/auth');
  expect(started.inputKind).toBe('code_or_url');

  await expect(
    respondExternalRuntimeAuthFlow(
      started.flowId,
      'https://antigravity.google/oauth-callback?code=valid-agy-code&state=wrong-state',
    ),
  ).rejects.toThrow('does not belong');

  await respondExternalRuntimeAuthFlow(started.flowId, 'valid-agy-code');
  const done = await waitForTerminalPhase(started.flowId);
  expect(done.phase).toBe('succeeded');
  expect(done.probe?.status).toBe('ready');
  expect(done.probe?.models).toEqual([{ id: 'gemini-3-pro', label: 'Gemini 3 Pro', isDefault: true }]);
});
