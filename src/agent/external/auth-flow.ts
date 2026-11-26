import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';

import type { AgyExecution, ClaudeExecution, CodexExecution, ExternalAgentExecution } from '../../agent-config/schema.js';
import { spawnStdioProcess } from '../../process/run-process.js';
import { createLogger } from '../../utils/logger.js';
import { AcpJsonRpcClient } from './acp/json-rpc-client.js';
import { findAgyExecutable, resolveAgySpawnSpec } from './drivers/agy/driver.js';
import { buildClaudeEnv, findClaudeExecutable } from './drivers/claude/executable.js';
import { CodexAppServer, record, type CodexRecord } from './drivers/codex/app-server.js';
import { findCodexExecutable } from './drivers/codex/executable.js';
import { probeExternalAgentRuntime } from './registry.js';
import { closeRuntimeProcess } from './runtime-process.js';
import type {
  ExternalRuntimeAuthFlowSnapshot,
  ExternalRuntimeAuthMode,
  ExternalRuntimeProbeResult,
  StartExternalRuntimeAuthInput,
} from './types.js';

const log = createLogger('ExternalRuntimeAuth');

const AUTH_FLOW_TTL_MS = 5 * 60_000;
const COMPLETED_RETENTION_MS = 2 * 60_000;
const CALLBACK_FORWARD_TIMEOUT_MS = 10_000;
const ANTIGRAVITY_CODE_REDIRECT_URI = 'https://antigravity.google/oauth-callback';
const GOOGLE_URL_PATTERN = /https:\/\/accounts\.google\.com\/[^\s"'<>]+/;

interface PendingOAuthRedirect {
  redirectUri: string;
  state: string;
}

interface ActiveAuthFlow {
  snapshot: ExternalRuntimeAuthFlowSnapshot;
  expiresAtMs: number;
  timer: NodeJS.Timeout;
  pendingRedirect?: PendingOAuthRedirect;
  respond?: (value: string) => Promise<void>;
  cleanup?: () => Promise<void>;
}

const activeFlows = new Map<string, ActiveAuthFlow>();

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost';
}

function extractLoopbackRedirect(authorizationUrl: string): PendingOAuthRedirect | undefined {
  let parsed: URL;
  try {
    parsed = new URL(authorizationUrl);
  } catch {
    return undefined;
  }
  const redirectUri = parsed.searchParams.get('redirect_uri');
  const state = parsed.searchParams.get('state');
  if (!redirectUri || !state) return undefined;
  try {
    const redirect = new URL(redirectUri);
    if (redirect.protocol !== 'http:' || !isLoopbackHost(redirect.hostname)) return undefined;
    const port = Number(redirect.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) return undefined;
    return { redirectUri, state };
  } catch {
    return undefined;
  }
}

function extractGoogleCodeRedirect(authorizationUrl: string): PendingOAuthRedirect | undefined {
  let parsed: URL;
  try {
    parsed = new URL(authorizationUrl);
  } catch {
    return undefined;
  }
  const redirectUri = parsed.searchParams.get('redirect_uri');
  const state = parsed.searchParams.get('state');
  if (redirectUri !== ANTIGRAVITY_CODE_REDIRECT_URI || !state) return undefined;
  return { redirectUri, state };
}

function validateAndNormalizeCallbackUrl(pending: PendingOAuthRedirect, rawInput: string): URL {
  const trimmed = rawInput.trim();
  if (!trimmed || trimmed.length > 16_384) {
    throw new Error('Paste the complete redirect URL from the sign-in page.');
  }
  let callback: URL;
  try {
    callback = new URL(trimmed);
  } catch {
    throw new Error('Invalid redirect URL. Paste the full URL from your browser address bar.');
  }
  const expected = new URL(pending.redirectUri);
  if (
    callback.protocol !== 'http:'
    || !isLoopbackHost(callback.hostname)
    || callback.port !== expected.port
    || callback.pathname !== expected.pathname
    || callback.username !== ''
    || callback.password !== ''
  ) {
    throw new Error('This redirect URL does not match the active sign-in session.');
  }
  const states = callback.searchParams.getAll('state');
  if (states.length !== 1 || states[0] !== pending.state) {
    throw new Error('The OAuth state parameter does not match the active sign-in session.');
  }
  const codes = callback.searchParams.getAll('code');
  const errors = callback.searchParams.getAll('error');
  const validCode = codes.length === 1 && Boolean(codes[0]) && errors.length === 0;
  const validError = errors.length === 1 && Boolean(errors[0]) && codes.length === 0;
  if (!validCode && !validError) {
    throw new Error('The redirect URL must contain a valid OAuth response.');
  }
  // Always target 127.0.0.1 locally regardless of whether redirect_uri said localhost.
  callback.hostname = expected.hostname;
  return callback;
}

