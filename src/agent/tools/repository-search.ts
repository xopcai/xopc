import { spawn } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { evaluateFilePolicy } from '../sandbox/exec-policy.js';

import { prepareSafeToolEnv } from '../sandbox/sanitize-env-vars.js';
import { resolveRipgrepBinary } from '../../infra/ripgrep.js';

/** Bounded native search; unavailable tools and invalid regexes are explicit failures. */
export async function repositorySearch(cwd: string, args: string[], signal?: AbortSignal): Promise<{ output: string; truncated: boolean }> {
  signal?.throwIfAborted();
  const binary = await resolveRipgrepBinary();
  return new Promise((resolve, reject) => {
    const separator = args.indexOf('--');
    const options = separator < 0 ? args : args.slice(0, separator);
    const targets = separator < 0 ? [] : args.slice(separator);
    const excluded = ['.git', 'node_modules', '.env', '.env.*', '.ssh', '.aws', '.gnupg', '.docker', '.config', '.netrc', '.npmrc', '.cargo/credentials', '.kube', '.xopc'];
    const child = spawn(binary, ['--no-config', '--hidden', ...options,
      ...excluded.flatMap(path => ['--glob', `!**/${path}`, '--glob', `!**/${path}/**`]),
      '--no-follow', ...targets], { cwd, env: prepareSafeToolEnv(process.env) });
    const chunks: Buffer[] = []; let bytes = 0, truncated = false, stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    const abort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      const remaining = Math.max(0, 50_000 - bytes);
      chunks.push(chunk.subarray(0, remaining)); bytes += chunk.length;
      if (bytes > 50_000) { truncated = true; child.kill('SIGKILL'); }
    });
    child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-4_000); });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (signal?.aborted) { reject(signal.reason ?? new Error('Search aborted')); return; }
      if (code !== 0 && code !== 1 && !truncated) { reject(new Error(stderr || 'Search did not complete; check ripgrep installation or narrow the search.')); return; }
      resolve({ output: Buffer.concat(chunks).toString('utf8'), truncated });
    });
    if (signal?.aborted) abort();
  });
}

/** Search results must satisfy the same policy as direct file reads. */
export function isSearchFileAllowed(workspace: string, path: string): boolean {
  const policy = evaluateFilePolicy({ operation: 'read', workspaceRoot: workspace, path });
  if (!policy.allowed || !policy.canonicalPath) return false;
  try {
    const stat = lstatSync(policy.canonicalPath);
    return stat.isFile() && stat.nlink === 1;
  } catch { return false; }
}
