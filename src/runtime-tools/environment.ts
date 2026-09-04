import { delimiter, dirname, join } from 'node:path';
import { access } from 'node:fs/promises';

import type { RuntimeToolsConfig } from '../config/schema.js';
import { applyPathPrepend, findPathKey, normalizePathPrepend } from '../infra/path-prepend.js';
import { ManagedRuntimeManager } from './manager.js';
import type { ResolvedRuntime, RuntimeKind } from './types.js';

const POLLUTING_ENV_KEYS = [
  'NODE_OPTIONS',
  'NODE_PATH',
  'NPM_CONFIG_PREFIX',
  'npm_config_prefix',
  'PYTHONHOME',
  'PYTHONPATH',
  'VIRTUAL_ENV',
  'CONDA_PREFIX',
  'UV_PYTHON_INSTALL_DIR',
  'UV_PYTHON_BIN_DIR',
  'UV_TOOL_DIR',
  'UV_TOOL_BIN_DIR',
  'UV_CACHE_DIR',
  'UV_PYTHON_INSTALL_MIRROR',
] as const;

export interface RuntimeEnvironmentOptions {
  stateDir: string;
  config: RuntimeToolsConfig;
  baseEnv: Record<string, string>;
  runtimes?: RuntimeKind[];
  extraBinDirs?: string[];
  skillEnvironmentIds?: string[];
}

export interface RuntimeEnvironmentResult {
  env: Record<string, string>;
  resolved: ResolvedRuntime[];
}

async function skillEnvironmentBinDirs(stateDir: string, environmentIds: string[]): Promise<string[]> {
  const root = join(stateDir, 'tools', 'environments', 'skills');
  const candidates = environmentIds.flatMap((id) => [
    join(root, id, 'bin'),
    join(root, id, 'node_modules', '.bin'),
  ]);
  const existing = await Promise.all(candidates.map(async (candidate) => {
    try {
      await access(candidate);
      return candidate;
    } catch {
      return null;
    }
  }));
  return existing.filter((candidate): candidate is string => candidate !== null);
}

function appendPathEntries(env: Record<string, string>, entries: string[]): void {
  const pathKey = findPathKey(env);
  const existing = (env[pathKey] ?? '').split(delimiter).filter(Boolean);
  env[pathKey] = normalizePathPrepend([...existing, ...entries]).join(delimiter);
}

export async function buildRuntimeEnvironment(
  options: RuntimeEnvironmentOptions,
): Promise<RuntimeEnvironmentResult> {
  const env = { ...options.baseEnv };
  for (const key of POLLUTING_ENV_KEYS) delete env[key];
  const manager = new ManagedRuntimeManager({ stateDir: options.stateDir, config: options.config });
  const runtimes = options.runtimes ?? ['node', 'uv', 'python'];
  const results = await Promise.all(runtimes.map(async (runtime) => {
    try {
      return await manager.resolve({ runtime, allowProvision: false });
    } catch {
      return null;
    }
  }));
  const resolved = results.filter((item): item is ResolvedRuntime => item !== null);
  const managedBinDirs = resolved
    .filter((item) => item.source === 'managed')
    .map((item) => dirname(item.executable));
  const skillBinDirs = await skillEnvironmentBinDirs(
    options.stateDir,
    options.skillEnvironmentIds ?? [],
  );
  applyPathPrepend(env, [
    ...managedBinDirs,
    ...(options.extraBinDirs ?? []),
  ]);
  // Skill-installed commands remain available, but cannot shadow managed or host executables.
  appendPathEntries(env, skillBinDirs);

  if (resolved.some((item) => item.runtime === 'python')) {
    env.PYTHONNOUSERSITE = '1';
    env.PIP_REQUIRE_VIRTUALENV = '1';
  }
  if (resolved.some((item) => item.runtime === 'uv')) {
    const managedPython = resolved.find(
      (item) => item.runtime === 'python' && item.source === 'managed',
    );
    env.UV_PYTHON_INSTALL_DIR = managedPython?.installDir
      ?? join(options.stateDir, 'tools', 'python', 'versions');
    env.UV_PYTHON_BIN_DIR = join(options.stateDir, 'tools', 'python', 'bin');
    env.UV_CACHE_DIR = join(options.stateDir, 'tools', 'cache', 'uv');
    env.UV_MANAGED_PYTHON = '1';
    env.UV_NO_CONFIG = '1';
  }
  if (resolved.some((item) => item.runtime === 'node')) {
    env.COREPACK_HOME = join(options.stateDir, 'tools', 'cache', 'corepack');
    env.npm_config_cache = join(options.stateDir, 'tools', 'cache', 'npm');
  }
  return { env, resolved };
}

const COMMAND_RUNTIME: Record<string, RuntimeKind> = {
  node: 'node',
  npm: 'node',
  npx: 'node',
  corepack: 'node',
  uv: 'uv',
  uvx: 'uv',
  python: 'python',
  python3: 'python',
};

export async function resolveRuntimeCommand(params: {
  command: string;
  stateDir: string;
  config: RuntimeToolsConfig;
  allowProvision: boolean;
}): Promise<string> {
  const runtime = COMMAND_RUNTIME[params.command.toLowerCase()];
  if (!runtime) return params.command;
  const resolved = await new ManagedRuntimeManager({
    stateDir: params.stateDir,
    config: params.config,
  }).resolve({ runtime, allowProvision: params.allowProvision });
  const key = params.command.toLowerCase() === 'python3' ? 'python' : params.command.toLowerCase();
  return resolved.executables[key as keyof typeof resolved.executables] ?? resolved.executable;
}
