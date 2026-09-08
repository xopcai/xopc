/** Playwright Chromium installation progress. */
export type BrowserInstallPhase =
  | 'starting'
  | 'downloading'
  | 'verifying'
  | 'extracting'
  | 'running'
  | 'ready';

export type BrowserInstallProgress = {
  phase: BrowserInstallPhase;
  message?: string;
  percent?: number | null;
  bytesReceived?: number;
  totalBytes?: number | null;
  /** Raw subprocess output line (Playwright install). */
  line?: string;
  source?: 'stdout' | 'stderr';
};