function validateAntigravityCodeResponse(pending: PendingOAuthRedirect | undefined, rawInput: string): string {
  const value = rawInput.trim();
  if (!value || value.length > 16_384 || /[\r\n]/.test(value)) {
    throw new Error('Paste the authorization code or callback URL shown on the Antigravity page.');
  }
  if (/^[\w./~=-]{1,2048}$/.test(value)) return value;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Invalid authorization code or callback URL.');
  }
  if (
    pending
    && (
      `${parsed.origin}${parsed.pathname}` !== pending.redirectUri
      || parsed.searchParams.get('state') !== pending.state
      || !parsed.searchParams.get('code')
    )
  ) {
    throw new Error('This callback URL does not belong to the active Antigravity sign-in session.');
  }
  return value;
}

function forwardLoopbackCallback(callback: URL): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };
    const req = httpRequest(
      {
        protocol: 'http:',
        hostname: callback.hostname,
        port: callback.port,
        path: `${callback.pathname}${callback.search}`,
        method: 'GET',
        agent: false,
      },
      (res) => {
        res.once('error', () => finish(new Error('Could not deliver the sign-in callback locally.')));
        res.once('end', () => {
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 400) finish();
          else finish(new Error(`Local callback listener returned HTTP ${status}.`));
        });
        res.resume();
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      finish(new Error('Timed out delivering the sign-in callback locally.'));
    }, CALLBACK_FORWARD_TIMEOUT_MS);
    req.once('error', () => finish(new Error('Could not reach the local sign-in callback listener.')));
    req.end();
  });
}

function scheduleCleanup(flow: ActiveAuthFlow, delayMs: number): void {
  clearTimeout(flow.timer);
  flow.timer = setTimeout(() => {
    const current = activeFlows.get(flow.snapshot.flowId);
    if (current !== flow) return;
    if (current.snapshot.phase === 'starting' || current.snapshot.phase === 'waiting' || current.snapshot.phase === 'verifying') {
      current.snapshot = {
        ...current.snapshot,
        phase: 'failed',
        authorizationUrl: undefined,
        message: 'Sign-in timed out. Start sign-in again.',
      };
      void current.cleanup?.().catch(() => {});
      current.cleanup = undefined;
      current.respond = undefined;
      scheduleCleanup(current, COMPLETED_RETENTION_MS);
      return;
    }
    activeFlows.delete(flow.snapshot.flowId);
  }, delayMs);
  flow.timer.unref?.();
}

function isTerminal(phase: ExternalRuntimeAuthFlowSnapshot['phase']): boolean {
  return phase === 'succeeded' || phase === 'failed' || phase === 'cancelled';
}

async function finishFlow(
  flow: ActiveAuthFlow,
  patch: Partial<ExternalRuntimeAuthFlowSnapshot>,
): Promise<void> {
  if (isTerminal(flow.snapshot.phase)) return;
  flow.snapshot = {
    ...flow.snapshot,
    ...patch,
    authorizationUrl: undefined,
    inputKind: undefined,
  };
  const cleanup = flow.cleanup;
  flow.cleanup = undefined;
  flow.respond = undefined;
  await cleanup?.().catch(() => {});
  scheduleCleanup(flow, COMPLETED_RETENTION_MS);
}

