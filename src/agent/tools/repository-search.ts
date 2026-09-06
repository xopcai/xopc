import { spawn } from 'node:child_process';

import { resolveRipgrepBinary } from '../../infra/ripgrep.js';

/** Bounded native search; unavailable tools and invalid regexes are explicit failures. */
export async function repositorySearch(cwd: string, args: string[], signal?: AbortSignal): Promise<{ output: string; truncated: boolean }> {
  signal?.throwIfAborted();
  const binary = await resolveRipgrepBinary();
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['--no-config', '--hidden', '--glob', '!.git', '--glob', '!node_modules', ...args], { cwd });
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
