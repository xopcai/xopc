import type { Hono } from 'hono';

import { buildSupportInvestigationPrompt } from '../../../support/build-support-investigation-prompt.js';
import { collectSupportReport } from '../../../support/collect-support-report.js';
import { SupportReportInputSchema } from '../../../support/types.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function registerSupportRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  authenticated.post('/api/support/report', deps.strictRateLimitMiddleware, async (c) => {
    const parsed = SupportReportInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ ok: false, error: 'Invalid support report input' }, 400);
    }

    const health = deps.service.getHealth();
    const channels = Object.fromEntries(
      deps.service.getChannelsStatus().map((channel) => [
        channel.name,
        !channel.enabled ? 'disabled' : channel.connected ? 'connected' : 'disconnected',
      ]),
    );
    const report = await collectSupportReport(parsed.data, {
      runtime: {
        gatewayStatus: health.status,
        gatewayVersion: health.version,
        gatewayUptimeMs: health.uptime,
        channels,
      },
    });
    return c.json({
      ok: true,
      report,
      investigationPrompt: buildSupportInvestigationPrompt(report),
    });
  });
}
