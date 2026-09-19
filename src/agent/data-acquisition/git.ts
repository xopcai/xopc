import { relative, resolve, sep } from 'node:path';

import { runProcess } from '../../process/run-process.js';
import { checkedFilePath } from '../sandbox/fileAccess.js';
import { evaluateExecPolicy } from '../sandbox/exec-policy.js';
import { dataScheduler } from './scheduler.js';

export type GitDataOperation =
  | { kind: 'git_recent'; paths?: string[]; since?: string; until?: string }
  | { kind: 'git_read'; path: string; commit: string };

export async function readGitData(workspace: string, operation: GitDataOperation, signal: AbortSignal, onRequest: () => void) {
  const cwd = checkedFilePath(workspace, workspace, 'read');
  const policy = evaluateExecPolicy({ command: 'git log', cwd, workspaceRoot: workspace });
  if (!policy.allowed) throw new Error(`Sandbox: ${policy.reason}`);
  const env = Object.fromEntries(Object.entries(policy.sanitizedEnv).filter(([key]) => !key.startsWith('GIT_')));
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null';
  env.GIT_OPTIONAL_LOCKS = '0';
  const run = async (args: string[]) => dataScheduler.run(cwd, signal, async () => {
    onRequest();
    const result = await runProcess({ program: 'git', args: ['--no-pager', '--literal-pathspecs', '-c', 'core.fsmonitor=false',
      '-c', 'core.hooksPath=/dev/null', ...args], cwd, env, signal, timeoutMs: 5000, maxOutputBytes: 64 * 1024, terminationPolicy: 'tree' });
    signal.throwIfAborted();
    if (result.exitCode !== 0 || result.timedOut) throw new Error(result.stderr || 'Git data is unavailable');
    return result;
  });
  if (operation.kind === 'git_read') {
    const target = checkedFilePath(workspace, resolve(workspace, operation.path), 'read');
    const root = (await run(['rev-parse', '--show-toplevel'])).stdout.trim();
    const path = relative(root, target).split(sep).join('/');
    if (path.startsWith('../') || path === '..') throw new Error('Git file must be inside the repository');
    const result = await run(['show', '--no-ext-diff', '--no-textconv', `${operation.commit}:${path}`]);
    if (result.stdout.includes('\0')) throw new Error('Git object is binary; use a format-specific tool');
    return { text: result.stdout, resource: target, revision: operation.commit, exhausted: !result.outputTruncated,
      reason: result.outputTruncated ? 'output_budget' : undefined };
  }
  const paths = (operation.paths ?? ['.']).map(path => checkedFilePath(workspace, resolve(workspace, path), 'read'));
  for (const value of [operation.since, operation.until]) if (value && !Number.isFinite(Date.parse(value))) throw new Error('Invalid Git date');
  const head = (await run(['rev-parse', '--verify', 'HEAD'])).stdout.trim();
  const shallow = (await run(['rev-parse', '--is-shallow-repository'])).stdout.trim() === 'true';
  const recent = await run(['log', '--no-ext-diff', '--no-textconv', '--format=%H %cI %s', '-21',
    ...(operation.since ? [`--since=${operation.since}`] : []), ...(operation.until ? [`--until=${operation.until}`] : []), 'HEAD', '--', ...paths]);
  const rows = recent.stdout.trim().split('\n').filter(Boolean);
  const dirty = (await run(['status', '--porcelain', '--untracked-files=normal', '--', ...paths])).stdout.length > 0;
  const omitted = recent.outputTruncated || rows.length > 20;
  return { text: `HEAD: ${head}\nDirty worktree: ${dirty}\nShallow history: ${shallow}\n${rows.slice(0, 20).join('\n')}`,
    resource: cwd, revision: head, exhausted: !omitted && !shallow, reason: omitted ? 'output_budget' : shallow ? 'shallow_history' : undefined };
}
