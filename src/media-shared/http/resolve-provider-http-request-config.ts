/**
 * Resolve per-provider HTTP defaults from {@link Config}.
 *
 * Lookup order for `request.timeoutMs` and `request.headers`:
 *   1. cfg.providers.<id>.request.{timeoutMs|headers}     (typed schema field — not yet present in Step 1)
 *   2. cfg.providers.<id>.{timeoutMs|headers}             (loose / future)
 *   3. fallbacks supplied by caller
 *
 * In Step 1 the Zod schema does not yet declare these fields. We still parse
 * defensively from `unknown` so this module is forward-compatible: when Step 4
 * adds the schema fields, no consumer changes are needed.
 */

import type { Config } from '../../config/schema.js';

export interface ResolvedProviderHttpDefaults {
  /** Default per-call timeout in ms (provider-level), or undefined. */
  timeoutMs?: number;
  /** Default headers merged into every request. Lower-case keys recommended. */
  headers: Record<string, string>;
}

export interface ResolveProviderHttpRequestConfigOptions {
  /** Provider id, e.g. "openai", "dashscope", "minimax". */
  providerId: string;
  /** Active xopc config (optional). */
  cfg?: Config;
  /** Built-in defaults (e.g. 60_000ms). Used only if config provides nothing. */
  fallbackTimeoutMs?: number;
  /** Built-in headers (e.g. User-Agent). Caller request headers still win. */
  fallbackHeaders?: Record<string, string>;
}

export function resolveProviderHttpRequestConfig(
  options: ResolveProviderHttpRequestConfigOptions,
): ResolvedProviderHttpDefaults {
  const provider = readProviderEntry(options.cfg, options.providerId);
  const request = readRequestEntry(provider);

  const timeoutMs =
    pickPositiveInt(request?.timeoutMs) ??
    pickPositiveInt(provider?.timeoutMs) ??
    pickPositiveInt(options.fallbackTimeoutMs);

  const headers: Record<string, string> = {};
  for (const src of [options.fallbackHeaders, provider?.headers, request?.headers]) {
    if (!src) continue;
    for (const [k, v] of Object.entries(src)) {
      if (typeof v === 'string' && v.length > 0) {
        headers[k] = v;
      }
    }
  }

  return { timeoutMs, headers };
}

function readProviderEntry(cfg: Config | undefined, id: string): LooseProviderEntry | undefined {
  // `cfg.providers` is not declared on the Zod schema yet; read defensively.
  const providers = (cfg as unknown as { providers?: Record<string, unknown> } | undefined)?.providers;
  if (!providers || typeof providers !== 'object') return undefined;
  const entry = (providers as Record<string, unknown>)[id];
  if (!entry || typeof entry !== 'object') return undefined;
  return entry as LooseProviderEntry;
}

function readRequestEntry(provider: LooseProviderEntry | undefined): LooseRequestEntry | undefined {
  if (!provider) return undefined;
  const request = provider.request;
  if (!request || typeof request !== 'object') return undefined;
  return request as LooseRequestEntry;
}

function pickPositiveInt(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return undefined;
  return Math.floor(v);
}

interface LooseProviderEntry {
  apiKey?: unknown;
  baseUrl?: unknown;
  region?: unknown;
  headers?: Record<string, unknown>;
  timeoutMs?: unknown;
  request?: unknown;
  [k: string]: unknown;
}

interface LooseRequestEntry {
  timeoutMs?: unknown;
  headers?: Record<string, unknown>;
}
