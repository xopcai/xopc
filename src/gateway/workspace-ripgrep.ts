import { spawn } from 'node:child_process';

import { rgPath } from '@vscode/ripgrep';

export interface WorkspaceSearchHit {
  filePath: string;
  lineNumber: number;
  lineContent: string;
  matchStart: number;
  matchEnd: number;
}

/** Run ripgrep in a directory (absolute path). Returns empty array if rg fails to start. */
export function runRipgrepInDirectory(query: string, dirAbsPath: string): Promise<WorkspaceSearchHit[]> {
  return new Promise((resolve) => {
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

    const rg = spawn(rgPath, args, { shell: false });
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
}
