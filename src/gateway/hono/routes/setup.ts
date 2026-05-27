/**
 * Setup routes — `POST /api/setup/:domain/:action` and
 * `GET /api/setup/manifest`.
 *
 * Bridges the M1 `runSetupHeadless` pipeline to HTTP, giving the WebUI and
 * any other client a single write path that:
 *   - validates against the same Zod schema the CLI uses
 *   - returns the same `SetupOutcome` JSON shape the CLI emits with `--json`
 *   - supports `dryRun` so forms can preview diffs before committing
 *
 * The setup CLI command modules self-register their handlers at module load
 * via `registerSetupHandler`. We force-load every module on first request so
 * registrations are populated before dispatch.
 */

import type { Hono } from 'hono';

import {
  ensureSetupHandlersLoaded,
  getSetupHandler,
  serializeSetupManifest,
} from '../../../cli/commands/setup-shared/index.js';
import { createLogger } from '../../../utils/logger.js';

import type { AuthenticatedRouteDeps } from './deps.js';

const log = createLogger('Gateway:Setup');

interface SetupRequestBody {
  fields?: Record<string, unknown>;
  dryRun?: boolean;
}

export function registerSetupRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
  const { service } = deps;

  app.get('/api/setup/manifest', async (c) => {
    await ensureSetupHandlersLoaded();
    const manifest = serializeSetupManifest();
    return c.json({ ok: true, ...manifest });
  });

  app.post('/api/setup/:domain/:action', async (c) => {
    await ensureSetupHandlersLoaded();

    const domain = c.req.param('domain');
    const action = c.req.param('action');
    const entry = getSetupHandler(domain, action);
    if (!entry) {
      return c.json(
        {
          ok: false,
          action,
          domain,
          changedPaths: [],
          dryRun: false,
          errors: [{ message: `No setup handler registered for ${domain}/${action}.` }],
        },
        404,
      );
    }

    let body: SetupRequestBody = {};
    try {
      body = (await c.req.json()) as SetupRequestBody;
    } catch {
      // Body is optional; treat missing/invalid JSON as empty.
      body = {};
    }
    const fields = body.fields && typeof body.fields === 'object' ? body.fields : {};
    const dryRun = Boolean(body.dryRun);

    const outcome = await entry.handler({
      configPath: service.currentConfigPath,
      fields,
      // The HTTP path always wants structured output; `json: true` is a no-op
      // for `runSetupHeadless` (it never writes to stdout), but kept for
      // `SetupRunOptions` shape parity.
      options: { dryRun, json: true },
    });

    // After a successful write, reload service runtime state so channel
    // plugins, agents, etc. pick up the new config — same path the existing
    // PATCH /api/config endpoint relies on.
    if (outcome.ok && !outcome.dryRun && outcome.changedPaths.length > 0) {
      try {
        await service.reloadConfig();
      } catch (err) {
        log.warn({ err, domain, action }, 'Setup write succeeded but reloadConfig failed');
      }
    }

    const status = outcome.ok ? 200 : 400;
    return c.json(outcome, status);
  });
}
