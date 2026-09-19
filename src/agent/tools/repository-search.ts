import { spawn } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { dataScheduler } from '../data-acquisition/scheduler.js';
import { evaluateFilePolicy } from '../sandbox/exec-policy.js';

import { prepareSafeToolEnv } from '../sandbox/sanitize-env-vars.js';
import { resolveRipgrepBinary } from '../../infra/ripgrep.js';

export interface RepositorySearchOptions {
  maxBytes?: number;
  onLine?: (line: string) => boolean | void;
}

export function parseRepositoryMatch(workspace: string, line: string): { path: string; line: number; text: string; match: boolean } | undefined {
  if (!line) return undefined;
  const event = JSON.parse(line);
  if (event.type !== 'match' && event.type !== 'context') return undefined;
  const data = event.data;
  if (typeof data?.path?.text !== 'string' || typeof data.lines?.text !== 'string'
    || !Number.isInteger(data.line_number) || !isSearchFileAllowed(workspace, data.path.text)) return undefined;
  return { path: data.path.text, line: data.line_number, text: data.lines.text.replace(/\r?\n$/, ''), match: event.type === 'match' };
}

/** One bounded process path for raw filename output and streamed JSON events. */
export async function repositorySearch(cwd: string, args: string[], signal?: AbortSignal, options: RepositorySearchOptions = {}): Promise<{ output: string; truncated: boolean }> {
  const deadline = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(10_000)]);
  return dataScheduler.run(cwd, deadline, async () => {
    deadline.throwIfAborted();
    const binary = await resolveRipgrepBinary();
    deadline.throwIfAborted();
    return new Promise((resolve, reject) => {
      const separator = args.indexOf('--');
      const searchOptions = separator < 0 ? args : args.slice(0, separator);
      const targets = separator < 0 ? [] : args.slice(separator);
      const excluded = ['.git', 'node_modules', '.env', '.env.*', '.ssh', '.aws', '.gnupg', '.docker', '.config', '.netrc', '.npmrc', '.cargo/credentials', '.kube', '.xopc'];
      const child = spawn(binary, ['--no-config', '--hidden', ...searchOptions,
        ...excluded.flatMap(path => ['--glob', `!**/${path}`, '--glob', `!**/${path}/**`]),
        '--no-follow', ...targets], { cwd, env: prepareSafeToolEnv(process.env) });
      const chunks: Buffer[] = [];
      const decoder = new StringDecoder('utf8');
      let bytes = 0, truncated = false, stderr = '', pending = '';
      let failure: Error | undefined;
      const stop = () => child.kill('SIGKILL');
      const consume = (text: string) => {
        pending += text;
        let newline: number;
        while (!truncated && (newline = pending.indexOf('\n')) !== -1) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          if (options.onLine?.(line) === false) { truncated = true; stop(); }
        }
      };
      deadline.addEventListener('abort', stop, { once: true });
      child.stdout.on('data', (chunk: Buffer) => {
        if (truncated || failure) return;
        const remaining = Math.max(0, (options.maxBytes ?? 50_000) - bytes);
        const selected = chunk.subarray(0, remaining);
        bytes += chunk.length;
        try {
          if (options.onLine) consume(decoder.write(selected));
          else chunks.push(selected);
        } catch (error) { failure = error instanceof Error ? error : new Error(String(error)); stop(); }
        if (bytes > (options.maxBytes ?? 50_000)) { truncated = true; stop(); }
      });
      child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-4_000); });
      child.on('error', error => { failure = error; });
      child.on('close', code => {
        deadline.removeEventListener('abort', stop);
        if (deadline.aborted) { reject(deadline.reason); return; }
        if (failure) { reject(failure); return; }
        if (code !== 0 && code !== 1 && !truncated) { reject(new Error(stderr || 'Search did not complete; narrow the search.')); return; }
        try {
          if (options.onLine && !truncated) {
            consume(decoder.end());
            if (pending && options.onLine(pending) === false) truncated = true;
          }
          resolve({ output: Buffer.concat(chunks).toString('utf8'), truncated });
        } catch (error) { reject(error); }
      });
      if (deadline.aborted) stop();
    });
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
