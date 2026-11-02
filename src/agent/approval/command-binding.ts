import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/** Bind explicit local file operands; this is not a shell parser or a sandbox. */
export function commandApprovalBinding(args: unknown, workspace: string): unknown {
  const input = args as { cmd?: unknown; cwd?: unknown };
  const cwd = realpathSync(typeof input?.cwd === 'string' ? resolve(workspace, input.cwd) : workspace);
  const command = typeof input?.cmd === 'string' ? input.cmd : '';
  const tokens = [...command.matchAll(/"([^"\n]*)"|'([^'\n]*)'|([^\s"';&|()<>]+)/g)];
  const files = tokens.slice(0, 128).flatMap<Record<string, unknown>>(match => {
    const token = match[1] ?? match[2] ?? match[3];
    if (!token || token.startsWith('-') || /[$`*?{}\n]/.test(token)) return [];
    const requested = resolve(cwd, token);
    try {
      const path = realpathSync(requested), stat = statSync(path);
      if (!stat.isFile()) return [{ requested, path }];
      return [{ requested, path, size: stat.size, mode: stat.mode, mtime: stat.mtimeMs,
        hash: stat.size <= 2 * 1024 * 1024 ? createHash('sha256').update(readFileSync(path)).digest('hex') : undefined }];
    } catch { return [{ requested, missing: true }]; }
  });
  return { cwd, files };
}
