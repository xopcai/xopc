import { stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Config } from '../../config/schema.js';
import { discoverExtensionsFromDisk } from '../../extensions/discover-extensions.js';
import type { DiscoveredExtension } from '../../extensions/types/loader.js';
import type { MemoryProvider } from './provider.js';
import type { MemoryProviderManifest } from './types.js';

export interface MemoryPluginMetadata {
  name: string;
  description: string;
  available: boolean;
  manifest?: MemoryProviderManifest;
}

export interface MemoryPluginProviderContext {
  config?: Config;
  manifest?: MemoryProviderManifest;
  extension?: {
    id: string;
    path: string;
    source: DiscoveredExtension['source'];
    config?: Record<string, unknown>;
  };
}

type MemoryPluginModule = {
  isAvailable?: () => boolean;
  description?: string;
  manifest?: MemoryProviderManifest;
  createMemoryProvider?: (
    context: MemoryPluginProviderContext,
  ) => MemoryProvider | Promise<MemoryProvider>;
};

export async function discoverMemoryPlugins(config?: Config): Promise<MemoryPluginMetadata[]> {
  const plugins: MemoryPluginMetadata[] = [];
  for (const extension of discoverMemoryProviderExtensions(config)) {
    for (const providerId of extension.manifest.contracts?.memoryProviders ?? []) {
      plugins.push({
        name: providerId,
        description: extension.manifest.description ?? `${extension.manifest.name} memory provider`,
        available: true,
        manifest: {
          type: 'memory-provider',
          id: providerId,
          displayName: extension.manifest.name || providerId,
          entry: extension.manifest.main,
          capabilities: {},
        },
      });
    }
  }
  return plugins.sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadMemoryPluginProviders(params: {
  config?: Config;
} = {}): Promise<MemoryProvider[]> {
  const providers: MemoryProvider[] = [];
  for (const extension of discoverMemoryProviderExtensions(params.config)) {
    const module = await loadMemoryProviderModule(extension);
    if (!module?.createMemoryProvider) continue;
    if (module.isAvailable?.() === false) continue;

    const declaredProviderIds = extension.manifest.contracts?.memoryProviders ?? [];
    const fallbackId = declaredProviderIds[0] ?? extension.id;
    const manifest = normalizeMemoryProviderManifest(fallbackId, module.manifest) ?? {
      type: 'memory-provider',
      id: fallbackId,
      displayName: extension.manifest.name || fallbackId,
      entry: extension.manifest.main,
      capabilities: {},
    };

    const provider = await module.createMemoryProvider({
      config: params.config,
      manifest,
      extension: {
        id: extension.id,
        path: extension.path,
        source: extension.source,
        config: extensionConfig(params.config, extension.id),
      },
    });
    providers.push(provider);
  }
  return providers;
}

function discoverMemoryProviderExtensions(config?: Config): DiscoveredExtension[] {
  if (areExtensionsDisabled(config)) return [];
  const disabled = new Set(extensionIds(config?.extensions?.disabled));
  const enabled = config?.extensions?.enabled;
  const enabledSet = Array.isArray(enabled) ? new Set(extensionIds(enabled)) : null;
  return discoverExtensionsFromDisk({}, config as unknown as Record<string, unknown> | undefined)
    .filter((extension) => (extension.manifest.contracts?.memoryProviders?.length ?? 0) > 0)
    .filter((extension) => !disabled.has(extension.id))
    .filter((extension) => extension.manifest.enabledByDefault === true || enabledSet?.has(extension.id));
}

async function loadMemoryProviderModule(extension: DiscoveredExtension): Promise<MemoryPluginModule | null> {
  if (!extension.manifest.main) return null;
  const entryPath = isAbsolute(extension.manifest.main)
    ? extension.manifest.main
    : join(extension.path, extension.manifest.main);
  const resolved = await resolveModuleEntry(entryPath);
  try {
    const mod = (await import(pathToFileURL(resolved).href)) as MemoryPluginModule | { default?: MemoryPluginModule };
    return 'default' in mod && mod.default ? mod.default : (mod as MemoryPluginModule);
  } catch {
    return null;
  }
}

async function resolveModuleEntry(entryPath: string): Promise<string> {
  for (const candidate of entryCandidates(entryPath)) {
    try {
      await stat(candidate);
      return candidate;
    } catch {
      // Try the next candidate; source tests use .ts, builds use .js.
    }
  }
  return entryPath;
}

function entryCandidates(entryPath: string): string[] {
  const candidates = [entryPath];
  if (entryPath.endsWith('.js')) {
    candidates.push(`${entryPath.slice(0, -3)}.ts`);
  }
  return candidates;
}

function extensionIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function areExtensionsDisabled(config?: Config): boolean {
  return config?.extensions?.enabled === false;
}

function extensionConfig(config: Config | undefined, extensionId: string): Record<string, unknown> | undefined {
  const raw = config?.extensions?.[extensionId as keyof Config['extensions']];
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined;
}

function normalizeMemoryProviderManifest(
  fallbackId: string,
  manifest: MemoryProviderManifest | undefined,
): MemoryProviderManifest | undefined {
  if (!manifest || manifest.type !== 'memory-provider') return undefined;
  const id = typeof manifest.id === 'string' && manifest.id.trim() ? manifest.id.trim() : fallbackId;
  const displayName =
    typeof manifest.displayName === 'string' && manifest.displayName.trim()
      ? manifest.displayName.trim()
      : id;
  return {
    type: 'memory-provider',
    id,
    displayName,
    ...(manifest.entry ? { entry: manifest.entry } : {}),
    capabilities: manifest.capabilities ?? {},
    ...(manifest.configSchema ? { configSchema: manifest.configSchema } : {}),
  };
}
