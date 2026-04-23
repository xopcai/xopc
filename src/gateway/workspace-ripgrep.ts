import { spawn } from 'node:child_process';

export interface WorkspaceSearchHit {
  filePath: string;
  lineNumber: number;
  lineContent: string;
  matchStart: number;
  matchEnd: number;
}

async function resolveRipgrepBinary(): Promise<string | null> {
  try {
    const { rgPath } = await import('@vscode/ripgrep');
    if (typeof rgPath === 'string' && rgPath.length > 0) {
      return rgPath;
    }
  } catch {
    // pnpm may skip @vscode/ripgrep postinstall; package dir can be missing.
  }
  return 'rg';
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

      rg.on('close', () => {
        const tail = buffer.trim();
        if (tail) lines.push(tail.replace(/\\/g, '/'));
        resolve(lines);
      });
      rg.on('error', () => resolve([]));
    });
  })();
}

export interface SymbolWorkspaceHit {
  filePath: string;
  lineNumber: number;
  lineContent: string;
}

/** Word-boundary search for a symbol name in common source extensions (relative paths vs `workspaceRootAbs`). */
export function runRipgrepSymbolHits(
  workspaceRootAbs: string,
  rawSymbol: string,
  limit: number,
): Promise<SymbolWorkspaceHit[]> {
  return (async () => {
    const trimmed = rawSymbol.trim();
    if (!trimmed || trimmed.length > 80) return [];

    const rgExecutable = await resolveRipgrepBinary();
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = `\\b${escaped}\\b`;

    return await new Promise<SymbolWorkspaceHit[]>((resolve) => {
      const cap = Math.min(Math.max(limit, 1), 40);
      const args = [
        '--json',
        '--smart-case',
        '--max-count',
        String(cap),
        '--glob',
        '*.ts',
        '--glob',
        '*.tsx',
        '--glob',
        '*.mts',
        '--glob',
        '*.cts',
        '--glob',
        '*.js',
        '--glob',
        '*.jsx',
        '--glob',
        '*.mjs',
        '--glob',
        '*.cjs',
        '--glob',
        '*.vue',
        '--glob',
        '*.svelte',
        pattern,
        '.',
      ];

      const rg = spawn(rgExecutable, args, { shell: false, cwd: workspaceRootAbs });
      const results: SymbolWorkspaceHit[] = [];
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
              };
            };
            if (parsed.type === 'match' && parsed.data) {
              const d = parsed.data;
              const pathText = d.path?.text ?? '';
              const lineContent = d.lines?.text ?? '';
              const lineNumber = d.line_number ?? 0;
              results.push({
                filePath: pathText,
                lineNumber,
                lineContent: lineContent.trimEnd(),
              });
              if (results.length >= cap) break;
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
