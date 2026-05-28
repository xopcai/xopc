import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import {
  acquireBrowserInstallLock,
  cancelBrowserInstall,
  type BrowserInstallKind,
} from '../../../browser/install-lock.js';
import type { BrowserInstallProgress } from '../../../browser/install-progress.js';
import { runPlaywrightChromiumInstallWithProgress } from '../../../browser/providers/playwright-install.js';
import { createLogger } from '../../../utils/logger.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const log = createLogger('GatewayBrowserInstall');

function parseCloakInstallBody(body: unknown): { cacheDir?: string; binaryPath?: string } {
  const input = body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
  const cacheDir = typeof input.cacheDir === 'string' && input.cacheDir.trim()
    ? input.cacheDir.trim()
    : undefined;
  const binaryPath = typeof input.binaryPath === 'string' && input.binaryPath.trim()
    ? input.binaryPath.trim()
    : undefined;
  return { cacheDir, binaryPath };
}

function isInstallCancelled(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return err instanceof Error && err.message === 'Install cancelled';
}

async function writeInstallProgress(
  stream: { writeSSE: (payload: { event: string; data: string }) => Promise<void> },
  progress: BrowserInstallProgress,
): Promise<void> {
  try {
    await stream.writeSSE({
      event: 'progress',
      data: JSON.stringify(progress),
    });
  } catch {
    // Client navigated away — install continues unless user hit cancel.
  }
}

async function runBrowserInstallStream(
  kind: BrowserInstallKind,
  stream: { writeSSE: (payload: { event: string; data: string }) => Promise<void> },
  run: (signal: AbortSignal) => Promise<unknown>,
): Promise<void> {
  const lock = acquireBrowserInstallLock(kind);
  if (!lock) {
    await stream.writeSSE({
      event: 'result',
      data: JSON.stringify({
        ok: false,
        error: 'busy',
        message: 'An install for this browser type is already in progress.',
      }),
    });
    return;
  }

  try {
    const payload = await run(lock.signal);
    try {
      await stream.writeSSE({
        event: 'result',
        data: JSON.stringify({ ok: true, payload }),
      });
    } catch {
      log.info({ kind }, 'Gateway: browser install finished after client disconnected');
    }
  } catch (err) {
    if (isInstallCancelled(err, lock.signal)) {
      log.info({ kind }, 'Gateway: browser install cancelled by user');
      try {
        await stream.writeSSE({
          event: 'result',
          data: JSON.stringify({
            ok: false,
            error: 'cancelled',
            message: 'Install cancelled',
          }),
        });
      } catch {
        /* client gone */
      }
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ kind, errorMessage: message }, 'Gateway: streamed browser install failed');
    try {
      await stream.writeSSE({
        event: 'result',
        data: JSON.stringify({ ok: false, error: 'install-failed', message }),
      });
    } catch {
      /* client gone */
    }
  } finally {
    lock.release();
  }
}

function registerInstallCancelRoute(
  authenticated: Hono,
  deps: AuthenticatedRouteDeps,
  kind: BrowserInstallKind,
  path: string,
): void {
  const { strictRateLimitMiddleware } = deps;
  authenticated.post(path, strictRateLimitMiddleware, (c) => {
    const cancelled = cancelBrowserInstall(kind);
    return c.json({ ok: true, payload: { cancelled } });
  });
}

export function registerBrowserInstallRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { strictRateLimitMiddleware } = deps;

  registerInstallCancelRoute(
    authenticated,
    deps,
    'playwright',
    '/api/browser/playwright/install/cancel',
  );
  registerInstallCancelRoute(
    authenticated,
    deps,
    'cloakbrowser',
    '/api/browser/cloakbrowser/install/cancel',
  );

  authenticated.post('/api/browser/playwright/install/stream', strictRateLimitMiddleware, async (c) => {
    return streamSSE(c, async (stream) => {
      await runBrowserInstallStream('playwright', stream, async (signal) => {
        log.info('Gateway: starting streamed Playwright Chromium install');
        await runPlaywrightChromiumInstallWithProgress({
          signal,
          onProgress: async (progress) => {
            await writeInstallProgress(stream, progress);
          },
        });
        const { playwrightChromiumDoctor } = await import('../../../browser/providers/playwright-doctor.js');
        const payload = await playwrightChromiumDoctor();
        if (!payload.installed) {
          throw new Error(payload.reason ?? 'Chromium not found after install');
        }
        return payload;
      });
    });
  });

  authenticated.post('/api/browser/cloakbrowser/install/stream', strictRateLimitMiddleware, async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const { cacheDir, binaryPath } = parseCloakInstallBody(body);

    return streamSSE(c, async (stream) => {
      await runBrowserInstallStream('cloakbrowser', stream, async (signal) => {
        log.info(
          { cacheDir, binaryPath: binaryPath ? '(custom)' : undefined },
          'Gateway: starting streamed CloakBrowser install',
        );
        const { installCloakBrowser } = await import('../../../browser/providers/cloakbrowser.js');
        return installCloakBrowser({
          cacheDir,
          binaryPath,
          signal,
          onProgress: async (progress) => {
            await writeInstallProgress(stream, progress);
          },
        });
      });
    });
  });
}