async function startCodexAuthFlow(
  flow: ActiveAuthFlow,
  execution: CodexExecution,
  mode: ExternalRuntimeAuthMode,
  apiKey?: string,
): Promise<ExternalRuntimeAuthFlowSnapshot> {
  const executablePath = findCodexExecutable(execution.binaryPath);
  if (!executablePath) {
    await finishFlow(flow, {
      phase: 'failed',
      message: execution.binaryPath
        ? `Codex binary was not found at "${execution.binaryPath}".`
        : 'Codex CLI was not found in PATH on the Gateway host.',
    });
    return { ...flow.snapshot };
  }

  let activeLoginId: string | undefined;
  let server: CodexAppServer | undefined;

  const completeCodexSignIn = async (success: boolean, errorMessage?: string | null) => {
    if (isTerminal(flow.snapshot.phase)) return;
    if (!success) {
      await finishFlow(flow, {
        phase: 'failed',
        message: errorMessage?.trim() || 'Codex sign-in did not complete. Try again.',
      });
      return;
    }
    flow.snapshot = {
      ...flow.snapshot,
      phase: 'verifying',
      authorizationUrl: undefined,
      inputKind: undefined,
      message: 'Checking Codex account and loading available models…',
    };
    const cleanup = flow.cleanup;
    flow.cleanup = undefined;
    flow.respond = undefined;
    await cleanup?.().catch(() => {});
    const probe = await probeExternalAgentRuntime(execution);
    if (isTerminal(flow.snapshot.phase)) return;
    if (probe.status === 'ready') {
      flow.snapshot = {
        ...flow.snapshot,
        phase: 'succeeded',
        probe,
        message: probe.account?.label
          ? `Signed in as ${probe.account.label}.`
          : 'Signed in to Codex.',
      };
    } else {
      flow.snapshot = {
        ...flow.snapshot,
        phase: 'failed',
        probe,
        message: probe.message || 'Codex sign-in completed, but verification failed.',
      };
    }
    scheduleCleanup(flow, COMPLETED_RETENTION_MS);
  };

  try {
    server = new CodexAppServer(
      tmpdir(),
      (method: string, params: CodexRecord) => {
        if (method !== 'account/login/completed') return;
        const loginId = text(params.loginId);
        if (activeLoginId && loginId && loginId !== activeLoginId) return;
        void completeCodexSignIn(params.success === true, text(params.error) || null);
      },
      (err: Error) => {
        if (isTerminal(flow.snapshot.phase)) return;
        log.warn({ err, flowId: flow.snapshot.flowId }, `Codex auth server closed: ${err.message}`);
        void finishFlow(flow, {
          phase: 'failed',
          message: err.message || 'Codex sign-in process exited unexpectedly.',
        });
      },
      { binaryPath: executablePath, homePath: execution.homePath },
    );

    flow.cleanup = async () => {
      const currentServer = server;
      const loginId = activeLoginId;
      server = undefined;
      activeLoginId = undefined;
      if (currentServer && loginId) {
        await currentServer.request('account/login/cancel', { loginId }, AbortSignal.timeout(2_000)).catch(() => {});
      }
      await currentServer?.close(true);
    };

    const initAbort = AbortSignal.timeout(12_000);
    await server.request('initialize', { clientInfo: { name: 'xopc', title: 'xopc', version: '1' } }, initAbort);
    server.notify('initialized');

    if (mode === 'api_key') {
      const trimmedKey = apiKey?.trim();
      if (!trimmedKey) {
        await finishFlow(flow, { phase: 'failed', message: 'Enter an OpenAI API key.' });
        return { ...flow.snapshot };
      }
      await server.request('account/login/start', { type: 'apiKey', apiKey: trimmedKey }, AbortSignal.timeout(15_000));
      await completeCodexSignIn(true, null);
      return { ...flow.snapshot };
    }

    if (mode === 'device_code') {
      const res = await server.request('account/login/start', { type: 'chatgptDeviceCode' }, AbortSignal.timeout(15_000));
      activeLoginId = text(res.loginId) || undefined;
      const verificationUrl = text(res.verificationUrl);
      const userCode = text(res.userCode);
      if (!verificationUrl || !userCode) {
        await finishFlow(flow, { phase: 'failed', message: 'Codex did not return a device verification code.' });
        return { ...flow.snapshot };
      }
      flow.snapshot = {
        ...flow.snapshot,
        phase: 'waiting',
        authorizationUrl: verificationUrl,
        userCode,
        message: 'Open the verification link and enter the one-time code to finish Codex sign-in.',
      };
      return { ...flow.snapshot };
    }

    const res = await server.request('account/login/start', { type: 'chatgpt' }, AbortSignal.timeout(15_000));
    activeLoginId = text(res.loginId) || undefined;
    const authUrl = text(res.authUrl);
    if (!authUrl) {
      await finishFlow(flow, { phase: 'failed', message: 'Codex did not return a ChatGPT sign-in URL.' });
      return { ...flow.snapshot };
    }
    const loopback = extractLoopbackRedirect(authUrl);
    flow.pendingRedirect = loopback;
    if (loopback) {
      flow.respond = async (rawValue: string) => {
        const callback = validateAndNormalizeCallbackUrl(loopback, rawValue);
        flow.snapshot = {
          ...flow.snapshot,
          phase: 'verifying',
          message: 'Delivering OAuth callback to Codex…',
        };
        await forwardLoopbackCallback(callback);
      };
    }
    flow.snapshot = {
      ...flow.snapshot,
      phase: 'waiting',
      authorizationUrl: authUrl,
      ...(loopback ? { inputKind: 'callback_url' as const } : {}),
      message: 'Complete ChatGPT sign-in in the browser window. Waiting for confirmation…',
    };
    return { ...flow.snapshot };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishFlow(flow, { phase: 'failed', message });
    return { ...flow.snapshot };
  }
}

