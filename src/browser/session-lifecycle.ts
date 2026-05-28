import type { BrowserContext, Page } from 'playwright-core';

import { createLogger } from '../utils/logger.js';

const log = createLogger('BrowserLifecycle');

// ── Session Recording (Playwright Tracing) ──────────────────────────────────

export interface TracingOptions {
  /** Enable session recording. Default: false. */
  enabled: boolean;
  /** Directory to save trace files. */
  outputDir: string;
  /** Include screenshots in trace. Default: true. */
  screenshots?: boolean;
  /** Include DOM snapshots in trace. Default: false (large files). */
  snapshots?: boolean;
}

const DEFAULT_TRACING: TracingOptions = {
  enabled: false,
  outputDir: '/tmp/xopc-traces',
  screenshots: true,
  snapshots: false,
};

/**
 * Start Playwright tracing on a browser context for session recording.
 * Captures network, actions, and optionally screenshots/snapshots.
 */
export async function startTracing(
  context: BrowserContext,
  options?: Partial<TracingOptions>,
): Promise<void> {
  const opts = { ...DEFAULT_TRACING, ...options };
  if (!opts.enabled) return;

  try {
    await context.tracing.start({
      screenshots: opts.screenshots ?? true,
      snapshots: opts.snapshots ?? false,
    });
    log.info({ outputDir: opts.outputDir }, 'Session tracing started');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn({ errorMessage: msg }, `Failed to start tracing: ${msg}`);
  }
}

/**
 * Stop tracing and save the trace file.
 *
 * @returns Path to the saved trace file, or undefined if tracing was not active.
 */
export async function stopTracing(
  context: BrowserContext,
  options?: Partial<TracingOptions>,
): Promise<string | undefined> {
  const opts = { ...DEFAULT_TRACING, ...options };
  if (!opts.enabled) return undefined;

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const tracePath = `${opts.outputDir}/trace-${timestamp}.zip`;

  try {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(opts.outputDir, { recursive: true });
    await context.tracing.stop({ path: tracePath });
    log.info({ tracePath }, 'Session trace saved');
    return tracePath;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn({ errorMessage: msg }, `Failed to save trace: ${msg}`);
    return undefined;
  }
}

// ── Bot Detection Warning ───────────────────────────────────────────────────

/**
 * Known bot detection indicators in page content or response headers.
 * When detected, we log a warning so the agent/user can adjust strategy.
 */
const BOT_DETECTION_PATTERNS = [
  // Common CAPTCHA / challenge pages
  /captcha/i,
  /recaptcha/i,
  /hcaptcha/i,
  /cloudflare.*challenge/i,
  /please verify you are (a )?human/i,
  /access denied/i,
  /403 forbidden/i,
  /blocked.*bot/i,
  /automated.*browser/i,
  /unusual.*traffic/i,
  // Additional detection signals (aligned with CloakBrowser fingerprint checks)
  /just a moment/i,
  /checking your browser/i,
  /security check/i,
  /verify.*not.*robot/i,
  /turnstile/i,
  /browser.*verification/i,
];

export interface BotDetectionResult {
  detected: boolean;
  indicators: string[];
}

/**
 * Check a page for signs of bot detection / CAPTCHA challenge.
 * Returns indicators found. Non-blocking — for advisory logging only.
 */
export async function checkBotDetection(page: Page): Promise<BotDetectionResult> {
  const indicators: string[] = [];

  try {
    const title = await page.title();
    const bodyText = await page.evaluate(
      () => (globalThis as unknown as { document: { body: { innerText: string } } }).document.body.innerText.slice(0, 2000),
    ).catch(() => '');

    const combined = `${title}\n${bodyText}`;

    for (const pattern of BOT_DETECTION_PATTERNS) {
      const match = combined.match(pattern);
      if (match) {
        indicators.push(match[0]);
      }
    }

    if (indicators.length > 0) {
      log.warn(
        { url: page.url(), indicators },
        `Bot detection likely: ${indicators.join(', ')}`,
      );
    }
  } catch {
    // Page may be navigating or closed — ignore.
  }

  return { detected: indicators.length > 0, indicators };
}

// ── Orphan Process Cleanup ──────────────────────────────────────────────────

/**
 * Kill orphan Chromium processes that may have been left behind by crashed sessions.
 *
 * This is a best-effort cleanup. On macOS/Linux, searches for chromium/chrome
 * processes with the `--no-sandbox` flag (which xopc adds to all launches).
 *
 * @returns Number of processes killed.
 */
export async function cleanupOrphanProcesses(): Promise<number> {
  const { exec } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execAsync = promisify(exec);

  let killed = 0;
  try {
    // Find chromium processes launched with our specific args
    const { stdout } = await execAsync(
      'ps aux | grep -E "chromium|chrome" | grep "no-sandbox" | grep -v grep',
    ).catch(() => ({ stdout: '' }));

    const lines = stdout.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = Number(parts[1]);
      if (!pid || pid === process.pid) continue;

      try {
        process.kill(pid, 'SIGTERM');
        killed++;
        log.info({ pid }, 'Killed orphan browser process');
      } catch {
        // Process may have already exited
      }
    }

    if (killed > 0) {
      log.info({ killed }, `Cleaned up ${killed} orphan browser process(es)`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.debug({ errorMessage: msg }, 'Orphan cleanup skipped or failed');
  }

  return killed;
}
