import { accessSync, constants as fsConstants, statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

import type { AgyExecution, ExternalAgentExecution } from '../../../../agent-config/schema.js';
import { resolveUserPath } from '../../../agent-scope.js';
import { createAcpExternalDriver } from '../../acp/acp-driver.js';
import { AcpRpcError, asRecord } from '../../acp/json-rpc-client.js';

const ANTIGRAVITY_AUTH_STDOUT_PREFIX = 'Open the following link to authenticate the ACP server: ';
const NATIVE_CLI_NO_BROWSER_PREFIX = 'No browser is available here';
const SIGN_IN_REQUIRED_MESSAGE =
  'Antigravity is not signed in on the Gateway host. Run agy login (or agy acp --login) on the Gateway host and try again.';
const NOT_FOUND_MESSAGE =
  'Antigravity CLI (agy) was not found on the Gateway host. Install agy and sign in there, or set a custom binary path.';

const STRIPPED_ENV_KEYS = new Set([
  'ELECTRON_RUN_AS_NODE',
  'CHROME_CRASHPAD_PIPE_NAME',
]);

function isExecutableFile(candidate: string): boolean {
  try {
    if (!statSync(candidate).isFile()) return false;
    if (process.platform !== 'win32') accessSync(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findInPath(names: ReadonlyArray<string>, env: NodeJS.ProcessEnv): string | undefined {
  const pathEnv = env.PATH ?? '';
  const dirs = pathEnv.split(delimiter).filter(Boolean);
  const exts = process.platform === 'win32'
    ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean)
    : [''];
  for (const name of names) {
    for (const dir of dirs) {
      for (const ext of exts) {
        const candidate = join(dir, `${name}${ext}`);
        if (isExecutableFile(candidate)) return candidate;
      }
    }
  }
  return undefined;
}

function agyConfigFromExecution(execution?: ExternalAgentExecution): AgyExecution | undefined {
  return execution?.kind === 'agy' ? execution : undefined;
}

export function findAgyExecutable(configuredPath?: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = configuredPath?.trim() || env.XOPC_AGY_BIN?.trim();
  if (raw) {
    const resolved = raw.includes('/') || raw.includes('\\') || raw.startsWith('~')
      ? resolveUserPath(raw)
      : raw;
    if (isAbsolute(resolved)) return isExecutableFile(resolved) ? resolved : undefined;
    return findInPath([resolved], env);
  }
  return findInPath(['agy', 'antigravity'], env);
}

export function resolveAgyCommand(configuredPath?: string, env: NodeJS.ProcessEnv = process.env): string {
  const raw = configuredPath?.trim() || env.XOPC_AGY_BIN?.trim();
  if (raw) {
    return raw.includes('/') || raw.includes('\\') || raw.startsWith('~')
      ? resolveUserPath(raw)
      : raw;
  }
  return findInPath(['agy', 'antigravity'], env) ?? 'agy';
}

export function buildAgyEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (!STRIPPED_ENV_KEYS.has(key.toUpperCase())) env[key] = value;
  }
  env.AGY_CLI_DISABLE_AUTO_UPDATE = 'true';
  env.PYTHONUNBUFFERED = '1';
  return env;
}

export function resolveAgySpawnSpec(
  execution?: ExternalAgentExecution,
  baseEnv: NodeJS.ProcessEnv = process.env,
): { command: string; args: string[]; env: NodeJS.ProcessEnv } {
  const agyConfig = agyConfigFromExecution(execution);
  const command = resolveAgyCommand(agyConfig?.binaryPath, baseEnv);
  const rawGeminiDir = agyConfig?.geminiDir?.trim() || baseEnv.XOPC_AGY_GEMINI_DIR?.trim();
  const geminiDir = rawGeminiDir ? resolveUserPath(rawGeminiDir) : undefined;
  const args = geminiDir
    ? ['acp', '--gemini-dir', geminiDir, '--app-data-dir', 'antigravity-acp']
    : ['acp'];
  return {
    command,
    args,
    env: buildAgyEnv(baseEnv),
  };
}

function supportsAntigravitySystemPromptAppend(initializeResult: Record<string, unknown>): boolean {
  const agentCapabilities = asRecord(initializeResult.agentCapabilities);
  const meta = asRecord(agentCapabilities?._meta);
  const antigravity = asRecord(meta?.antigravity);
  const systemPrompt = asRecord(antigravity?.systemPrompt);
  return systemPrompt?.append === true;
}

export const agyExternalDriver = createAcpExternalDriver({
  kind: 'agy',
  label: 'Antigravity',
  transcriptProvider: 'google-antigravity',
  defaultModelName: 'antigravity',
  notFoundMessage: NOT_FOUND_MESSAGE,
  signInRequiredMessage: SIGN_IN_REQUIRED_MESSAGE,
  installHintCommand: 'agy acp --login',
  loginHintCommand: 'agy acp --login',
  findExecutable: (execution) => findAgyExecutable(agyConfigFromExecution(execution)?.binaryPath, process.env),
  authMethodId: (execution) =>
    agyConfigFromExecution(execution)?.authMethod
    ?? (process.env.XOPC_AGY_AUTH_METHOD?.trim() || undefined),
  authenticateEagerly: true,
  resolveSpawn: (_cwd, execution) => {
    const spawnSpec = resolveAgySpawnSpec(execution);
    return { ...spawnSpec, args: [...spawnSpec.args, '--sandbox'] };
  },
  buildSessionMeta: (initializeResult, instructions) =>
    instructions && supportsAntigravitySystemPromptAppend(initializeResult)
      ? { antigravity: { systemPrompt: { append: instructions } } }
      : undefined,
  onNonJsonLine: (line) =>
    line.startsWith(ANTIGRAVITY_AUTH_STDOUT_PREFIX) ? new Error(SIGN_IN_REQUIRED_MESSAGE) : undefined,
  onStderrLine: (line) =>
    line.startsWith(ANTIGRAVITY_AUTH_STDOUT_PREFIX) ? new Error(SIGN_IN_REQUIRED_MESSAGE) : undefined,
  isSignInRequiredError: (error) =>
    (error instanceof Error && error.message === SIGN_IN_REQUIRED_MESSAGE)
    || (error instanceof AcpRpcError
      && (error.code === -32000 || (error.code === -32603 && error.message.startsWith(NATIVE_CLI_NO_BROWSER_PREFIX)))),
  ignoreToolCall: (update) =>
    update.title === 'Run update_steps' && (!update.kind || update.kind === 'other'),
});
