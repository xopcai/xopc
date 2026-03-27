import { spawn } from 'node:child_process';

import { type IpcMain, app } from 'electron';
import { join } from 'node:path';
import { rgPath } from '@vscode/ripgrep';

export interface SearchResult {
  filePath: string;
  lineNumber: number;
  lineContent: string;
  matchStart: number;
  matchEnd: number;
}

function resolveRipgrepBinary(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'bin', process.platform === 'win32' ? 'rg.exe' : 'rg');
  }
  return rgPath;
}

export function registerSearchIpc(ipcMain: IpcMain): void {
  ipcMain.handle(
    'search:ripgrep',
    (_, query: string, dirPath: string): Promise<SearchResult[]> => {
      return new Promise((resolve, reject) => {
        const rgBin = resolveRipgrepBinary();
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
