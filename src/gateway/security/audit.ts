import type { ResolvedGatewayAuth } from '../auth.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('SecurityAudit');

export type SecurityAuditFinding = {
  checkId: string;
  severity: 'critical' | 'warn' | 'info';
  title: string;
  detail: string;
};

/**
 * Audit the gateway configuration at startup and log security findings.
 *
 * This provides an early-warning system similar to OpenClaw's `security audit`
 * command, adapted for xopc's configuration surface.
 */
export function auditGatewayConfig(params: {
  auth: ResolvedGatewayAuth;
  host?: string;
  corsOrigins?: string[];
}): SecurityAuditFinding[] {
  const findings: SecurityAuditFinding[] = [];

  // Check: no auth on non-loopback bind
  if (params.auth.mode === 'none') {
    const isLoopback = !params.host ||
      params.host === '127.0.0.1' ||
      params.host === 'localhost' ||
      params.host === '::1';

    if (!isLoopback) {
      findings.push({
        checkId: 'gateway.auth.none_on_network',
        severity: 'critical',
        title: 'Gateway has no authentication on a network-accessible address',
        detail: `Auth mode is "none" but gateway binds to ${params.host}. ` +
          'Any host on the network can access the gateway without credentials. ' +
          'Set gateway.auth.mode to "token" and configure a token.',
      });
    } else {
      findings.push({
        checkId: 'gateway.auth.none_loopback',
        severity: 'warn',
        title: 'Gateway authentication is disabled',
        detail: 'Auth mode is "none". This is acceptable for local development ' +
          'but should not be used in production.',
      });
    }
  }

  // Check: wildcard CORS origins
  if (params.corsOrigins?.includes('*')) {
    findings.push({
      checkId: 'gateway.cors.wildcard',
      severity: 'warn',
      title: 'CORS allows all origins',
      detail: 'corsOrigins includes "*". Any website can make authenticated API calls ' +
        'to the gateway if it can obtain the token.',
    });
  }

  // Check: too many CORS origins may indicate misconfiguration
  if (params.corsOrigins && params.corsOrigins.length > 20) {
    findings.push({
      checkId: 'gateway.cors.excessive_origins',
      severity: 'info',
      title: 'Large number of CORS origins configured',
      detail: `${params.corsOrigins.length} CORS origins configured. Review whether all are necessary.`,
    });
  }

  // Check: token mode without explicit token (auto-generated)
  if (params.auth.mode === 'token' && params.auth.token) {
    const envToken = process.env.XOPC_GATEWAY_TOKEN;
    if (!envToken) {
      findings.push({
        checkId: 'gateway.auth.auto_generated_token',
        severity: 'info',
        title: 'Gateway token was auto-generated',
        detail: 'No explicit XOPC_GATEWAY_TOKEN set. The token was auto-generated and will ' +
          'change on each restart. Set XOPC_GATEWAY_TOKEN for a stable token.',
      });
    }
  }

  // Emit findings as log entries
  for (const finding of findings) {
    const logData = { checkId: finding.checkId, detail: finding.detail };
    switch (finding.severity) {
      case 'critical':
        log.error(logData, `Security audit: ${finding.title}`);
        break;
      case 'warn':
        log.warn(logData, `Security audit: ${finding.title}`);
        break;
      case 'info':
        log.info(logData, `Security audit: ${finding.title}`);
        break;
    }
  }

  return findings;
}
