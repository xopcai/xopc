import { mkdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

import { resolveStateDir } from '../../config/paths-state.js';
import { spawnProcess } from '../../process/run-process.js';
import type { ProcessHandle } from '../../process/process-spec.js';
import type { CliAdapter } from './types.js';

const running = new Map<string, Set<ProcessHandle>>();

export function cancelCliContext(contextId: string): void {
  for (const handle of running.get(contextId) ?? []) handle.terminate('cancelled');
}

export function cliRoot(): string { return join(resolveStateDir(), 'connectors', 'cli'); }

export function cliContextPath(id: string): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error('Invalid CLI context ID.');
  return join(cliRoot(), 'contexts', id);
}

export function cliEnvironment(adapter: CliAdapter, contextPath: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'TMPDIR', 'TEMP', 'TMP', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'LANG']) {
    if (process.env[name]) env[name] = process.env[name];
  }
  env[adapter.configEnvironment] = join(contextPath, 'config');
  if (adapter.dataEnvironment) env[adapter.dataEnvironment] = join(contextPath, 'data');
  // The child owns this home directory; the host process environment is unchanged.
  env.HOME = join(contextPath, 'home');
  env.USERPROFILE = env.HOME;
  env.NO_COLOR = '1';
  return env;
}

export async function startCliProcess(options: {
  adapter: CliAdapter;
  executable: string;
  contextId: string;
  args: string[];
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutputBytes?: number;
  beforeSpawn?: () => void;
  onOutput?: (stream: 'stdout' | 'stderr', chunk: Buffer) => void;
}): Promise<ProcessHandle> {
  if (!isAbsolute(options.executable)) throw new Error('CLI executable must be an absolute path.');
  const contextPath = cliContextPath(options.contextId);
  for (const folder of ['', 'config', 'data', 'home', 'files']) {
    await mkdir(join(contextPath, folder), { recursive: true, mode: 0o700 });
  }
  options.signal?.throwIfAborted();
  options.beforeSpawn?.();
  const handle = spawnProcess({
    program: options.executable,
    args: options.args,
    cwd: join(contextPath, 'files'),
    env: cliEnvironment(options.adapter, contextPath),
    shell: false,
    terminationPolicy: 'tree',
    timeoutMs: options.timeoutMs ?? 60_000,
    maxOutputBytes: options.maxOutputBytes ?? 1024 * 1024,
    signal: options.signal,
    onOutput: options.onOutput,
  });
  const active = running.get(options.contextId) ?? new Set<ProcessHandle>();
  running.set(options.contextId, active);
  active.add(handle);
  void handle.completion.finally(() => {
    active.delete(handle);
    if (!active.size) running.delete(options.contextId);
  }).catch(() => undefined);
  return handle;
}

export async function resolveCliArtifact(contextId: string, filePath: string): Promise<string> {
  const root = await realpath(join(cliContextPath(contextId), 'files'));
  const resolved = await realpath(filePath);
  const child = relative(root, resolved);
  if (!child || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) throw new Error('CLI artifact is outside its context.');
  const info = await stat(resolved);
  if (!info.isFile() || info.size > 25 * 1024 * 1024) throw new Error('Invalid CLI artifact.');
  return resolved;
}
