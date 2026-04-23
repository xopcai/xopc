import { existsSync, statSync } from 'node:fs';

import { loadConfig } from '../../../../config/loader.js';
import type { Config } from '../../../../config/schema.js';
import type { CheckResult, DoctorContext } from '../types.js';

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === '127.0.0.1' ||
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '0:0:0:0:0:0:0:1'
  );
}

function isAllInterfaces(host: string): boolean {
  const n = host.trim();
  return n === '0.0.0.0' || n === '::' || n === '*';
}

export async function checkSecurityAudit(ctx: DoctorContext): Promise<CheckResult> {
  if (!existsSync(ctx.configPath)) {
    return {
      id: 'security-audit',
      label: 'Security',
      status: 'skip',
      message: 'No config file; skipped.',
      hints: [],
    };
  }

  let cfg: Config;
  try {
    cfg = loadConfig(ctx.configPath);
  } catch {
    return {
      id: 'security-audit',
      label: 'Security',
      status: 'skip',
      message: 'Config could not be loaded; skipped.',
      hints: [],
    };
  }

  const hints: string[] = [];
  const host = cfg.gateway?.host?.trim() || '127.0.0.1';
  const auth = cfg.gateway?.auth;
  const mode = auth?.mode ?? 'token';
  const token = auth?.token?.trim() ?? '';

  if (isAllInterfaces(host) && (mode === 'none' || !token)) {
    return {
      id: 'security-audit',
      label: 'Security',
      status: 'fail',
      message: 'Gateway is bound to all interfaces without token authentication (critical).',
      hints: [
        'Set gateway.host to 127.0.0.1 or enable gateway.auth (token).',
        'Do not expose an unauthenticated gateway on the network.',
      ],
    };
  }

  if (isAllInterfaces(host) && mode !== 'none' && token) {
    hints.push('Listening on all network interfaces; prefer 127.0.0.1 or firewall rules if the token could leak.');
  }

  if (!isLoopbackHost(host) && !isAllInterfaces(host)) {
    if (mode === 'none' || !token) {
      return {
        id: 'security-audit',
        label: 'Security',
        status: 'fail',
        message: 'Gateway is reachable on a non-loopback address without authentication.',
        hints: ['Use gateway.auth.mode "token" and set gateway.auth.token, or bind to loopback only.'],
      };
    }
    hints.push('Non-loopback bind is safer with a strong token and firewall rules.');
  }

  if (isLoopbackHost(host) && (mode === 'none' || !token)) {
    return {
      id: 'security-audit',
      label: 'Security',
      status: 'warn',
      message: 'Gateway has no token auth (loopback only).',
      hints: ['Consider gateway.auth.token for defense in depth.'],
    };
  }

  if (token.length > 0 && token.length < 16) {
    hints.push('Auth token is shorter than 16 characters; use a longer random token.');
  }

  if (process.platform !== 'win32') {
    try {
      const st = statSync(ctx.configPath);
      const perms = st.mode & 0o777;
      if (perms & 0o077) {
        hints.push('Config file is group/world-readable; consider chmod 600 (contains secrets).');
      }
    } catch {
      /* ignore */
    }
  }

  if (hints.length > 0) {
    return {
      id: 'security-audit',
      label: 'Security',
      status: 'warn',
      message: 'Non-critical security recommendations.',
      hints,
    };
  }

  return {
    id: 'security-audit',
    label: 'Security',
    status: 'pass',
    message: 'No critical gateway exposure issues detected.',
    hints: [],
  };
}
