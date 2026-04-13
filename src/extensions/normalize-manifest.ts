import type {
  ActivationDeclaration,
  ContractDeclaration,
  ExtensionManifest,
  ModelSupportDeclaration,
  ProviderAuthChoice,
  SetupDeclaration,
} from './types/manifest.js';
import type { ExtensionKind } from './types/core.js';

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/**
 * Normalize raw JSON manifest into ExtensionManifest with stable optional fields.
 */
export function normalizeExtensionManifest(raw: Record<string, unknown>): ExtensionManifest {
  const id = String(raw.id ?? '');
  return {
    id,
    name: typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : id,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    version: typeof raw.version === 'string' ? raw.version : undefined,
    kind: raw.kind as ExtensionKind | undefined,
    main: typeof raw.main === 'string' ? raw.main : undefined,
    configSchema: isRecord(raw.configSchema) ? (raw.configSchema as Record<string, unknown>) : undefined,
    dependencies: isRecord(raw.dependencies) ? (raw.dependencies as Record<string, string>) : undefined,

    enabledByDefault: typeof raw.enabledByDefault === 'boolean' ? raw.enabledByDefault : undefined,
    legacyExtensionIds: Array.isArray(raw.legacyExtensionIds)
      ? raw.legacyExtensionIds.filter((x): x is string => typeof x === 'string')
      : undefined,

    providers: Array.isArray(raw.providers)
      ? raw.providers.filter((x): x is string => typeof x === 'string')
      : undefined,
    providerAuthEnvVars: normalizeStringArrayMap(raw.providerAuthEnvVars),
    providerAuthChoices: normalizeProviderAuthChoices(raw.providerAuthChoices),
    modelSupport: normalizeModelSupport(raw.modelSupport),
    autoEnableWhenConfiguredProviders: Array.isArray(raw.autoEnableWhenConfiguredProviders)
      ? raw.autoEnableWhenConfiguredProviders.filter((x): x is string => typeof x === 'string')
      : undefined,

    channels: Array.isArray(raw.channels)
      ? raw.channels.filter((x): x is string => typeof x === 'string')
      : undefined,
    channelEnvVars: normalizeStringArrayMap(raw.channelEnvVars),

    activation: normalizeActivation(raw.activation),
    contracts: normalizeContracts(raw.contracts),
    setup: normalizeSetup(raw.setup),
  };
}

function normalizeStringArrayMap(
  raw: unknown,
): Record<string, string[]> | undefined {
  if (!isRecord(raw)) return undefined;
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (Array.isArray(v)) {
      const arr = v.filter((x): x is string => typeof x === 'string');
      if (arr.length) out[k] = arr;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function normalizeProviderAuthChoices(raw: unknown): ProviderAuthChoice[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ProviderAuthChoice[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const provider = item.provider;
    const method = item.method;
    const choiceId = item.choiceId;
    const choiceLabel = item.choiceLabel;
    if (
      typeof provider !== 'string' ||
      typeof choiceId !== 'string' ||
      typeof choiceLabel !== 'string' ||
      (method !== 'api-key' && method !== 'oauth' && method !== 'cli' && method !== 'env')
    ) {
      continue;
    }
    out.push({
      provider,
      method,
      choiceId,
      choiceLabel,
      choiceHint: typeof item.choiceHint === 'string' ? item.choiceHint : undefined,
      groupId: typeof item.groupId === 'string' ? item.groupId : undefined,
      groupLabel: typeof item.groupLabel === 'string' ? item.groupLabel : undefined,
      groupHint: typeof item.groupHint === 'string' ? item.groupHint : undefined,
      cliFlag: typeof item.cliFlag === 'string' ? item.cliFlag : undefined,
      cliOption: typeof item.cliOption === 'string' ? item.cliOption : undefined,
      cliDescription: typeof item.cliDescription === 'string' ? item.cliDescription : undefined,
    });
  }
  return out.length ? out : undefined;
}

function normalizeModelSupport(raw: unknown): ModelSupportDeclaration | undefined {
  if (!isRecord(raw)) return undefined;
  const modelPrefixes = Array.isArray(raw.modelPrefixes)
    ? raw.modelPrefixes.filter((x): x is string => typeof x === 'string')
    : undefined;
  const modelPatterns = Array.isArray(raw.modelPatterns)
    ? raw.modelPatterns.filter((x): x is string => typeof x === 'string')
    : undefined;
  if (!modelPrefixes?.length && !modelPatterns?.length) return undefined;
  return { modelPrefixes, modelPatterns };
}

function normalizeActivation(raw: unknown): ActivationDeclaration | undefined {
  if (!isRecord(raw)) return undefined;
  const onProviders = Array.isArray(raw.onProviders)
    ? raw.onProviders.filter((x): x is string => typeof x === 'string')
    : undefined;
  const onCommands = Array.isArray(raw.onCommands)
    ? raw.onCommands.filter((x): x is string => typeof x === 'string')
    : undefined;
  const onChannels = Array.isArray(raw.onChannels)
    ? raw.onChannels.filter((x): x is string => typeof x === 'string')
    : undefined;
  const capRaw = raw.onCapabilities;
  const onCapabilities = Array.isArray(capRaw)
    ? capRaw.filter(
        (x): x is 'provider' | 'channel' | 'tool' | 'hook' =>
          x === 'provider' || x === 'channel' || x === 'tool' || x === 'hook',
      )
    : undefined;
  if (!onProviders?.length && !onCommands?.length && !onChannels?.length && !onCapabilities?.length) {
    return undefined;
  }
  return { onProviders, onCommands, onChannels, onCapabilities };
}

function normalizeContracts(raw: unknown): ContractDeclaration | undefined {
  if (!isRecord(raw)) return undefined;
  const pick = (k: string) =>
    Array.isArray(raw[k]) ? raw[k].filter((x: unknown): x is string => typeof x === 'string') : undefined;
  const c: ContractDeclaration = {
    mediaUnderstandingProviders: pick('mediaUnderstandingProviders'),
    speechProviders: pick('speechProviders'),
    imageGenerationProviders: pick('imageGenerationProviders'),
    webSearchProviders: pick('webSearchProviders'),
    memoryProviders: pick('memoryProviders'),
  };
  if (
    !c.mediaUnderstandingProviders?.length &&
    !c.speechProviders?.length &&
    !c.imageGenerationProviders?.length &&
    !c.webSearchProviders?.length &&
    !c.memoryProviders?.length
  ) {
    return undefined;
  }
  return c;
}

function normalizeSetup(raw: unknown): SetupDeclaration | undefined {
  if (!isRecord(raw)) return undefined;
  const requiresRuntime = typeof raw.requiresRuntime === 'boolean' ? raw.requiresRuntime : undefined;
  let providers: SetupDeclaration['providers'];
  if (Array.isArray(raw.providers)) {
    providers = [];
    for (const p of raw.providers) {
      if (!isRecord(p) || typeof p.id !== 'string') continue;
      providers.push({
        id: p.id,
        authMethods: Array.isArray(p.authMethods)
          ? p.authMethods.filter((x): x is string => typeof x === 'string')
          : undefined,
        envVars: Array.isArray(p.envVars)
          ? p.envVars.filter((x): x is string => typeof x === 'string')
          : undefined,
      });
    }
    if (providers.length === 0) providers = undefined;
  }
  if (!providers && requiresRuntime === undefined) return undefined;
  return { providers, requiresRuntime };
}
