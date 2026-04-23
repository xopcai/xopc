import { existsSync } from 'node:fs';

import { loadConfig } from '../../../../config/loader.js';
import type { Config } from '../../../../config/schema.js';
import type { CheckResult, DoctorContext } from '../types.js';

function resolveGatewayBaseUrl(cfg: Config): string {
  const host = cfg.gateway?.host?.trim() || '127.0.0.1';
  const port = cfg.gateway?.port ?? 18790;
  return `http://${host}:${port}`;
}

const FETCH_TIMEOUT_MS = 5000;

export async function checkGatewayHealth(ctx: DoctorContext): Promise<CheckResult> {
  if (!existsSync(ctx.configPath)) {
    return {
      id: 'gateway-health',
      label: 'Gateway HTTP',
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
      id: 'gateway-health',
      label: 'Gateway HTTP',
      status: 'skip',
      message: 'Config could not be loaded; skipped.',
      hints: [],
    };
  }

  const base = resolveGatewayBaseUrl(cfg);
  const url = `${base.replace(/\/$/, '')}/health`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      return {
        id: 'gateway-health',
        label: 'Gateway HTTP',
        status: 'pass',
        message: `Gateway responded OK at ${url}.`,
        hints: [],
      };
    }
    return {
      id: 'gateway-health',
      label: 'Gateway HTTP',
      status: 'warn',
      message: `Gateway returned HTTP ${res.status} at ${url}.`,
      hints: ['Start the gateway: xopc gateway start'],
    };
  } catch (e) {
    clearTimeout(timer);
    const isAbort = e instanceof Error && e.name === 'AbortError';
    return {
      id: 'gateway-health',
      label: 'Gateway HTTP',
      status: 'warn',
      message: isAbort
        ? `Gateway did not respond within ${FETCH_TIMEOUT_MS / 1000}s (${url}).`
        : `Gateway not reachable (${url}).`,
      hints: ['Start the gateway: xopc gateway start', `Configured base: ${base}`],
    };
  }
}
