import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import { loadConfig } from '../../../config/index.js';
import { acquireUpdateLock } from '../../../infra/update-lock.js';
import {
  DEFAULT_PACKAGE_CHANNEL,
  normalizeUpdateChannel,
  type UpdateChannel,
} from '../../../infra/update-channels.js';
import {
  formatUpdateApiResult,
  runGatewayUpdateWithPostSteps,
  type UpdateRunResult,
} from '../../../infra/update-runner.js';
import { getUpdateAvailable, runGatewayUpdateCheck } from '../../../infra/update-startup.js';
import { PACKAGE_VERSION } from '../../../package-version.js';
import { createLogger } from '../../../utils/logger.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const log = createLogger('GatewayUpdate');

function mapUpdateFailure(result: UpdateRunResult, channel: UpdateChannel) {
  const apiResult = formatUpdateApiResult(result, channel);
  const message =
    typeof apiResult.message === 'string'
      ? apiResult.message
      : result.reason ?? 'Update failed';
  return { apiResult, message };
}

export function registerUpdateRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { strictRateLimitMiddleware, service } = deps;

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

  authenticated.post('/api/update/run', strictRateLimitMiddleware, async (c) => {
    const config = loadConfig(service.getHealth().configPath);
    const channel = normalizeUpdateChannel(config.update?.channel) ?? DEFAULT_PACKAGE_CHANNEL;

    const lock = await acquireUpdateLock('gateway');
    if (!lock) {
      return c.json(
        { ok: false, error: 'busy', message: 'Another update is already in progress.' },
        409,
      );
    }

    try {
      log.info({ channel }, 'Gateway: starting in-process update');
      const result = await runGatewayUpdateWithPostSteps({
        channel,
        cwd: process.cwd(),
        argv1: process.argv[1],
        triggerInProcessRestart: () => service.triggerGatewayProcessRestart(),
      });
      const apiResult = formatUpdateApiResult(result, channel);
      if (result.status === 'error') {
        const { message } = mapUpdateFailure(result, channel);
        log.warn({ channel, reason: result.reason }, 'Gateway: update failed');
        return c.json({
          ok: false,
          error: 'update-failed',
          message,
          result: apiResult,
        });
      }
      log.info({ channel, mode: result.mode }, 'Gateway: update finished');
      return c.json({ ok: true, result: apiResult });
    } catch (err) {
      log.error({ err, channel }, 'Gateway: update threw');
      return c.json(
        {
          ok: false,
          error: 'internal',
          message: err instanceof Error ? err.message : String(err),
        },
        500,
      );
    } finally {
      await lock.release();
    }
  });

  authenticated.post('/api/update/run/stream', strictRateLimitMiddleware, async (c) => {
    const config = loadConfig(service.getHealth().configPath);
    const channel = normalizeUpdateChannel(config.update?.channel) ?? DEFAULT_PACKAGE_CHANNEL;

    return streamSSE(c, async (stream) => {
      const lock = await acquireUpdateLock('gateway');
      if (!lock) {
        await stream.writeSSE({
          event: 'result',
          data: JSON.stringify({
            ok: false,
            error: 'busy',
            message: 'Another update is already in progress.',
          }),
        });
        return;
      }

      try {
        log.info({ channel }, 'Gateway: starting streamed in-process update');
        const result = await runGatewayUpdateWithPostSteps({
          channel,
          cwd: process.cwd(),
          argv1: process.argv[1],
          triggerInProcessRestart: () => service.triggerGatewayProcessRestart(),
          progress: {
            onStepStart: async (step) => {
              await stream.writeSSE({
                event: 'progress',
                data: JSON.stringify({
                  line: `[${step.index + 1}/${step.total}] ${step.name}: ${step.command}`,
                  source: 'stdout',
                }),
              });
            },
            onStepComplete: async (step) => {
              if (step.stderrTail) {
                await stream.writeSSE({
                  event: 'progress',
                  data: JSON.stringify({ line: step.stderrTail, source: 'stderr' }),
                });
              }
            },
          },
        });

        const apiResult = formatUpdateApiResult(result, channel);
        if (result.status === 'error') {
          const { message } = mapUpdateFailure(result, channel);
          await stream.writeSSE({
            event: 'result',
            data: JSON.stringify({
              ok: false,
              error: 'update-failed',
              message,
              result: apiResult,
              reason: result.reason,
            }),
          });
          return;
        }

        await stream.writeSSE({
          event: 'result',
          data: JSON.stringify({ ok: true, result: apiResult }),
        });
      } catch (err) {
        log.error({ err, channel }, 'Gateway: streamed update threw');
        await stream.writeSSE({
          event: 'result',
          data: JSON.stringify({
            ok: false,
            error: 'internal',
            message: err instanceof Error ? err.message : String(err),
          }),
        });
      } finally {
        await lock.release();
      }
    });
  });
}
