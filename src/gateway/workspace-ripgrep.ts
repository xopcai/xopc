import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

import { createLogger } from '../utils/logger.js';

const log = createLogger('WorkspaceRipgrep');

let cachedRipgrepBin: string | undefined;

/**
 * Prefer `@vscode/ripgrep` when its postinstall placed `bin/rg`; otherwise use `rg` on PATH.
 * (Bundled path can be ENOENT if postinstall was skipped or the binary was never downloaded.)
 */
async function resolveRipgrepBinary(): Promise<string> {
  if (cachedRipgrepBin) return cachedRipgrepBin;
  let bin = 'rg';
  try {
    const { rgPath } = await import('@vscode/ripgrep');
    if (typeof rgPath === 'string' && rgPath.length > 0 && existsSync(rgPath)) {
      bin = rgPath;
    } else if (typeof rgPath === 'string' && rgPath.length > 0) {
      log.warn({ rgPath }, '@vscode/ripgrep path missing on disk; falling back to rg on PATH');
    }
  } catch {
    // pnpm may skip @vscode/ripgrep postinstall; package dir can be missing.
  }
  cachedRipgrepBin = bin;
  return bin;
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

      const rg = spawn(rgExecutable, args, { shell: false });
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
      rg.on('error', () => resolve([]));
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
      const rg = spawn(rgExecutable, args, { shell: false, cwd: dirAbsPath });
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
          log.warn({ code, cwd: dirAbsPath, rg: rgExecutable }, 'ripgrep --files exited with no output');
        }
        resolve(lines);
      });
      rg.on('error', (err) => {
        log.warn({ err, cwd: dirAbsPath, rg: rgExecutable }, 'ripgrep --files failed to start');
        resolve([]);
      });
    });
  })();
}
