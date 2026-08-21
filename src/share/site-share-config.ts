import { z } from 'zod';

import type { Config } from '../config/schema.js';
import {
  SITE_SHARE_CONFIG_DEFAULTS,
  type SiteShareConfig,
} from './site-share-types.js';

const SiteShareStaticPatchSchema = z.object({
  enabled: z.boolean().optional(),
  maxRootDirSize: z.number().int().min(1_048_576).max(10_737_418_240).optional(),
  maxFileCount: z.number().int().min(1).max(100_000).optional(),
  rewriteEnabledByDefault: z.boolean().optional(),
});

const SiteShareProxyPatchSchema = z.object({
  enabled: z.boolean().optional(),
  allowedUpstreamHosts: z.array(z.string().min(1)).optional(),
  allowedUpstreamPorts: z.array(z.number().int().min(1).max(65535)).optional(),
  forwardWebSocket: z.boolean().optional(),
  bodySizeLimit: z.number().int().min(0).max(1_073_741_824).optional(),
  requestTimeoutMs: z.number().int().min(1_000).max(600_000).optional(),
  wsIdleTimeoutMs: z.number().int().min(10_000).max(3_600_000).optional(),
  rewriteSetCookiePath: z.boolean().optional(),
});

const SiteSharePatchSchema = z.object({
  enabled: z.boolean().optional(),
  publicHostSuffix: z.string().min(1).optional(),
  defaultTtlMs: z.number().int().min(60_000).max(604_800_000).optional(),
  maxTtlMs: z.number().int().min(60_000).max(2_592_000_000).optional(),
  maxActiveSites: z.number().int().min(1).max(1_000).optional(),
  static: SiteShareStaticPatchSchema.optional(),
  proxy: SiteShareProxyPatchSchema.optional(),
});

export function resolveSiteShareConfig(service: { currentConfig: Config }): SiteShareConfig {
  const raw = (service.currentConfig.gateway as Record<string, unknown> | undefined)?.siteShare;
  return mergeWithDefaults(raw);
}

export function mergeWithDefaults(raw: unknown): SiteShareConfig {
  const base = SITE_SHARE_CONFIG_DEFAULTS;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return JSON.parse(JSON.stringify(base)) as SiteShareConfig;
  }
  const r = raw as Partial<SiteShareConfig> & {
    static?: Partial<SiteShareConfig['static']>;
    proxy?: Partial<SiteShareConfig['proxy']>;
  };
  return {
    enabled: r.enabled ?? base.enabled,
    publicHostSuffix: r.publicHostSuffix ?? base.publicHostSuffix,
    defaultTtlMs: r.defaultTtlMs ?? base.defaultTtlMs,
    maxTtlMs: r.maxTtlMs ?? base.maxTtlMs,
    maxActiveSites: r.maxActiveSites ?? base.maxActiveSites,
    static: {
      enabled: r.static?.enabled ?? base.static.enabled,
      maxRootDirSize: r.static?.maxRootDirSize ?? base.static.maxRootDirSize,
      maxFileCount: r.static?.maxFileCount ?? base.static.maxFileCount,
      rewriteEnabledByDefault: r.static?.rewriteEnabledByDefault ?? base.static.rewriteEnabledByDefault,
    },
    proxy: {
      enabled: r.proxy?.enabled ?? base.proxy.enabled,
      allowedUpstreamHosts: r.proxy?.allowedUpstreamHosts ?? [...base.proxy.allowedUpstreamHosts],
      allowedUpstreamPorts: r.proxy?.allowedUpstreamPorts ?? [...base.proxy.allowedUpstreamPorts],
      forwardWebSocket: r.proxy?.forwardWebSocket ?? base.proxy.forwardWebSocket,
      bodySizeLimit: r.proxy?.bodySizeLimit ?? base.proxy.bodySizeLimit,
      requestTimeoutMs: r.proxy?.requestTimeoutMs ?? base.proxy.requestTimeoutMs,
      wsIdleTimeoutMs: r.proxy?.wsIdleTimeoutMs ?? base.proxy.wsIdleTimeoutMs,
      rewriteSetCookiePath: r.proxy?.rewriteSetCookiePath ?? base.proxy.rewriteSetCookiePath,
    },
  };
}

export function mergeSiteShareConfigPatch(
  config: Config,
  patch: Record<string, unknown>,
): { ok: true } | { ok: false; message: string } {
  const parsed = SiteSharePatchSchema.safeParse(patch);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  if (!config.gateway) {
    config.gateway = {
      bind: 'loopback',
      port: 18790,
      auth: { mode: 'token' },
      heartbeat: { enabled: true, intervalMs: 1_800_000, includeSystemPromptSection: false },
      corsOrigins: [],
    };
  }

  const cfg = config.gateway as Record<string, unknown>;
  const current = mergeWithDefaults(cfg.siteShare);
  const next: SiteShareConfig = {
    ...current,
    ...parsed.data,
    static: parsed.data.static ? { ...current.static, ...parsed.data.static } : current.static,
    proxy: parsed.data.proxy ? { ...current.proxy, ...parsed.data.proxy } : current.proxy,
  };
  if (next.defaultTtlMs > next.maxTtlMs) {
    return { ok: false, message: 'siteShare.defaultTtlMs must not exceed siteShare.maxTtlMs' };
  }
  cfg.siteShare = next as unknown as Record<string, unknown>;
  return { ok: true };
}
