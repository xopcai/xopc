/**
 * Compute `extensions` config changes for enabling/disabling a bundled extension from the gateway UI.
 * Activation is manifest-driven; `extensions.enabled` / `extensions.disabled` are merged in {@link mergeActivationContext}.
 */

import type { Config as SurfaceConfig } from '../config/config-surface.js';
import type { Config as SchemaConfig } from '../config/schema.js';
import { mergeActivationContext } from './activation-context.js';
import { ActivationPlanner } from './activation-planner.js';
import type { ExtensionLoader } from './loader.js';

function asSurfaceConfig(config: SchemaConfig): SurfaceConfig {
  return config as unknown as SurfaceConfig;
}

function filterStringIds(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val.filter((x): x is string => typeof x === 'string');
}

function optionalEnabledIds(val: unknown): string[] | undefined {
  if (!Array.isArray(val)) return undefined;
  const ids = filterStringIds(val);
  return ids.length > 0 ? ids : undefined;
}

function buildExtensionsRecord(
  base: Record<string, unknown>,
  enabled: string[] | undefined,
  disabled: string[],
): Record<string, unknown> {
  const o = { ...base };
  if (enabled !== undefined && enabled.length > 0) {
    o.enabled = enabled;
  } else {
    delete o.enabled;
  }
  if (disabled.length > 0) {
    o.disabled = disabled;
  } else {
    delete o.disabled;
  }
  return o;
}

export function isExtensionActivationEligible(
  loader: ExtensionLoader,
  config: SchemaConfig,
  extensionId: string,
): boolean {
  const surface = asSurfaceConfig(config);
  loader.setConfig(surface);
  const registry = loader.buildManifestRegistry();
  const planner = new ActivationPlanner(registry);
  return planner.getActivatedIds(mergeActivationContext(surface)).includes(extensionId);
}

export function computeBundledExtensionExtensionsPatch(
  loader: ExtensionLoader,
  config: SchemaConfig,
  extensionId: string,
  wanted: boolean,
): { ok: true; extensions: Record<string, unknown> } | { ok: false; error: string } {
  const discovered = loader.discoverExtensions();
  const hit = discovered.find((e) => e.id === extensionId);
  if (!hit) {
    return { ok: false, error: 'Extension not found' };
  }
  if (hit.source !== 'bundled') {
    return {
      ok: false,
      error:
        'Only bundled extensions can be toggled here (workspace or global installs override the same id — use CLI to manage those).',
    };
  }

  const base = (config.extensions as Record<string, unknown> | undefined) ?? {};
  let enabled = optionalEnabledIds(base.enabled);
  let disabled = filterStringIds(base.disabled);

  if (wanted) {
    disabled = disabled.filter((id) => id !== extensionId);
    let candidate = buildExtensionsRecord(base, enabled, disabled);
    if (
      !isExtensionActivationEligible(
        loader,
        { ...config, extensions: candidate } as SchemaConfig,
        extensionId,
      )
    ) {
      const nextEnabled = [...(enabled ?? [])];
      if (!nextEnabled.includes(extensionId)) {
        nextEnabled.push(extensionId);
      }
      enabled = nextEnabled;
      candidate = buildExtensionsRecord(base, enabled, disabled);
    }
    if (
      !isExtensionActivationEligible(
        loader,
        { ...config, extensions: candidate } as SchemaConfig,
        extensionId,
      )
    ) {
      return {
        ok: false,
        error:
          'Extension would still not activate with current settings (channels, environment, or activation rules).',
      };
    }
    return { ok: true, extensions: candidate };
  }

  if (enabled) {
    enabled = enabled.filter((id) => id !== extensionId);
    if (enabled.length === 0) {
      enabled = undefined;
    }
  }
  if (!disabled.includes(extensionId)) {
    disabled = [...disabled, extensionId];
  }
  const candidate = buildExtensionsRecord(base, enabled, disabled);
  return { ok: true, extensions: candidate };
}
