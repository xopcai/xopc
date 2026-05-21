import type { ResolvedGatewayAuth } from '../auth.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('SecurityAudit');

export type SecurityAuditFinding = {
  checkId: string;
  severity: 'critical' | 'warn' | 'info';
  title: string;
  detail: string;
  /** Actionable remediation suggestion (aligned with OpenClaw audit format). */
  remediation?: string;
};

/** Minimum token length to resist brute-force even with rate limiting. */
const MIN_AUDIT_TOKEN_LENGTH = 22;

function isLoopbackHost(host: string | undefined): boolean {
  return !host ||
    host === '127.0.0.1' ||
    host === 'localhost' ||
    host === '::1';
}

/**
 * Audit the gateway configuration at startup and log security findings.
 *
 * This provides an early-warning system similar to OpenClaw's `security audit`
 * command, adapted for xopc's configuration surface. Aligned with OpenClaw's
 * `collectGatewayConfigFindings` coverage.
 */
export function auditGatewayConfig(params: {
  auth: ResolvedGatewayAuth;
  host?: string;
  corsOrigins?: string[];
  /** Rate limit configuration for auth failures. */
  rateLimitEnabled?: boolean;
  /** Whether HTTPS / TLS termination is in use. */
  tlsEnabled?: boolean;
}): SecurityAuditFinding[] {
  const findings: SecurityAuditFinding[] = [];
  const loopback = isLoopbackHost(params.host);

  // ── Auth mode checks ────────────────────────────────────────────────
  if (params.auth.mode === 'none') {
    if (!loopback) {
      findings.push({
        checkId: 'gateway.auth.none_on_network',
        severity: 'critical',
        title: 'Gateway has no authentication on a network-accessible address',
        detail: `Auth mode is "none" but gateway binds to ${params.host}. ` +
          'Any host on the network can access the gateway without credentials.',
        remediation: 'Set gateway.auth.mode to "token" and configure a strong token ' +
          '(e.g. `openssl rand -hex 32`).',
      });
    } else {
      findings.push({
        checkId: 'gateway.auth.none_loopback',
        severity: 'warn',
        title: 'Gateway authentication is disabled',
        detail: 'Auth mode is "none". This is acceptable for local development ' +
          'but should not be used in production.',
        remediation: 'Set gateway.auth.mode to "token" for production use.',
      });
    }
  }

  // ── Token strength checks ───────────────────────────────────────────
  if (params.auth.mode === 'token' && params.auth.token) {
    const token = params.auth.token;

    // Short token warning (beyond known-weak-secrets startup assertion)
    if (token.length < MIN_AUDIT_TOKEN_LENGTH) {
      findings.push({
        checkId: 'gateway.auth.short_token',
        severity: 'warn',
        title: 'Gateway token is short',
        detail: `Token length is ${token.length} characters. Short tokens are vulnerable ` +
          'to brute-force even with rate limiting.',
        remediation: `Use a token of at least ${MIN_AUDIT_TOKEN_LENGTH} characters ` +
          '(e.g. `openssl rand -hex 32`).',
      });
    }

    // Low entropy: all same character
    if (/^(.)\1+$/.test(token)) {
      findings.push({
        checkId: 'gateway.auth.low_entropy_token',
        severity: 'critical',
        title: 'Gateway token has extremely low entropy',
        detail: 'Token consists of a single repeated character, making it trivially guessable.',
        remediation: 'Generate a cryptographically random token: `openssl rand -hex 32`.',
      });
    }

    // Auto-generated (no env var set)
    const envToken = process.env.XOPC_GATEWAY_TOKEN;
    if (!envToken) {
      findings.push({
        checkId: 'gateway.auth.auto_generated_token',
        severity: 'info',
        title: 'Gateway token was auto-generated',
        detail: 'No explicit XOPC_GATEWAY_TOKEN set. The token was auto-generated and will ' +
          'change on each restart.',
        remediation: 'Set XOPC_GATEWAY_TOKEN environment variable for a stable token.',
      });
    }
  }

  // ── CORS checks ─────────────────────────────────────────────────────
  if (params.corsOrigins?.includes('*')) {
    findings.push({
      checkId: 'gateway.cors.wildcard',
      severity: !loopback ? 'critical' : 'warn',
      title: 'CORS allows all origins',
      detail: 'corsOrigins includes "*". Any website can make authenticated API calls ' +
        'to the gateway if it can obtain the token.',
      remediation: 'Replace "*" with explicit allowed origins ' +
        '(e.g. ["http://localhost:18790"]).',
    });
  }

  if (params.corsOrigins && params.corsOrigins.length > 20) {
    findings.push({
      checkId: 'gateway.cors.excessive_origins',
      severity: 'info',
      title: 'Large number of CORS origins configured',
      detail: `${params.corsOrigins.length} CORS origins configured. Review whether all are necessary.`,
    });
  }

  // Non-loopback without explicit CORS origins — any browser with the token can call the API
  if (!loopback && (!params.corsOrigins || params.corsOrigins.length === 0)) {
    findings.push({
      checkId: 'gateway.cors.no_explicit_origins',
      severity: 'warn',
      title: 'No explicit CORS origins on network-accessible gateway',
      detail: 'Gateway is bound to a non-loopback address but no corsOrigins are configured. ' +
        'The default localhost origins may not match the actual access URL.',
      remediation: 'Set gateway.corsOrigins to the URLs that should be allowed to access the gateway.',
    });
  }

  // ── Rate limit check ────────────────────────────────────────────────
  if (!loopback && params.auth.mode !== 'none' && params.rateLimitEnabled === false) {
    findings.push({
      checkId: 'gateway.auth.no_rate_limit',
      severity: 'warn',
      title: 'No auth rate limiting on network-accessible gateway',
      detail: 'Gateway is bound to a non-loopback address but auth rate limiting is disabled. ' +
        'This allows unlimited brute-force authentication attempts.',
      remediation: 'Set gateway.auth.rateLimit ' +
        '(e.g. { maxAttempts: 10, windowMs: 60000, lockoutMs: 300000 }).',
    });
  }

  // ── TLS / transport security ────────────────────────────────────────
  if (!loopback && !params.tlsEnabled) {
    findings.push({
      checkId: 'gateway.transport.no_tls',
      severity: 'warn',
      title: 'No TLS on network-accessible gateway',
      detail: 'Gateway is bound to a non-loopback address without TLS. ' +
        'Tokens and data are transmitted in plaintext.',
      remediation: 'Use a reverse proxy with TLS (e.g. Caddy, nginx) or enable the tunnel feature.',
    });
  }

  // ── Dangerous config: 0.0.0.0 bind ─────────────────────────────────
  if (params.host === '0.0.0.0') {
    findings.push({
      checkId: 'gateway.bind.all_interfaces',
      severity: 'warn',
      title: 'Gateway binds to all network interfaces',
      detail: 'Binding to 0.0.0.0 exposes the gateway on all network interfaces ' +
        'including public networks. Prefer 127.0.0.1 for local-only access.',
      remediation: 'Set gateway.host to "127.0.0.1" unless remote access is required.',
    });
  }

  // ── Emit findings as log entries ────────────────────────────────────
  for (const finding of findings) {
    const logData = {
      checkId: finding.checkId,
      detail: finding.detail,
      ...(finding.remediation ? { remediation: finding.remediation } : {}),
    };
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
