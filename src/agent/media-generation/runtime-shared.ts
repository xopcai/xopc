/**
 * Cross-capability runtime helpers shared by image / audio / video
 * generation. Pure functions (no IO) so they can be unit-tested without
 * touching providers.
 *
 * - candidate model resolution
 * - geometry/value nearest-neighbour matching
 * - terminal failure aggregation (FailoverError)
 * - "no model configured" message builder
 */

import type { Config, AgentModelConfig } from '../../config/schema.js';
import {
  classifyAttemptError,
  FailoverError,
  type FallbackAttempt,
  type FailoverReason,
} from '../failover-error.js';
import { parseCapabilityModelRef, type ParsedCapabilityModelRef } from './model-ref.js';

// ============================================
// Candidate resolution
// ============================================

export interface CapabilityProviderCandidate {
  id: string;
  aliases?: readonly string[];
  defaultModel?: string | null;
  models?: readonly string[];
  isConfigured?: (ctx: { cfg?: Config; agentId?: string; agentDir?: string }) => boolean;
}

export interface ResolveCapabilityModelCandidatesParams {
  cfg?: Config;
  /** Active capability model config from a manifest/runtime policy. */
  modelConfig: { primary?: string; fallbacks?: string[] } | AgentModelConfig | undefined;
  /** Caller-supplied per-call override (highest priority). */
  modelOverride?: string;
  /** Optional ref parser; defaults to {@link parseCapabilityModelRef}. */
  parseModelRef?: (raw: string | undefined) => ParsedCapabilityModelRef | null;
  agentId?: string;
  agentDir?: string;
  /** Snapshot of registered providers used to enumerate fallbacks. */
  listProviders: (cfg?: Config) => CapabilityProviderCandidate[];
  /**
   * When true and the explicit candidates fail, append every configured
   * provider's default model.
   */
  autoProviderFallback?: boolean;
}

export interface ResolvedCapabilityModelCandidate {
  provider: string;
  model: string;
}

/**
 * Build the ordered candidate list from:
 *   1. modelOverride
 *   2. modelConfig.primary
 *   3. modelConfig.fallbacks[]
 *   4. (optional) every isConfigured() provider's defaultModel
 *
 * Duplicates are dropped (case-insensitive on provider, exact on model).
 */
