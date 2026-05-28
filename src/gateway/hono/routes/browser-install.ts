import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import { acquireBrowserInstallLock } from '../../../browser/install-lock.js';
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

async function writeInstallProgress(
  stream: { writeSSE: (payload: { event: string; data: string }) => Promise<void> },
  progress: BrowserInstallProgress,
): Promise<void> {
  await stream.writeSSE({
    event: 'progress',
    data: JSON.stringify(progress),
  });
}

export function registerBrowserInstallRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { strictRateLimitMiddleware } = deps;

  authenticated.post('/api/browser/playwright/install/stream', strictRateLimitMiddleware, async (c) => {
    return streamSSE(c, async (stream) => {
      const lock = acquireBrowserInstallLock();
      if (!lock) {
        await stream.writeSSE({
          event: 'result',
          data: JSON.stringify({
            ok: false,
            error: 'busy',
            message: 'Another browser install is already in progress.',
          }),
        });
        return;
      }

      try {
        log.info('Gateway: starting streamed Playwright Chromium install');
        const payload = await runPlaywrightChromiumInstallWithProgress({
          onProgress: async (progress) => {
            await writeInstallProgress(stream, progress);
          },
        });
        await stream.writeSSE({
          event: 'result',
          data: JSON.stringify({ ok: true, payload }),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn({ errorMessage: message }, 'Gateway: streamed Playwright install failed');
        await stream.writeSSE({
          event: 'result',
          data: JSON.stringify({ ok: false, error: 'install-failed', message }),
        });
      } finally {
        lock.release();
      }
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
      const lock = acquireBrowserInstallLock();
      if (!lock) {
        await stream.writeSSE({
          event: 'result',
          data: JSON.stringify({
            ok: false,
            error: 'busy',
            message: 'Another browser install is already in progress.',
          }),
        });
        return;
      }

      try {
        log.info({ cacheDir, binaryPath: binaryPath ? '(custom)' : undefined }, 'Gateway: starting streamed CloakBrowser install');
        const {
          installCloakBrowser,
        } = await import('../../../browser/providers/cloakbrowser.js');
        const status = await installCloakBrowser({
          cacheDir,
          binaryPath,
          onProgress: async (progress) => {
            await writeInstallProgress(stream, progress);
          },
        });
        await stream.writeSSE({
          event: 'result',
          data: JSON.stringify({ ok: true, payload: status }),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn({ errorMessage: message }, 'Gateway: streamed CloakBrowser install failed');
        await stream.writeSSE({
          event: 'result',
          data: JSON.stringify({ ok: false, error: 'install-failed', message }),
        });
      } finally {
        lock.release();
      }
    });
  });
}
