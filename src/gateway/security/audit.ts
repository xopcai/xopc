import type { Config } from '../../config/schema.js';
import type { ResolvedGatewayAuth } from '../auth.js';
import { resolveGatewayAuth, assertGatewayAuthConfigured } from '../auth.js';
import { isAuthRateLimitGloballyDisabled, isGatewayStrictSecurityEnabled } from '../auth-rate-limit.js';
import { assertGatewayRuntimeConfig } from '../runtime-config.js';
import { resolveGatewayListenPlan } from '../listen.js';
import {
  collectExposureConflicts,
  isRemoteGatewayInsecure,
  isTailnetBindUnavailable,
} from '../../remote-access/exposure-guards.js';
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

function normalizeCorsOrigins(cfg: Config): string[] {
  return (cfg.gateway?.corsOrigins ?? [])
    .map((value) => value.trim())
    .filter(Boolean);
}

function resolveAuditInputs(cfg: Config, env: NodeJS.ProcessEnv = process.env): {
  auth: ResolvedGatewayAuth;
  bindHost: string;
  corsOrigins: string[];
  rateLimitEnabled: boolean;
  tlsEnabled: boolean;
  trustedProxies?: string[];
  allowRealIpFallback: boolean;
  dangerouslyAllowHostHeaderOriginFallback: boolean;
  loopback: boolean;
} {
  const auth = resolveGatewayAuth({ authConfig: cfg.gateway?.auth, env });
  const plan = resolveGatewayListenPlan({ cfg });
  const corsOrigins = normalizeCorsOrigins(cfg);
  const rateLimitEnabled =
    cfg.gateway?.auth?.rateLimit?.enabled !== false &&
    !isAuthRateLimitGloballyDisabled();
  const tlsEnabled =
    cfg.tunnel?.enabled === true ||
    (cfg.gateway?.tailscale?.mode ?? 'off') !== 'off' ||
    cfg.gateway?.tls?.enabled === true;
  const loopback = isLoopbackHost(plan.bindHost);

  return {
    auth,
    bindHost: plan.bindHost,
    corsOrigins,
    rateLimitEnabled,
    tlsEnabled,
    trustedProxies: cfg.gateway?.trustedProxies,
    allowRealIpFallback: cfg.gateway?.allowRealIpFallback === true,
    dangerouslyAllowHostHeaderOriginFallback:
      cfg.gateway?.dangerouslyAllowHostHeaderOriginFallback === true,
    loopback,
  };
}

/**
 * Pure gateway config audit (no logging). Shared by startup audit and `xopc doctor`.
 */