export function resolveCapabilityModelCandidates(
  params: ResolveCapabilityModelCandidatesParams,
): ResolvedCapabilityModelCandidate[] {
  const parse = params.parseModelRef ?? parseCapabilityModelRef;
  const out: ResolvedCapabilityModelCandidate[] = [];
  const seen = new Set<string>();

  const push = (raw: string | undefined) => {
    const parsed = parse(raw);
    if (!parsed) return;
    const key = `${parsed.provider}::${parsed.model}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ provider: parsed.provider, model: parsed.model });
  };

  const normalizedModelConfig = normalizeModelConfig(params.modelConfig);
  push(params.modelOverride);
  push(normalizedModelConfig.primary);
  for (const fb of normalizedModelConfig.fallbacks) push(fb);

  if (params.autoProviderFallback) {
    const providers = safeListProviders(params.listProviders, params.cfg);
    for (const provider of providers) {
      if (!provider.defaultModel) continue;
      let configured = true;
      try {
        configured = provider.isConfigured?.({
          cfg: params.cfg,
          agentId: params.agentId,
          agentDir: params.agentDir,
        }) ?? true;
      } catch {
        configured = false;
      }
      if (!configured) continue;
      push(`${provider.id}/${provider.defaultModel}`);
    }
  }

  return out;
}

function safeListProviders(
  fn: (cfg?: Config) => CapabilityProviderCandidate[],
  cfg?: Config,
): CapabilityProviderCandidate[] {
  try {
    return fn(cfg) ?? [];
  } catch {
    return [];
  }
}

/** Normalize an {@link AgentModelConfig} to `{ primary?, fallbacks }`. */
function normalizeModelConfig(
  cfg: ResolveCapabilityModelCandidatesParams['modelConfig'],
): { primary?: string; fallbacks: string[] } {
  if (!cfg) return { fallbacks: [] };
  return {
    primary: typeof cfg.primary === 'string' ? cfg.primary : undefined,
    fallbacks: Array.isArray(cfg.fallbacks)
      ? cfg.fallbacks.filter((s): s is string => typeof s === 'string')
      : [],
  };
}

// ============================================
// Geometry helpers (nearest-neighbour)
// ============================================

export function resolveClosestSize(params: {
  requestedSize?: string;
  requestedAspectRatio?: string;
  supportedSizes?: ReadonlyArray<string>;
}): string | undefined {
  const supported = (params.supportedSizes ?? []).filter((s) => parseSize(s) !== null);
  if (supported.length === 0) return undefined;

  const target =
    parseSize(params.requestedSize) ??
    sizeFromAspectRatio(params.requestedAspectRatio, supported.map((s) => parseSize(s)!.totalPixels));

  if (!target) return supported[0];
  return supported
    .map((s) => ({ s, parsed: parseSize(s)! }))
    .reduce((best, cur) => {
      const score = sizeDistance(target, cur.parsed);
      return score < best.score ? { s: cur.s, score } : best;
    }, { s: supported[0], score: Number.POSITIVE_INFINITY })
    .s;
}

export function resolveClosestAspectRatio(params: {
  requestedAspectRatio?: string;
  requestedSize?: string;
  supportedAspectRatios?: ReadonlyArray<string>;
}): string | undefined {
  const supported = (params.supportedAspectRatios ?? []).filter((r) => parseAspectRatio(r) !== null);
  if (supported.length === 0) return undefined;

  const targetRatio =
    parseAspectRatio(params.requestedAspectRatio)?.value ??
    (() => {
      const sz = parseSize(params.requestedSize);
      return sz ? sz.width / sz.height : undefined;
    })();

  if (typeof targetRatio !== 'number' || !Number.isFinite(targetRatio)) {
    return supported[0];
  }

  return supported.reduce((best, cur) => {
    const v = parseAspectRatio(cur)!.value;
    const d = Math.abs(Math.log(v) - Math.log(targetRatio));
    return d < best.score ? { s: cur, score: d } : best;
  }, { s: supported[0], score: Number.POSITIVE_INFINITY }).s;
}

export function resolveClosestResolution<T extends string>(params: {
  requestedResolution?: T;
  supportedResolutions?: ReadonlyArray<T>;
}): T | undefined {
  const supported = params.supportedResolutions ?? [];
  if (supported.length === 0) return undefined;
  const requested = params.requestedResolution;
  if (!requested) return undefined;
  if (supported.includes(requested)) return requested;

  const order = ['1K', '2K', '4K', '8K'];
  const want = order.indexOf(String(requested));
  if (want < 0) return supported[0];

  // Prefer the largest supported value <= requested; otherwise pick the smallest available.
  const ranked = supported
    .map((r) => ({ r, idx: order.indexOf(String(r)) }))
    .filter((x) => x.idx >= 0)
    .sort((a, b) => a.idx - b.idx);
  if (ranked.length === 0) return supported[0];

  let chosen = ranked[0].r;
  for (const x of ranked) {
    if (x.idx <= want) chosen = x.r;
  }
  return chosen;
}

function parseSize(raw: string | undefined): { width: number; height: number; totalPixels: number } | null {
  if (typeof raw !== 'string') return null;
  const m = raw.trim().toLowerCase().match(/^(\d{2,5})\s*[x×*]\s*(\d{2,5})$/);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height, totalPixels: width * height };
}

function parseAspectRatio(raw: string | undefined): { value: number } | null {
  if (typeof raw !== 'string') return null;
  const m = raw.trim().match(/^(\d{1,3})\s*[:x×/]\s*(\d{1,3})$/);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return { value: w / h };
}

function sizeFromAspectRatio(
  ratioStr: string | undefined,
  pixelHints: number[],
): { width: number; height: number; totalPixels: number } | null {
  const r = parseAspectRatio(ratioStr);
  if (!r) return null;
  const pixels = pixelHints.length > 0 ? Math.round(pixelHints.reduce((a, b) => a + b, 0) / pixelHints.length) : 1024 * 1024;
  const height = Math.round(Math.sqrt(pixels / r.value));
  const width = Math.round(height * r.value);
  return { width, height, totalPixels: width * height };
}

function sizeDistance(
  a: { width: number; height: number; totalPixels: number },
  b: { width: number; height: number; totalPixels: number },
): number {
  // Combined area + aspect-ratio difference (log-scale on both for stability).
  const areaDelta = Math.abs(Math.log(a.totalPixels) - Math.log(b.totalPixels));
  const ratioA = a.width / a.height;
  const ratioB = b.width / b.height;
  const ratioDelta = Math.abs(Math.log(ratioA) - Math.log(ratioB));
  return areaDelta + ratioDelta * 1.5;
}

// ============================================
// Failure aggregation
// ============================================

export interface RecordCapabilityCandidateFailureParams {
  attempts: FallbackAttempt[];
  provider: string;
  model: string;
  error: unknown;
  durationMs?: number;
}

/** Push a structured {@link FallbackAttempt} entry derived from `error`. */
export function recordCapabilityCandidateFailure(
  params: RecordCapabilityCandidateFailureParams,
): FallbackAttempt {
  const cls = classifyAttemptError(params.error);
  const attempt: FallbackAttempt = {
    provider: params.provider,
    model: params.model,
    error: cls.message,
    reason: cls.reason,
    ...(cls.status !== undefined ? { status: cls.status } : {}),
    ...(cls.code !== undefined ? { code: cls.code } : {}),
    ...(params.durationMs !== undefined ? { durationMs: params.durationMs } : {}),
  };
  params.attempts.push(attempt);
  return attempt;
}

export interface ThrowCapabilityGenerationFailureParams {
  capabilityLabel: string;
  attempts: FallbackAttempt[];
  lastError: unknown;
}

/** Throw a unified {@link FailoverError} after all candidates have been exhausted. */
export function throwCapabilityGenerationFailure(params: ThrowCapabilityGenerationFailureParams): never {
  // capabilityLabel like "image generation" → identifier "image-generation"
  const capability = params.capabilityLabel.trim().toLowerCase().replace(/\s+/g, '-') || 'capability';
  throw new FailoverError({
    capability,
    attempts: params.attempts,
    cause: params.lastError,
  });
}

// ============================================
// "No model configured" message
// ============================================

export interface BuildNoCapabilityModelConfiguredMessageParams {
  /** Display label, e.g. "image-generation". */
  capabilityLabel: string;
  /** Config key path, e.g. "agents.defaults.models.imageGeneration". */
  modelConfigKey: string;
  providers: ReadonlyArray<CapabilityProviderCandidate>;
  /** Optional env-var lookup, e.g. (id) => PROVIDER_ENV_MAP[id]. */
  getProviderEnvVars?: (id: string) => readonly string[] | undefined;
}

export function buildNoCapabilityModelConfiguredMessage(
  params: BuildNoCapabilityModelConfiguredMessageParams,
): string {
  const lines: string[] = [
    `No ${params.capabilityLabel} model configured. Set agents.defaults.models.${params.modelConfigKey} ` +
      `or pass modelOverride at call site.`,
  ];
  if (params.providers.length > 0) {
    lines.push('Registered providers:');
    for (const p of params.providers) {
      const envs = params.getProviderEnvVars?.(p.id) ?? [];
      const env = envs.length > 0 ? ` (env: ${envs.join(' | ')})` : '';
      const def = p.defaultModel ? ` default=${p.defaultModel}` : '';
      lines.push(`  - ${p.id}${def}${env}`);
    }
  }
  return lines.join('\n');
}

/**
 * Build a `metadata.normalization` snapshot from a completed normalization
 * pass. Providers / runtime can spread it into their result metadata.
 */
export function buildMediaGenerationNormalizationMetadata(params: {
  normalization?: Record<string, unknown>;
}): Record<string, unknown> {
  if (!params.normalization || Object.keys(params.normalization).length === 0) return {};
  return { normalization: params.normalization };
}

// Re-export the union for downstream type narrowing.
export type { FailoverReason };
