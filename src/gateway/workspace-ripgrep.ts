import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

import { createLogger } from '../utils/logger.js';

const log = createLogger('WorkspaceRipgrep');

function isEnoent(err: unknown): boolean {
  return err !== null && typeof err === 'object' && (err as NodeJS.ErrnoException).code === 'ENOENT';
}

/** Ripgrep binaries inside `app.asar` are not executable (spawn throws ENOTDIR). */
export function isAsarBundledPath(filePath: string): boolean {
  return filePath.includes('.asar');
}

/** True when `filePath` is a real on-disk executable candidate (not inside asar). */
export function isRunnableRipgrepPath(filePath: string): boolean {
  const trimmed = filePath.trim();
  if (!trimmed || isAsarBundledPath(trimmed)) return false;
  return existsSync(trimmed);
}

let cachedRipgrepBin: string | undefined;

/** @internal Test-only — clears memoized ripgrep path between cases. */
export function resetRipgrepBinaryCacheForTests(): void {
  cachedRipgrepBin = undefined;
}

/**
 * Resolve ripgrep binary:
 * 1. `XOPC_RIPGREP_BIN` (Electron extraResources `bin/rg`)
 * 2. `@vscode/ripgrep` postinstall path (dev / CLI)
 * 3. `rg` on PATH
 */
async function resolveRipgrepBinary(): Promise<string> {
  if (cachedRipgrepBin) return cachedRipgrepBin;

  const envBin = process.env.XOPC_RIPGREP_BIN?.trim();
  if (envBin && isRunnableRipgrepPath(envBin)) {
    cachedRipgrepBin = envBin;
    return envBin;
  }

  let bin = 'rg';
  try {
    const { rgPath } = await import('@vscode/ripgrep');
    if (typeof rgPath === 'string' && rgPath.length > 0) {
      if (isRunnableRipgrepPath(rgPath)) {
        bin = rgPath;
      } else if (isAsarBundledPath(rgPath)) {
        log.debug({ rgPath }, '@vscode/ripgrep path is inside app.asar; will try rg on PATH or XOPC_RIPGREP_BIN');
      } else {
        log.debug({ rgPath }, '@vscode/ripgrep binary not on disk; will try rg on PATH');
      }
    }
  } catch {
    // pnpm may skip @vscode/ripgrep postinstall; package dir can be missing.
  }
  cachedRipgrepBin = bin;
  return bin;
}

function spawnRipgrep(
  executable: string,
  args: string[],
  options: { cwd?: string },
  context: { phase: string; dir?: string; rg: string },
): ChildProcess | null {
  try {
    return spawn(executable, args, { shell: false, ...options });
  } catch (err) {
    const em = err instanceof Error ? err.message : String(err);
    log.warn({ err, ...context, rg: executable }, `ripgrep ${context.phase}: spawn failed: ${em}`);
    return null;
  }
}

export interface WorkspaceSearchHit {
  filePath: string;
  lineNumber: number;
  lineContent: string;
  matchStart: number;
  matchEnd: number;
}

/** Run ripgrep in a directory (absolute path). Returns empty array if rg fails to start. */
export function runRipgrepInDirectory(query: string, dirAbsPath: string): Promise<WorkspaceSearchHit[]> {
  return (async () => {
    const rgExecutable = await resolveRipgrepBinary();

    return await new Promise<WorkspaceSearchHit[]>((resolve) => {
      const args = [
        '--json',
        '--smart-case',
        '--max-count',
        '50',
        '--glob',
        '*.md',
        '--glob',
        '*.txt',
        query,
        dirAbsPath,
      ];

      const rg = spawnRipgrep(rgExecutable, args, {}, {
        phase: 'in-directory',
        dir: dirAbsPath,
        rg: rgExecutable,
      });
      if (!rg) {
        resolve([]);
        return;
      }
      const results: WorkspaceSearchHit[] = [];
      let buffer = '';

      rg.stdout.on('data', (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line) as {
              type?: string;
              data?: {
                path?: { text?: string };
                lines?: { text?: string };
                line_number?: number;
                submatches?: Array<{ start?: number; end?: number }>;
              };
            };
            if (parsed.type === 'match' && parsed.data) {
              const d = parsed.data;
              const pathText = d.path?.text ?? '';
              const lineContent = d.lines?.text ?? '';
              const lineNumber = d.line_number ?? 0;
              const sm = d.submatches?.[0];
              results.push({
                filePath: pathText,
                lineNumber,
                lineContent: lineContent.trimEnd(),
                matchStart: sm?.start ?? 0,
                matchEnd: sm?.end ?? 0,
              });
            }
          } catch {
            /* skip */
          }
        }
      });

      rg.on('close', () => resolve(results));
      rg.on('error', (err) => {
        if (!isEnoent(err)) {
          log.warn({ err, query, dir: dirAbsPath, rg: rgExecutable }, 'ripgrep in-directory: spawn failed');
        } else {
          log.debug({ dir: dirAbsPath, rg: rgExecutable }, 'ripgrep not on PATH; skipping in-directory search');
        }
        resolve([]);
      });
    });
  })();
}

/**
 * List workspace-relative file paths via ripgrep `--files` (respects .gitignore; fast on large trees).
 * Returns POSIX paths relative to `dirAbsPath`.
 */
export function runRipgrepListFiles(dirAbsPath: string): Promise<string[]> {
  return (async () => {
    const rgExecutable = await resolveRipgrepBinary();

    return await new Promise<string[]>((resolve) => {
      const args = ['--files', '--glob', '!**/node_modules/**', '--glob', '!.git/**', '.'];
      const rg = spawnRipgrep(rgExecutable, args, { cwd: dirAbsPath }, {
        phase: '--files',
        dir: dirAbsPath,
        rg: rgExecutable,
      });
      if (!rg) {
        resolve([]);
        return;
      }
      const lines: string[] = [];
      let buffer = '';

      rg.stdout.on('data', (data: Buffer) => {
        buffer += data.toString();
        const parts = buffer.split(/\r?\n/);
        buffer = parts.pop() ?? '';
        for (const line of parts) {
          const t = line.trim();
          if (t) lines.push(t.replace(/\\/g, '/'));
        }
      });

      rg.on('close', (code) => {
        const tail = buffer.trim();
        if (tail) lines.push(tail.replace(/\\/g, '/'));
        if (code !== 0 && lines.length === 0) {
          log.debug({ code, cwd: dirAbsPath, rg: rgExecutable }, 'ripgrep --files: non-zero exit, no output (using fs fallback if any)');
        }
        resolve(lines);
      });
      rg.on('error', (err) => {
        if (isEnoent(err)) {
          log.debug(
            { cwd: dirAbsPath, rg: rgExecutable },
            'ripgrep binary not found; workspace file search will use fs fallback when needed',
          );
        } else {
          log.warn({ err, cwd: dirAbsPath, rg: rgExecutable }, 'ripgrep --files failed to start');
        }
        resolve([]);
      });
    });
  })();
}