export function collectGatewayConfigFindings(params: {
  auth: ResolvedGatewayAuth;
  bindHost?: string;
  corsOrigins?: string[];
  rateLimitEnabled?: boolean;
  tlsEnabled?: boolean;
  trustedProxies?: string[];
  allowRealIpFallback?: boolean;
  dangerouslyAllowHostHeaderOriginFallback?: boolean;
  strictSecurityEnabled?: boolean;
  rateLimitConfigured?: boolean;
}): SecurityAuditFinding[] {
  const findings: SecurityAuditFinding[] = [];
  const loopback = isLoopbackHost(params.bindHost);

  if (params.auth.mode === 'none') {
    if (!loopback) {
      findings.push({
        checkId: 'gateway.auth.none_on_network',
        severity: 'critical',
        title: 'Gateway has no authentication on a network-accessible address',
        detail: `Auth mode is "none" but gateway binds to ${params.bindHost}. ` +
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

  if (
    !loopback &&
    params.auth.mode === 'token' &&
    !params.auth.token?.trim()
  ) {
    findings.push({
      checkId: 'gateway.auth.missing_token_on_network',
      severity: 'critical',
      title: 'Network-accessible gateway has no auth token configured',
      detail: 'gateway.auth.mode is "token" but no token is configured for a non-loopback bind.',
      remediation: 'Set gateway.auth.token or XOPC_GATEWAY_TOKEN before binding to the network.',
    });
  }

  if (
    !loopback &&
    params.auth.mode === 'password' &&
    !params.auth.password?.trim()
  ) {
    findings.push({
      checkId: 'gateway.auth.missing_password_on_network',
      severity: 'critical',
      title: 'Network-accessible gateway has no auth password configured',
      detail: 'gateway.auth.mode is "password" but no password is configured for a non-loopback bind.',
      remediation: 'Set gateway.auth.password or XOPC_GATEWAY_PASSWORD before binding to the network.',
    });
  }

  if (params.auth.mode === 'token' && params.auth.token) {
    const token = params.auth.token;

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

    if (/^(.)\1+$/.test(token)) {
      findings.push({
        checkId: 'gateway.auth.low_entropy_token',
        severity: 'critical',
        title: 'Gateway token has extremely low entropy',
        detail: 'Token consists of a single repeated character, making it trivially guessable.',
        remediation: 'Generate a cryptographically random token: `openssl rand -hex 32`.',
      });
    }

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

  if (
    !loopback &&
    (!params.corsOrigins || params.corsOrigins.length === 0) &&
    params.dangerouslyAllowHostHeaderOriginFallback !== true
  ) {
    findings.push({
      checkId: 'gateway.cors.no_explicit_origins',
      severity: 'critical',
      title: 'No explicit CORS origins on network-accessible gateway',
      detail: 'Gateway is bound to a non-loopback address but no corsOrigins are configured. ' +
        'Startup guards will refuse to bind until origins are set.',
      remediation:
        'Set gateway.corsOrigins to the browser URLs that should access the gateway, ' +
        'or enable gateway.dangerouslyAllowHostHeaderOriginFallback only if you understand the CSRF risk.',
    });
  }

  if (
    !loopback &&
    params.auth.mode !== 'none' &&
    params.auth.mode !== 'trusted-proxy' &&
    params.rateLimitEnabled === false
  ) {
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

  if (
    !loopback &&
    params.strictSecurityEnabled === true &&
    params.rateLimitConfigured !== true
  ) {
    findings.push({
      checkId: 'gateway.security.strict_no_rate_limit',
      severity: 'critical',
      title: 'Strict security requires explicit auth rate limit configuration',
      detail: 'gateway.security.strict is enabled on a network-accessible bind but gateway.auth.rateLimit is missing.',
      remediation:
        'Set gateway.auth.rateLimit (e.g. { maxAttempts: 10, windowMs: 60000, blockDurationMs: 300000 }).',
    });
  }

  if (!loopback && !params.tlsEnabled) {
    findings.push({
      checkId: 'gateway.transport.no_tls',
      severity: 'warn',
      title: 'No TLS on network-accessible gateway',
      detail: 'Gateway is bound to a non-loopback address without TLS termination. ' +
        'Tokens and data are transmitted in plaintext unless a reverse proxy or tunnel handles HTTPS.',
      remediation:
        'Enable the tunnel feature (`tunnel.enabled`), terminate TLS at a reverse proxy (Caddy/nginx), ' +
        'or bind to loopback and access via SSH/VPN.',
    });
  }

  if (params.bindHost === '0.0.0.0' || params.bindHost === '::') {
    findings.push({
      checkId: 'gateway.bind.all_interfaces',
      severity: 'warn',
      title: 'Gateway binds to all network interfaces',
      detail: 'Binding to all interfaces exposes the gateway on every network interface. ' +
        'Prefer loopback unless remote access is required.',
      remediation: 'Set gateway.bind to "loopback" unless remote access is required.',
    });
  }

  if (params.auth.mode === 'trusted-proxy') {
    const trustedProxies = params.trustedProxies ?? [];
    const trustedProxyConfig = params.auth.trustedProxy;

    findings.push({
      checkId: 'gateway.trusted_proxy_auth',
      severity: 'critical',
      title: 'Trusted-proxy auth mode enabled',
      detail:
        'gateway.auth.mode="trusted-proxy" delegates authentication to a reverse proxy. ' +
        'Ensure your proxy terminates TLS and authenticates users; gateway.trustedProxies ' +
        'must only list your proxy server IPs.',
      remediation:
        'Verify: (1) Proxy terminates TLS and authenticates users. ' +
        '(2) gateway.trustedProxies is restricted to proxy IPs only. ' +
        '(3) Direct access to the gateway port is blocked by firewall.',
    });

    if (trustedProxies.length === 0) {
      findings.push({
        checkId: 'gateway.trusted_proxy_no_proxies',
        severity: 'critical',
        title: 'Trusted-proxy auth enabled but no trusted proxies configured',
        detail:
          'gateway.auth.mode="trusted-proxy" but gateway.trustedProxies is empty. ' +
          'All requests will be rejected and startup guards will fail.',
        remediation: 'Set gateway.trustedProxies to the IP(s) of your reverse proxy.',
      });
    }

    if (!trustedProxyConfig?.userHeader) {
      findings.push({
        checkId: 'gateway.trusted_proxy_no_user_header',
        severity: 'critical',
        title: 'Trusted-proxy auth missing userHeader config',
        detail:
          'gateway.auth.mode="trusted-proxy" but gateway.auth.trustedProxy.userHeader is not configured.',
        remediation:
          'Set gateway.auth.trustedProxy.userHeader to the header your proxy uses ' +
          '(e.g. "x-forwarded-user", "x-pomerium-claim-email").',
      });
    }

    if (trustedProxyConfig?.allowLoopback === true) {
      findings.push({
        checkId: 'gateway.trusted_proxy_allow_loopback',
        severity: 'warn',
        title: 'Trusted-proxy auth allows loopback proxy sources',
        detail:
          'gateway.auth.trustedProxy.allowLoopback=true allows loopback-source requests ' +
          'from configured gateway.trustedProxies entries to satisfy trusted-proxy auth.',
        remediation:
          'Enable only when a same-host reverse proxy is the intended trust boundary.',
      });
    }

    const allowUsers = trustedProxyConfig?.allowUsers ?? [];
    if (allowUsers.length === 0) {
      findings.push({
        checkId: 'gateway.trusted_proxy_no_allowlist',
        severity: 'warn',
        title: 'Trusted-proxy auth allows all authenticated users',
        detail:
          'gateway.auth.trustedProxy.allowUsers is empty, so any user authenticated by your proxy can access the gateway.',
        remediation:
          'Consider setting gateway.auth.trustedProxy.allowUsers to restrict access to specific users.',
      });
    }

    if (params.allowRealIpFallback === true) {
      findings.push({
        checkId: 'gateway.trusted_proxy_real_ip_fallback',
        severity: 'warn',
        title: 'X-Real-IP fallback is enabled for trusted-proxy client IP resolution',
        detail:
          'gateway.allowRealIpFallback=true uses X-Real-IP when X-Forwarded-For chain parsing fails.',
        remediation:
          'Keep gateway.allowRealIpFallback=false unless your trusted proxy only sets X-Real-IP.',
      });
    }
  }

  return findings;
}

export function collectExposureAuditFindings(cfg: Config): SecurityAuditFinding[] {
  const findings: SecurityAuditFinding[] = [];
  const tailscaleMode = cfg.gateway?.tailscale?.mode ?? 'off';
  const bindMode = cfg.gateway?.bind ?? 'loopback';

  for (const conflict of collectExposureConflicts(cfg)) {
    findings.push({
      checkId: `gateway.exposure.${conflict.code}`,
      severity: 'critical',
      title: 'Remote exposure configuration conflict',
      detail: conflict.message,
      remediation: 'Adjust gateway.tailscale and tunnel settings so only one auto-exposure path is active.',
    });
  }

  if (tailscaleMode === 'funnel' && cfg.gateway?.auth?.mode !== 'password') {
    findings.push({
      checkId: 'gateway.tailscale.funnel_without_password',
      severity: 'critical',
      title: 'Tailscale Funnel requires password auth',
      detail: 'gateway.tailscale.mode=funnel exposes the gateway on the public internet and requires gateway.auth.mode=password.',
      remediation: 'Set gateway.auth.mode to password and configure gateway.auth.password.',
    });
  }

  if (tailscaleMode !== 'off' && bindMode !== 'loopback') {
    findings.push({
      checkId: 'gateway.tailscale.serve_with_non_loopback_bind',
      severity: 'critical',
      title: 'Tailscale exposure requires loopback bind',
      detail: `Tailscale ${tailscaleMode} is enabled but gateway.bind=${bindMode}.`,
      remediation: 'Set gateway.bind to loopback when using Tailscale Serve or Funnel.',
    });
  }

  if (isTailnetBindUnavailable(cfg)) {
    findings.push({
      checkId: 'gateway.bind.tailnet_ip_unavailable',
      severity: 'warn',
      title: 'Tailnet bind requested but Tailscale IP unavailable',
      detail: 'gateway.bind=tailnet but no Tailscale IPv4 (100.x) was detected; gateway falls back to loopback.',
      remediation: 'Install and connect Tailscale, or use gateway.tailscale.mode=serve instead.',
    });
  }

  if (isRemoteGatewayInsecure(cfg)) {
    findings.push({
      checkId: 'gateway.remote.insecure_url',
      severity: 'warn',
      title: 'Remote gateway URL uses plaintext HTTP',
      detail: 'gateway.mode=remote points to a non-loopback http:// URL without TLS.',
      remediation: 'Use https://, SSH tunnel to loopback, or Tailscale Serve.',
    });
  }

  if (tailscaleMode === 'funnel') {
    findings.push({
      checkId: 'gateway.tailscale.funnel_public',
      severity: 'critical',
      title: 'Tailscale Funnel exposes gateway to the public internet',
      detail: 'Funnel publishes HTTPS endpoints reachable from the public internet.',
      remediation: 'Prefer Tailscale Serve for tailnet-only access, or use FRP with consent for controlled public exposure.',
    });
  }

  return findings;
}

/** Findings from fail-closed startup guards (`assertGatewayRuntimeConfig`). */
export function collectGatewayStartupGuardFindings(
  cfg: Config,
  env: NodeJS.ProcessEnv = process.env,
): SecurityAuditFinding[] {
  try {
    const auth = resolveGatewayAuth({ authConfig: cfg.gateway?.auth, env });
    assertGatewayAuthConfigured(auth);
    assertGatewayRuntimeConfig({
      cfg,
      auth,
      port: cfg.gateway?.port ?? 18790,
    });
    return [];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return [{
      checkId: 'gateway.runtime_config.blocked',
      severity: 'critical',
      title: 'Gateway startup guards would reject this configuration',
      detail: message,
      remediation: 'Fix the configuration issue above, then run `xopc gateway` again.',
    }];
  }
}

function mergeFindings(findings: SecurityAuditFinding[]): SecurityAuditFinding[] {
  const byId = new Map<string, SecurityAuditFinding>();
  const severityRank = { critical: 3, warn: 2, info: 1 } as const;

  for (const finding of findings) {
    const existing = byId.get(finding.checkId);
    if (!existing || severityRank[finding.severity] > severityRank[existing.severity]) {
      byId.set(finding.checkId, finding);
    }
  }
  return [...byId.values()];
}

/**
 * Full gateway security findings for doctor / CLI audit (config + startup guards).
 */
export function collectGatewaySecurityFindings(
  cfg: Config,
  env: NodeJS.ProcessEnv = process.env,
): SecurityAuditFinding[] {
  const inputs = resolveAuditInputs(cfg, env);
  const configFindings = collectGatewayConfigFindings({
    auth: inputs.auth,
    bindHost: inputs.bindHost,
    corsOrigins: inputs.corsOrigins,
    rateLimitEnabled: inputs.rateLimitEnabled,
    tlsEnabled: inputs.tlsEnabled,
    trustedProxies: inputs.trustedProxies,
    allowRealIpFallback: inputs.allowRealIpFallback,
    dangerouslyAllowHostHeaderOriginFallback: inputs.dangerouslyAllowHostHeaderOriginFallback,
    strictSecurityEnabled: isGatewayStrictSecurityEnabled(cfg),
    rateLimitConfigured: cfg.gateway?.auth?.rateLimit !== undefined,
  });
  const startupFindings = collectGatewayStartupGuardFindings(cfg, env);
  const exposureFindings = collectExposureAuditFindings(cfg);
  return mergeFindings([...configFindings, ...startupFindings, ...exposureFindings]);
}

function emitFindings(findings: SecurityAuditFinding[]): void {
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
}

/**
 * Audit the gateway configuration at startup and log security findings.
 */
export function auditGatewayConfig(params: {
  auth: ResolvedGatewayAuth;
  bindHost?: string;
  corsOrigins?: string[];
  rateLimitEnabled?: boolean;
  tlsEnabled?: boolean;
  trustedProxies?: string[];
  allowRealIpFallback?: boolean;
  dangerouslyAllowHostHeaderOriginFallback?: boolean;
  strictSecurityEnabled?: boolean;
  rateLimitConfigured?: boolean;
}): SecurityAuditFinding[] {
  const findings = collectGatewayConfigFindings(params);
  emitFindings(findings);
  return findings;
}