async function startAgyCodeLoginFlow(
  flow: ActiveAuthFlow,
  execution: AgyExecution,
  executablePath: string,
): Promise<ExternalRuntimeAuthFlowSnapshot> {
  const spawnSpec = resolveAgySpawnSpec({ ...execution, binaryPath: executablePath });
  const env = { ...spawnSpec.env };
  // Suppress local browser spawning inside agy so the OAuth URL is printed cleanly for xopc UI.
  delete env.DISPLAY;
  delete env.WAYLAND_DISPLAY;

  let child: ChildProcessWithoutNullStreams | undefined;
  let lastLine = '';
  let resolvedInitialUrl: (() => void) | undefined;
  const firstUrlReady = new Promise<void>((resolve) => {
    resolvedInitialUrl = resolve;
  });

  try {
    child = spawnStdioProcess({
      program: spawnSpec.command,
      args: [...spawnSpec.args, '--login'],
      cwd: tmpdir(),
      env,
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishFlow(flow, { phase: 'failed', message: `Could not start Antigravity sign-in: ${message}` });
    return { ...flow.snapshot };
  }

  const closed = new Promise<void>(resolve => child!.once('close', resolve));
  flow.cleanup = async () => {
    const current = child;
    child = undefined;
    if (current) await closeRuntimeProcess(current, closed, 'Antigravity sign-in', true);
  };

  const handleOutputLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line || isTerminal(flow.snapshot.phase)) return;
    lastLine = line;
    const match = line.match(GOOGLE_URL_PATTERN);
    if (!match) return;
    const authorizationUrl = match[0];
    if (flow.snapshot.authorizationUrl === authorizationUrl) return;
    const codeRedirect = extractGoogleCodeRedirect(authorizationUrl);
    const loopback = codeRedirect ? undefined : extractLoopbackRedirect(authorizationUrl);
    flow.pendingRedirect = codeRedirect ?? loopback;

    if (loopback) {
      flow.respond = async (rawValue: string) => {
        const callback = validateAndNormalizeCallbackUrl(loopback, rawValue);
        flow.snapshot = {
          ...flow.snapshot,
          phase: 'verifying',
          message: 'Delivering Google sign-in callback to Antigravity…',
        };
        await forwardLoopbackCallback(callback);
      };
      flow.snapshot = {
        ...flow.snapshot,
        phase: 'waiting',
        authorizationUrl,
        inputKind: 'callback_url',
        message: 'Complete Google sign-in in your browser. Waiting for Antigravity to confirm…',
      };
    } else {
      flow.respond = async (rawValue: string) => {
        if (!child || child.exitCode !== null || !child.stdin.writable) {
          throw new Error('Antigravity sign-in process is no longer waiting for a code.');
        }
        const normalized = validateAntigravityCodeResponse(flow.pendingRedirect, rawValue);
        flow.snapshot = {
          ...flow.snapshot,
          phase: 'verifying',
          message: 'Submitting authorization code to Antigravity…',
        };
        await new Promise<void>((resolve, reject) => {
          child!.stdin.write(`${normalized}\n`, (err) => (err ? reject(err) : resolve()));
        });
      };
      flow.snapshot = {
        ...flow.snapshot,
        phase: 'waiting',
        authorizationUrl,
        inputKind: 'code_or_url',
        message: 'Complete Google sign-in in your browser, then paste the code (or full URL) shown on the Antigravity page.',
      };
    }
    resolvedInitialUrl?.();
    resolvedInitialUrl = undefined;
  };

  createInterface({ input: child.stdout }).on('line', handleOutputLine);
  createInterface({ input: child.stderr }).on('line', handleOutputLine);

  child.once('error', (error) => {
    resolvedInitialUrl?.();
    resolvedInitialUrl = undefined;
    void finishFlow(flow, {
      phase: 'failed',
      message: `Antigravity sign-in process failed: ${error.message}`,
    });
  });

  child.once('exit', (code) => {
    resolvedInitialUrl?.();
    resolvedInitialUrl = undefined;
    if (isTerminal(flow.snapshot.phase)) return;
    if (code === 0) {
      void (async () => {
        flow.snapshot = {
          ...flow.snapshot,
          phase: 'verifying',
          authorizationUrl: undefined,
          inputKind: undefined,
          message: 'Checking Antigravity access and loading available models…',
        };
        const cleanup = flow.cleanup;
        flow.cleanup = undefined;
        flow.respond = undefined;
        await cleanup?.();
        const probe = await probeExternalAgentRuntime(execution);
        if (isTerminal(flow.snapshot.phase)) return;
        if (probe.status === 'ready') {
          flow.snapshot = {
            ...flow.snapshot,
            phase: 'succeeded',
            probe,
            message: 'Signed in to Antigravity.',
          };
        } else {
          flow.snapshot = {
            ...flow.snapshot,
            phase: 'failed',
            probe,
            message: probe.message || 'Antigravity sign-in completed, but session verification failed.',
          };
        }
        scheduleCleanup(flow, COMPLETED_RETENTION_MS);
      })();
      return;
    }
    void finishFlow(flow, {
      phase: 'failed',
      message: lastLine || `Antigravity sign-in exited with code ${code ?? 'unknown'}.`,
    });
  });

  // Give the CLI a brief window to print the OAuth URL immediately on the start response.
  await Promise.race([
    firstUrlReady,
    new Promise<void>((resolve) => setTimeout(resolve, 4_000)),
  ]);
  return { ...flow.snapshot };
}

