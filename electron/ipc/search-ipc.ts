import { spawn } from 'node:child_process';

import { type IpcMain, app } from 'electron';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { assertTrustedRenderer } from './trusted-renderer.js';

export interface SearchResult {
  filePath: string;
  lineNumber: number;
  lineContent: string;
  matchStart: number;
  matchEnd: number;
}

let cachedDevRipgrepBin: string | undefined;

export type SearchIpcOptions = {
  allowedRoots?: string[];
};

function isPathInsideRoot(candidate: string, root: string): boolean {
  const resolvedCandidate = resolve(candidate);
  const resolvedRoot = resolve(root);
  const rel = relative(resolvedRoot, resolvedCandidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function assertAllowedSearchRoot(dirPath: string, allowedRoots: string[]): void {
  if (typeof dirPath !== 'string' || !isAbsolute(dirPath)) {
    throw new Error('Search path must be absolute.');
  }
  if (allowedRoots.length > 0 && !allowedRoots.some((root) => isPathInsideRoot(dirPath, root))) {
    throw new Error('Search path is outside the Electron-managed workspace.');
  }
}

/** Packaged apps ship `rg` under extraResources; dev resolves from `@vscode/ripgrep` or PATH. */
async function resolveRipgrepBinary(): Promise<string> {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'bin', process.platform === 'win32' ? 'rg.exe' : 'rg');
  }
  if (cachedDevRipgrepBin) return cachedDevRipgrepBin;
  try {
    const { rgPath } = await import('@vscode/ripgrep');
    cachedDevRipgrepBin = typeof rgPath === 'string' && rgPath.length > 0 ? rgPath : 'rg';
  } catch {
    cachedDevRipgrepBin = 'rg';
  }
  return cachedDevRipgrepBin;
}

export function registerSearchIpc(ipcMain: IpcMain, options: SearchIpcOptions = {}): void {
  const allowedRoots = options.allowedRoots ?? [];
  ipcMain.handle(
    'search:ripgrep',
    async (event, query: string, dirPath: string): Promise<SearchResult[]> => {
      assertTrustedRenderer(event);
      assertAllowedSearchRoot(dirPath, allowedRoots);
      const rgBin = await resolveRipgrepBinary();
      return new Promise((resolve, reject) => {
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
          dirPath,
        ];

        const rg = spawn(rgBin, args, { shell: false });
        const results: SearchResult[] = [];
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
        rg.on('error', reject);
      });
    },
  );
}
