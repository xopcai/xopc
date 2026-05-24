import type { Hono } from 'hono';

import { collectDoctorResults } from '../../../cli/commands/doctor/flow.js';
import { resolveConfigPath } from '../../../config/paths.js';
import { resolveStateDir } from '../../../config/paths-state.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function registerDoctorRoutes(authenticated: Hono, _deps: AuthenticatedRouteDeps): void {
  authenticated.get('/api/doctor', async (c) => {
    const deep = c.req.query('deep') === 'true';
    const security = c.req.query('security') === 'true';
    const configPath = process.env.XOPC_CONFIG_PATH || resolveConfigPath();
    const stateDir = resolveStateDir();

    const results = await collectDoctorResults({
      configPath,
      stateDir,
      options: { fix: false, json: true, deep, security },
    });

    return c.json({
      ok: results.every((r) => r.status !== 'fail'),
      checks: results.map((r) => ({
        id: r.id,
        label: r.label,
        status: r.status,
        message: r.message,
        hints: r.hints,
        fixed: r.fixed ?? false,
        ...(r.findings ? { findings: r.findings } : {}),
      })),
    });
  });
}