async function startAgyAcpAuthenticateFlow(
  flow: ActiveAuthFlow,
  execution: AgyExecution,
  executablePath: string,
): Promise<ExternalRuntimeAuthFlowSnapshot> {
  const spawnSpec = resolveAgySpawnSpec({ ...execution, binaryPath: executablePath });
  let client: AcpJsonRpcClient | undefined;
  let resolvedInitialUrl: (() => void) | undefined;
  const firstUrlReady = new Promise<void>((resolve) => {
    resolvedInitialUrl = resolve;
  });

  const onLine = (rawLine: string) => {
    const match = rawLine.trim().match(GOOGLE_URL_PATTERN);
    if (!match || isTerminal(flow.snapshot.phase)) return;
    const authorizationUrl = match[0];
    const loopback = extractLoopbackRedirect(authorizationUrl);
    flow.pendingRedirect = loopback;
    if (loopback) {
      flow.respond = async (rawValue: string) => {
        const callback = validateAndNormalizeCallbackUrl(loopback, rawValue);
        flow.snapshot = {
          ...flow.snapshot,
          phase: 'verifying',
          message: 'Delivering Google sign-in callback to Antigravity…',
        };
        await forwardLoopbackCallback(callback);
      };
    }
    flow.snapshot = {
      ...flow.snapshot,
      phase: 'waiting',
      authorizationUrl,
      ...(loopback ? { inputKind: 'callback_url' as const } : {}),
      message: 'Complete Google sign-in in your browser. Waiting for Antigravity to confirm…',
    };
    resolvedInitialUrl?.();
    resolvedInitialUrl = undefined;
    return undefined;
  };

  client = new AcpJsonRpcClient({
    command: spawnSpec.command,
    args: spawnSpec.args,
    cwd: tmpdir(),
    env: spawnSpec.env,
    label: 'AntigravityAuth',
    notFoundMessage: 'Antigravity CLI (agy) was not found on the Gateway host.',
    onNotification: () => {},
    onNonJsonLine: onLine,
    onStderrLine: onLine,
    onFailure: (err) => {
      resolvedInitialUrl?.();
      resolvedInitialUrl = undefined;
      void finishFlow(flow, { phase: 'failed', message: err.message });
    },
  });

  flow.cleanup = async () => {
    const current = client;
    client = undefined;
    await current?.close(true);
  };

  void (async () => {
    try {
      await client!.request('initialize', {
        protocolVersion: 1,
        clientInfo: { name: 'xopc', version: '1.0.0' },
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      }, AbortSignal.timeout(20_000));
      const methodId = execution.authMethod ?? 'oauth-personal';
      await client!.request('authenticate', { methodId });
      resolvedInitialUrl?.();
      resolvedInitialUrl = undefined;
      if (isTerminal(flow.snapshot.phase)) return;
      flow.snapshot = {
        ...flow.snapshot,
        phase: 'verifying',
        authorizationUrl: undefined,
        inputKind: undefined,
        message: 'Checking Antigravity access and loading available models…',
      };
      const cleanup = flow.cleanup;
      flow.cleanup = undefined;
      flow.respond = undefined;
      await cleanup?.().catch(() => {});
      const probe = await probeExternalAgentRuntime(execution);
      if (isTerminal(flow.snapshot.phase)) return;
      if (probe.status === 'ready') {
        flow.snapshot = { ...flow.snapshot, phase: 'succeeded', probe, message: 'Signed in to Antigravity.' };
      } else {
        flow.snapshot = { ...flow.snapshot, phase: 'failed', probe, message: probe.message || 'Antigravity verification failed.' };
      }
      scheduleCleanup(flow, COMPLETED_RETENTION_MS);
    } catch (error) {
      resolvedInitialUrl?.();
      resolvedInitialUrl = undefined;
      const message = error instanceof Error ? error.message : String(error);
      await finishFlow(flow, { phase: 'failed', message });
    }
  })();

  await Promise.race([
    firstUrlReady,
    new Promise<void>((resolve) => setTimeout(resolve, 4_000)),
  ]);
  return { ...flow.snapshot };
}

