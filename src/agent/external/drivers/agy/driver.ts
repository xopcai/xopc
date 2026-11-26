import { accessSync, constants as fsConstants, statSync } from 'node:fs';
import { delimiter, isAbsolute, join, resolve } from 'node:path';

import { createAcpExternalDriver } from '../../acp/acp-driver.js';
import { AcpRpcError, asRecord } from '../../acp/json-rpc-client.js';

const ANTIGRAVITY_AUTH_STDOUT_PREFIX = 'Open the following link to authenticate the ACP server: ';
const NATIVE_CLI_NO_BROWSER_PREFIX = 'No browser is available here';
const SIGN_IN_REQUIRED_MESSAGE =
  'Antigravity is not signed in on the Gateway host. Run agy login (or agy acp --login) on the Gateway host and try again.';
const NOT_FOUND_MESSAGE =
  'Antigravity CLI (agy) was not found on the Gateway host. Install agy and sign in there, or set XOPC_AGY_BIN.';

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

export function resolveAgyCommand(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.XOPC_AGY_BIN?.trim();
  if (configured) return isAbsolute(configured) ? configured : configured;
  const candidates = process.platform === 'win32'
    ? ['agy', 'antigravity']
    : ['agy', 'antigravity'];
  return findInPath(candidates, env) ?? 'agy';
}

function buildAgyEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (!STRIPPED_ENV_KEYS.has(key.toUpperCase())) env[key] = value;
  }
  env.AGY_CLI_DISABLE_AUTO_UPDATE = 'true';
  env.PYTHONUNBUFFERED = '1';
  return env;
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
  authMethodId: () => process.env.XOPC_AGY_AUTH_METHOD?.trim() || undefined,
  authenticateEagerly: true,
  resolveSpawn: (cwd) => {
    const command = resolveAgyCommand(process.env);
    const geminiDir = process.env.XOPC_AGY_GEMINI_DIR?.trim();
    const args = geminiDir
      ? ['acp', '--gemini-dir', resolve(cwd, geminiDir), '--app-data-dir', 'antigravity-acp']
      : ['acp'];
    return {
      command,
      args,
      env: buildAgyEnv(process.env),
    };
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
    error instanceof AcpRpcError
    && (error.code === -32000 || (error.code === -32603 && error.message.startsWith(NATIVE_CLI_NO_BROWSER_PREFIX))),
  ignoreToolCall: (update) =>
    update.title === 'Run update_steps' && (!update.kind || update.kind === 'other'),
});
