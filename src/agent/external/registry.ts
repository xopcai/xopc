import type { ModelThinkingCapabilities } from '@xopcai/gateway-contract';

import type { ExternalAgentExecution, ExternalAgentKind } from '../../agent-config/schema.js';
import { agyExternalDriver } from './drivers/agy/driver.js';
import { claudeExternalDriver } from './drivers/claude/driver.js';
import { codexExternalDriver } from './drivers/codex/driver.js';
import type {
  ExternalAgentDriver,
  ExternalRuntimeCommand,
  ExternalRuntimeProbeResult,
  ExternalRuntimeRateLimits,
  ExternalRuntimeServiceTier,
  ExternalRuntimeStatus,
} from './types.js';

const BUILT_IN_DRIVERS: ReadonlyArray<ExternalAgentDriver> = [
  codexExternalDriver,
  agyExternalDriver,
  claudeExternalDriver,
];

const registry = new Map<ExternalAgentKind, ExternalAgentDriver>(
  BUILT_IN_DRIVERS.map(driver => [driver.kind, driver]),
);

const PROBE_CACHE_TTL_MS = 60_000;
const probeCache = new Map<string, { result: ExternalRuntimeProbeResult; expiresAt: number }>();
const probeInflight = new Map<string, Promise<ExternalRuntimeProbeResult>>();

function probeCacheKey(execution: ExternalAgentExecution): string {
  if (execution.kind === 'codex') {
    return JSON.stringify(['codex', execution.binaryPath?.trim() ?? '', execution.homePath?.trim() ?? '']);
  }
  if (execution.kind === 'claude') {
    return JSON.stringify(['claude', execution.binaryPath?.trim() ?? '', execution.configDir?.trim() ?? '']);
  }
  return JSON.stringify([
    'agy',
    execution.binaryPath?.trim() ?? '',
    execution.geminiDir?.trim() ?? '',
    execution.authMethod ?? '',
  ]);
}

function storeProbeResult(execution: ExternalAgentExecution, result: ExternalRuntimeProbeResult): void {
  probeCache.set(probeCacheKey(execution), {
    result,
    expiresAt: Date.now() + PROBE_CACHE_TTL_MS,
  });
}

export function invalidateExternalRuntimeProbeCache(kind?: ExternalAgentKind): void {
  if (!kind) {
    probeCache.clear();
    return;
  }
  const prefix = `["${kind}",`;
  for (const key of probeCache.keys()) {
    if (key.startsWith(prefix)) probeCache.delete(key);
  }
}

export function getCachedExternalRuntimeProbe(execution: ExternalAgentExecution): ExternalRuntimeProbeResult | undefined {
  const entry = probeCache.get(probeCacheKey(execution));
  if (!entry || Date.now() >= entry.expiresAt) return undefined;
  return entry.result;
}

export function getCachedExternalDefaultModel(execution: ExternalAgentExecution): string | undefined {
  const cached = getCachedExternalRuntimeProbe(execution);
  if (!cached || cached.models.length === 0) return undefined;
  return cached.models.find((m) => m.isDefault)?.id ?? cached.models[0]?.id;
}

export function getExternalAgentDriver(kind: ExternalAgentKind): ExternalAgentDriver {
  const driver = registry.get(kind);
  if (!driver) throw new Error(`Unsupported external agent runtime: ${kind}`);
  return driver;
}

export function listExternalAgentDrivers(): ReadonlyArray<ExternalAgentDriver> {
  return [...registry.values()];
}

export async function probeExternalAgentRuntime(
  execution: ExternalAgentExecution,
): Promise<ExternalRuntimeProbeResult> {
  const result = await getExternalAgentDriver(execution.kind).probe(execution);
  storeProbeResult(execution, result);
  return result;
}

export async function probeExternalAgentRuntimeCached(
  execution: ExternalAgentExecution,
  forceRefresh = false,
): Promise<ExternalRuntimeProbeResult> {
  if (!forceRefresh) {
    const cached = getCachedExternalRuntimeProbe(execution);
    if (cached) return cached;
  }
  const key = probeCacheKey(execution);
  const existing = !forceRefresh ? probeInflight.get(key) : undefined;
  if (existing) return existing;
  const pending = probeExternalAgentRuntime(execution).finally(() => {
    if (probeInflight.get(key) === pending) probeInflight.delete(key);
  });
  probeInflight.set(key, pending);
  return pending;
}

export async function probeAllExternalAgentRuntimes(): Promise<ExternalRuntimeProbeResult[]> {
  return Promise.all(
    BUILT_IN_DRIVERS.map((driver) => probeExternalAgentRuntime({ kind: driver.kind } as ExternalAgentExecution)),
  );
}

export type ExternalRuntimeCatalogModel = {
  id: string;
  name: string;
  provider: string;
  reasoning?: boolean;
  thinking?: ModelThinkingCapabilities;
  serviceTiers?: ExternalRuntimeServiceTier[];
  isDefault?: boolean;
};

export type ExternalRuntimeModelsPayload = {
  runtimeKind: ExternalAgentKind;
  runtimeLabel: string;
  status: ExternalRuntimeStatus;
  defaultModel: string;
  models: ExternalRuntimeCatalogModel[];
  rateLimits?: ExternalRuntimeRateLimits;
  commands?: ExternalRuntimeCommand[];
  supportsCompact?: boolean;
  supportsFork?: boolean;
  supportsRollback?: boolean;
  message?: string;
};

export async function resolveExternalRuntimeModelsPayload(
  execution: ExternalAgentExecution,
  forceRefresh = false,
): Promise<ExternalRuntimeModelsPayload> {
  const driver = getExternalAgentDriver(execution.kind);
  const probe = await probeExternalAgentRuntimeCached(execution, forceRefresh);
  const configuredModel = execution.model?.trim();

  const models: ExternalRuntimeCatalogModel[] = probe.models.map((opt) => ({
    id: opt.id,
    name: opt.label,
    provider: driver.label,
    reasoning: Boolean(opt.thinking && opt.thinking.mode !== 'none'),
    ...(opt.thinking ? { thinking: opt.thinking } : {}),
    ...(opt.serviceTiers?.length ? { serviceTiers: opt.serviceTiers } : {}),
    ...(opt.isDefault ? { isDefault: true } : {}),
  }));

  if (configuredModel && !models.some((m) => m.id === configuredModel)) {
    models.unshift({
      id: configuredModel,
      name: configuredModel,
      provider: driver.label,
      isDefault: models.length === 0,
    });
  }

  const defaultModel =
    configuredModel
    || models.find((m) => m.isDefault)?.id
    || models[0]?.id
    || driver.defaultModelName;

  return {
    runtimeKind: driver.kind,
    runtimeLabel: driver.label,
    status: probe.status,
    defaultModel,
    models,
    ...(probe.rateLimits ? { rateLimits: probe.rateLimits } : {}),
    ...(probe.commands?.length ? { commands: probe.commands } : {}),
    supportsCompact: Boolean(driver.compactSession),
    supportsFork: Boolean(driver.forkSession),
    supportsRollback: Boolean(driver.rollbackSession),
    ...(probe.message ? { message: probe.message } : {}),
  };
}