async function startAgyAuthFlow(
  flow: ActiveAuthFlow,
  execution: AgyExecution,
): Promise<ExternalRuntimeAuthFlowSnapshot> {
  const executablePath = findAgyExecutable(execution.binaryPath);
  if (!executablePath) {
    await finishFlow(flow, {
      phase: 'failed',
      message: execution.binaryPath
        ? `Antigravity binary was not found at "${execution.binaryPath}".`
        : 'Antigravity CLI (agy) was not found in PATH on the Gateway host.',
    });
    return { ...flow.snapshot };
  }

  const authMethod = execution.authMethod ?? 'oauth-personal';
  if (authMethod === 'gemini-api-key' || authMethod === 'agent-platform') {
    const probe = await probeExternalAgentRuntime(execution);
    await finishFlow(flow, {
      phase: probe.status === 'ready' ? 'succeeded' : 'failed',
      probe,
      message: probe.status === 'ready'
        ? 'Connected to Antigravity.'
        : (probe.message || 'Antigravity could not authenticate with the configured credentials.'),
    });
    return { ...flow.snapshot };
  }

  if (authMethod === 'oauth-business') {
    return startAgyAcpAuthenticateFlow(flow, execution, executablePath);
  }
  return startAgyCodeLoginFlow(flow, execution, executablePath);
}

