import type { Hono } from 'hono';

import { loadConfig } from '../../../config/index.js';
import { detectInstallKind, resolvePackageRoot } from '../../../infra/update-check.js';
import { DEFAULT_PACKAGE_CHANNEL, normalizeUpdateChannel } from '../../../infra/update-channels.js';
import { runAutoUpdateCommand } from '../../../infra/update-runner.js';
import { getUpdateAvailable, runGatewayUpdateCheck } from '../../../infra/update-startup.js';
import { PACKAGE_VERSION } from '../../../package-version.js';
import { createLogger } from '../../../utils/logger.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const log = createLogger('GatewayUpdate');

let updateRunInFlight = false;

function parseUpdateCliJson(stdout: string): Record<string, unknown> | null {
  const t = stdout.trim();
  if (!t) return null;
  try {
    const parsed = JSON.parse(t) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    const lines = t.split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]!.trim();
      if (!line.startsWith('{')) continue;
      try {
        const parsed = JSON.parse(line) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // try previous line
      }
    }
  }
  return null;
}

export function registerUpdateRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { strictRateLimitMiddleware, service } = deps;

  /**
   * GET /api/update/status
   */
  authenticated.get('/api/update/status', (c) => {
    const update = getUpdateAvailable();
    return c.json({
      ok: true,
      payload: {
        currentVersion: PACKAGE_VERSION,
        updateAvailable: update !== null,
        latestVersion: update?.latestVersion ?? null,
        channel: update?.channel ?? null,
      },
    });
  });

  /**
   * POST /api/update/check
   */
  authenticated.post('/api/update/check', strictRateLimitMiddleware, async (c) => {
    const config = loadConfig(service.getHealth().configPath);
    await runGatewayUpdateCheck({
      config,
      force: true,
      onUpdateAvailableChange: (update) => {
        service.emit('update.available', update);
      },
    });
    const result = getUpdateAvailable();
    return c.json({
      ok: true,
      payload: {
        currentVersion: PACKAGE_VERSION,
        updateAvailable: result !== null,
        latestVersion: result?.latestVersion ?? null,
        channel: result?.channel ?? null,
      },
    });
  });

  /**
   * POST /api/update/run — one-click npm install (OpenClaw-style). Rejects git checkouts.
   */
  authenticated.post('/api/update/run', strictRateLimitMiddleware, async (c) => {
    if (updateRunInFlight) {
      return c.json(
        {
          ok: false,
          error: 'busy',
          message: 'Another update is already in progress.',
        },
        409,
      );
    }

    const configPath = service.getHealth().configPath;
    const config = loadConfig(configPath);
    const channel =
      normalizeUpdateChannel(config.update?.channel) ?? DEFAULT_PACKAGE_CHANNEL;

    const root = await resolvePackageRoot();
    if (root) {
      const kind = await detectInstallKind(root);
      if (kind === 'git') {
        return c.json(
          {
            ok: false,
            error: 'git-checkout',
            message:
              'Running from a git checkout. Use `git pull` in the repo, or install from npm to use one-click update.',
          },
          400,
        );
      }
    }

    updateRunInFlight = true;
    try {
      log.info({ channel }, 'Gateway: starting one-click npm update');
      const result = await runAutoUpdateCommand({ channel, root });
      const parsed = parseUpdateCliJson(result.stdout ?? '');

      if (result.ok && parsed?.status === 'skipped' && parsed?.reason === 'git-checkout') {
        return c.json(
          {
            ok: false,
            error: 'git-checkout',
            message: String(parsed.message ?? 'Git checkout — use git pull instead.'),
          },
          400,
        );
      }

      if (!result.ok) {
        log.warn(
          { channel, exitCode: result.exitCode, reason: result.reason },
          'Gateway: one-click npm update failed',
        );
        return c.json({
          ok: false,
          error: 'update-failed',
          message: result.stderr?.trim() || result.reason || `Update exited with code ${result.exitCode ?? 'unknown'}`,
          result: parsed,
        });
      }

      log.info({ channel }, 'Gateway: one-click npm update finished');
      // Do not run registry check here: the process still reports the old `PACKAGE_VERSION`
      // until the gateway is restarted, which would keep `update available` set incorrectly.
      return c.json({ ok: true, result: parsed });
    } catch (err) {
      log.error({ err, channel }, 'Gateway: one-click npm update threw');
      return c.json(
        {
          ok: false,
          error: 'internal',
          message: err instanceof Error ? err.message : String(err),
        },
        500,
      );
    } finally {
      updateRunInFlight = false;
    }
  });
}
