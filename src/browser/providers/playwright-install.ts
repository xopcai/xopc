import { spawn } from 'node:child_process';

import type { BrowserInstallProgress } from '../install-progress.js';

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export type PlaywrightInstallResult = {
  stdout: string;
  stderr: string;
};

function parsePercentFromLine(line: string): number | null {
  const match = line.match(/(\d{1,3})%/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
}

/**
 * Run `npx playwright install chromium` and stream stdout/stderr lines via `onProgress`.
 */
export async function runPlaywrightChromiumInstallWithProgress(opts: {
  onProgress: (progress: BrowserInstallProgress) => void | Promise<void>;
  timeoutMs?: number;
}): Promise<PlaywrightInstallResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  await opts.onProgress({ phase: 'starting', message: 'Starting Playwright Chromium install' });

  return new Promise((resolve, reject) => {
    const child = spawn(npxCommand, ['playwright', 'install', 'chromium'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Playwright install timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    const emitLine = (source: 'stdout' | 'stderr', line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (source === 'stdout') stdoutChunks.push(trimmed);
      else stderrChunks.push(trimmed);
      const percent = parsePercentFromLine(trimmed);
      void opts.onProgress({
        phase: 'running',
        message: trimmed,
        line: trimmed,
        source,
        percent,
      });
    };

    let stdoutBuf = '';
    let stderrBuf = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      let idx: number;
      while ((idx = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, idx);
        stdoutBuf = stdoutBuf.slice(idx + 1);
        emitLine('stdout', line);
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      let idx: number;
      while ((idx = stderrBuf.indexOf('\n')) !== -1) {
        const line = stderrBuf.slice(0, idx);
        stderrBuf = stderrBuf.slice(idx + 1);
        emitLine('stderr', line);
      }
    });

    child.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (stdoutBuf.trim()) emitLine('stdout', stdoutBuf);
      if (stderrBuf.trim()) emitLine('stderr', stderrBuf);

      if (code === 0) {
        void opts.onProgress({ phase: 'ready', message: 'Chromium installed', percent: 100 });
        resolve({
          stdout: stdoutChunks.join('\n'),
          stderr: stderrChunks.join('\n'),
        });
        return;
      }

      const reason = signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`;
      const detail = [stderrChunks.join('\n'), stdoutChunks.join('\n')]
        .filter((part) => part.trim())
        .join('\n')
        .slice(0, 4000);
      reject(new Error(detail || `Playwright install failed with ${reason}`));
    });
  });
}