async function startClaudeAuthFlow(
  flow: ActiveAuthFlow,
  execution: ClaudeExecution,
): Promise<ExternalRuntimeAuthFlowSnapshot> {
  const executablePath = findClaudeExecutable(execution.binaryPath);
  if (!executablePath) {
    await finishFlow(flow, {
      phase: 'failed',
      message: execution.binaryPath
        ? `Claude Code binary was not found at "${execution.binaryPath}".`
        : 'Claude Code CLI (`claude`) was not found on the Gateway host.',
    });
    return { ...flow.snapshot };
  }

  let child: ChildProcessWithoutNullStreams | undefined;
  let resolvedInitialUrl: (() => void) | undefined;
  const firstUrlReady = new Promise<void>((resolve) => {
    resolvedInitialUrl = resolve;
  });
  const URL_PATTERN = /https:\/\/(?:claude\.ai|console\.anthropic\.com)\/[^\s"'<>]+/;

  try {
    child = spawnStdioProcess({
      program: executablePath,
      args: ['auth', 'login'],
      cwd: tmpdir(),
      env: buildClaudeEnv(execution.configDir),
    });
    const childClosed = new Promise<void>((resolve) => {
      child!.once('close', () => resolve());
    });

    flow.cleanup = async () => {
      const current = child;
      child = undefined;
      if (current) await closeRuntimeProcess(current, childClosed, 'ClaudeAuth', true);
    };

    const handleLine = (line: string) => {
      const urlMatch = line.match(URL_PATTERN);
      if (urlMatch && !flow.snapshot.authorizationUrl && !isTerminal(flow.snapshot.phase)) {
        flow.snapshot = {
          ...flow.snapshot,
          phase: 'waiting',
          authorizationUrl: urlMatch[0],
          message: 'Complete Claude sign-in in the browser window. Waiting for confirmation…',
        };
        resolvedInitialUrl?.();
      }
    };

    createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', handleLine);
    createInterface({ input: child.stderr, crlfDelay: Infinity }).on('line', handleLine);

    child.on('exit', (code) => {
      child = undefined;
      resolvedInitialUrl?.();
      if (isTerminal(flow.snapshot.phase)) return;
      void (async () => {
        if (code === 0) {
          flow.snapshot = {
            ...flow.snapshot,
            phase: 'verifying',
            message: 'Verifying Claude Code sign-in and loading models…',
          };
          const probe = await probeExternalAgentRuntime(execution);
          await finishFlow(flow, {
            phase: probe.status === 'ready' ? 'succeeded' : 'failed',
            message: probe.status === 'ready'
              ? `Signed in${probe.account?.label ? ` as ${probe.account.label}` : ''}.`
              : (probe.message || 'Claude Code login did not complete.'),
            probe,
          });
          return;
        }
        await finishFlow(flow, {
          phase: 'failed',
          message: 'Run `claude auth login` in your terminal to complete sign-in.',
        });
      })();
    });

    await Promise.race([
      firstUrlReady,
      new Promise<void>((resolve) => setTimeout(resolve, 4_000)),
    ]);

    if (flow.snapshot.phase === 'starting') {
      flow.snapshot = {
        ...flow.snapshot,
        phase: 'waiting',
        message: 'Complete Claude sign-in in the browser window opened by Claude Code…',
      };
    }
    return { ...flow.snapshot };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishFlow(flow, { phase: 'failed', message });
    return { ...flow.snapshot };
  }
}

export async function startExternalRuntimeAuth(
  input: StartExternalRuntimeAuthInput,
): Promise<ExternalRuntimeAuthFlowSnapshot> {
  const mode: ExternalRuntimeAuthMode = input.mode ?? 'browser';
  const flowId = randomUUID();
  const expiresAtMs = Date.now() + AUTH_FLOW_TTL_MS;
  const snapshot: ExternalRuntimeAuthFlowSnapshot = {
    flowId,
    kind: input.execution.kind,
    mode,
    phase: 'starting',
    message: input.execution.kind === 'codex'
      ? 'Starting Codex sign-in…'
      : input.execution.kind === 'claude'
        ? 'Starting Claude Code sign-in…'
        : 'Starting Antigravity Google OAuth sign-in…',
    expiresAt: new Date(expiresAtMs).toISOString(),
  };

  const flow: ActiveAuthFlow = {
    snapshot,
    expiresAtMs,
    timer: setTimeout(() => {}, AUTH_FLOW_TTL_MS),
  };
  activeFlows.set(flowId, flow);
  scheduleCleanup(flow, AUTH_FLOW_TTL_MS);

  if (input.execution.kind === 'codex') {
    return startCodexAuthFlow(flow, input.execution, mode, input.apiKey);
  }
  if (input.execution.kind === 'claude') {
    return startClaudeAuthFlow(flow, input.execution);
  }
  return startAgyAuthFlow(flow, input.execution);
}

export function getExternalRuntimeAuthFlow(flowId: string): ExternalRuntimeAuthFlowSnapshot | undefined {
  const flow = activeFlows.get(flowId);
  return flow ? { ...flow.snapshot } : undefined;
}

export async function respondExternalRuntimeAuthFlow(
  flowId: string,
  value: string,
): Promise<ExternalRuntimeAuthFlowSnapshot> {
  const flow = activeFlows.get(flowId);
  if (!flow) {
    throw new Error('Sign-in session was not found or has expired.');
  }
  if (isTerminal(flow.snapshot.phase)) {
    throw new Error('This sign-in session has already finished.');
  }
  if (!flow.respond) {
    throw new Error('This sign-in session is not waiting for a manual response yet.');
  }
  await flow.respond(value);
  return { ...flow.snapshot };
}

export async function cancelExternalRuntimeAuthFlow(
  flowId: string,
): Promise<ExternalRuntimeAuthFlowSnapshot | undefined> {
  const flow = activeFlows.get(flowId);
  if (!flow) return undefined;
  if (!isTerminal(flow.snapshot.phase)) {
    await finishFlow(flow, { phase: 'cancelled', message: 'Sign-in cancelled.' });
  }
  return { ...flow.snapshot };
}

export async function cancelAllExternalRuntimeAuthFlows(): Promise<void> {
  await Promise.all([...activeFlows.keys()].map(cancelExternalRuntimeAuthFlow));
}

export async function logoutExternalAgentRuntime(
  execution: ExternalAgentExecution,
): Promise<ExternalRuntimeProbeResult> {
  if (execution.kind === 'codex') {
    const executablePath = findCodexExecutable(execution.binaryPath);
    if (executablePath) {
      let server: CodexAppServer | undefined;
      try {
        server = new CodexAppServer(tmpdir(), () => {}, () => {}, {
          binaryPath: executablePath,
          homePath: execution.homePath,
        });
        const abort = AbortSignal.timeout(10_000);
        await server.request('initialize', { clientInfo: { name: 'xopc', title: 'xopc', version: '1' } }, abort);
        server.notify('initialized');
        await server.request('account/logout', {}, abort);
      } catch (error) {
        log.warn({ err: error }, 'Codex logout RPC failed; falling through to fresh probe');
      } finally {
        await server?.close(true);
      }
    }
    return probeExternalAgentRuntime(execution);
  }

  if (execution.kind === 'claude') {
    const executablePath = findClaudeExecutable(execution.binaryPath);
    if (executablePath) {
      const child = spawnStdioProcess({
        program: executablePath,
        args: ['auth', 'logout'],
        cwd: tmpdir(),
        env: buildClaudeEnv(execution.configDir),
      });
      const childClosed = new Promise<void>((resolve) => {
        child.once('close', () => resolve());
      });
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          void closeRuntimeProcess(child, childClosed, 'ClaudeLogout', true).finally(resolve);
        }, 8_000);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    return probeExternalAgentRuntime(execution);
  }

  const executablePath = findAgyExecutable(execution.binaryPath);
  if (executablePath) {
    const spawnSpec = resolveAgySpawnSpec({ ...execution, binaryPath: executablePath });
    let client: AcpJsonRpcClient | undefined;
    try {
      client = new AcpJsonRpcClient({
        command: spawnSpec.command,
        args: spawnSpec.args,
        cwd: tmpdir(),
        env: spawnSpec.env,
        label: 'AntigravityLogout',
        notFoundMessage: 'Antigravity CLI (agy) was not found on the Gateway host.',
        onNotification: () => {},
      });
      const abort = AbortSignal.timeout(10_000);
      await client.request('initialize', {
        protocolVersion: 1,
        clientInfo: { name: 'xopc', version: '1.0.0' },
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      }, abort);
      await client.request('logout', {}, abort);
    } catch (error) {
      log.warn({ err: error }, 'Antigravity ACP logout failed; falling through to fresh probe');
    } finally {
      await client?.close(true);
    }
  }
  return probeExternalAgentRuntime(execution);
}
