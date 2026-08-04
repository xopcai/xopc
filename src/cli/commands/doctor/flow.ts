import { printJsonResults, printResults } from './format.js';
import type { CheckResult, DoctorCheck, DoctorContext } from './types.js';
import { checkNodeVersion } from './checks/node-version.js';
import { checkConfigHealth } from './checks/config-health.js';
import { checkStateIntegrity } from './checks/state-integrity.js';
import { checkDatabaseSchema } from './checks/database-schema.js';
import { checkProviderAuth } from './checks/provider-auth.js';
import { checkChannelConfig } from './checks/channel-config.js';
import { checkChannelPairingPending } from './checks/channel-pairing-pending.js';
import { checkGatewayHealth } from './checks/gateway-health.js';
import { checkSessionIntegrity } from './checks/session-integrity.js';
import { checkGatewayService } from './checks/gateway-service.js';
import { checkSecurityAudit } from './checks/security-audit.js';
import { checkWorkspaceStatus } from './checks/workspace-status.js';
import { checkVersionUpdate } from './checks/version-check.js';
import { checkChannelPlugins } from './checks/channel-plugins.js';
import { checkMigrations } from './checks/migrations.js';
import { checkImageProviders } from './checks/image-providers.js';

const DOCTOR_CHECKS: DoctorCheck[] = [
  checkVersionUpdate,
  checkNodeVersion,
  checkMigrations,
  checkConfigHealth,
  checkStateIntegrity,
  checkDatabaseSchema,
  checkProviderAuth,
  checkImageProviders,
  checkChannelConfig,
  checkChannelPairingPending,
  checkSecurityAudit,
  checkWorkspaceStatus,
  checkGatewayService,
  checkGatewayHealth,
  checkSessionIntegrity,
];

/**
 * Headless data collection — used by both CLI and gateway API.
 */
export async function collectDoctorResults(ctx: DoctorContext): Promise<CheckResult[]> {
  if (ctx.options.security) {
    return [await checkSecurityAudit(ctx)];
  }

  const results: CheckResult[] = [];

  for (const check of DOCTOR_CHECKS) {
    results.push(await check(ctx));
  }

  results.push(...(await checkChannelPlugins(ctx)));

  return results;
}

/**
 * CLI entry point — collect and print.
 */
export async function runDoctor(ctx: DoctorContext): Promise<CheckResult[]> {
  const results = await collectDoctorResults(ctx);

  if (ctx.options.json) {
    printJsonResults(results);
  } else {
    printResults(results, { security: ctx.options.security });
  }

  return results;
}
