/**
 * Decides which extensions to activate from manifest metadata + config + env.
 */

import type { ManifestRegistry, ManifestRegistryEntry } from './manifest-registry.js';

export type ActivationLoadPhase = 'startup' | 'deferred';

export type ActivationReason =
  | 'explicit_enabled'
  | 'explicit_disabled'
  | 'enabled_by_default'
  | 'model_match'
  | 'env_var_detected'
  | 'auto_enable_provider'
  | 'activation_trigger'
  | 'not_activated';

export interface ActivationDecision {
  extensionId: string;
  activated: boolean;
  reason: ActivationReason;
  trigger?: string;
}

export interface ActivationContext {
  enabledIds?: string[];
  disabledIds?: string[];
  requestedModelId?: string;
  configuredProviderIds?: string[];
  configuredChannelIds?: string[];
  env?: NodeJS.ProcessEnv;
}

export class ActivationPlanner {
  constructor(private registry: ManifestRegistry) {}

  plan(context: ActivationContext): ActivationDecision[] {
    const decisions: ActivationDecision[] = [];
    const decided = new Set<string>();

    if (context.enabledIds) {
      for (const id of context.enabledIds) {
        decisions.push({
          extensionId: id,
          activated: true,
          reason: 'explicit_enabled',
        });
        decided.add(id);
      }
    }

    if (context.disabledIds) {
      for (const id of context.disabledIds) {
        if (!decided.has(id)) {
          decisions.push({
            extensionId: id,
            activated: false,
            reason: 'explicit_disabled',
          });
          decided.add(id);
        }
      }
    }

    if (context.requestedModelId) {
      const entry = this.registry.findByModelId(context.requestedModelId);
      if (entry && !decided.has(entry.id)) {
        decisions.push({
          extensionId: entry.id,
          activated: true,
          reason: 'model_match',
          trigger: context.requestedModelId,
        });
        decided.add(entry.id);
      }
    }

    if (context.env) {
      const envEntries = this.registry.detectAvailableByEnv(context.env);
      for (const entry of envEntries) {
        if (!decided.has(entry.id)) {
          const triggerVar = this.findTriggerEnvVar(entry, context.env);
          decisions.push({
            extensionId: entry.id,
            activated: true,
            reason: 'env_var_detected',
            trigger: triggerVar,
          });
          decided.add(entry.id);
        }
      }
    }

    if (context.configuredProviderIds) {
      for (const entry of this.registry.getAllEntries()) {
        if (decided.has(entry.id)) continue;

        const autoEnableProviders = entry.manifest.autoEnableWhenConfiguredProviders;
        if (autoEnableProviders) {
          const matchedProvider = autoEnableProviders.find((pid) =>
            context.configuredProviderIds!.includes(pid),
          );
          if (matchedProvider) {
            decisions.push({
              extensionId: entry.id,
              activated: true,
              reason: 'auto_enable_provider',
              trigger: matchedProvider,
            });
            decided.add(entry.id);
          }
        }
      }
    }

    for (const entry of this.registry.getAllEntries()) {
      if (decided.has(entry.id)) continue;

      const activation = entry.manifest.activation;
      if (!activation) continue;

      if (activation.onProviders && context.configuredProviderIds) {
        const matched = activation.onProviders.find((pid) =>
          context.configuredProviderIds!.includes(pid),
        );
        if (matched) {
          decisions.push({
            extensionId: entry.id,
            activated: true,
            reason: 'activation_trigger',
            trigger: `provider:${matched}`,
          });
          decided.add(entry.id);
          continue;
        }
      }

      if (activation.onChannels && context.configuredChannelIds) {
        const matched = activation.onChannels.find((cid) =>
          context.configuredChannelIds!.includes(cid),
        );
        if (matched) {
          decisions.push({
            extensionId: entry.id,
            activated: true,
            reason: 'activation_trigger',
            trigger: `channel:${matched}`,
          });
          decided.add(entry.id);
          continue;
        }
      }
    }

    for (const entry of this.registry.getAllEntries()) {
      if (decided.has(entry.id)) continue;

      if (entry.manifest.enabledByDefault) {
        decisions.push({
          extensionId: entry.id,
          activated: true,
          reason: 'enabled_by_default',
        });
        decided.add(entry.id);
      }
    }

    for (const entry of this.registry.getAllEntries()) {
      if (!decided.has(entry.id)) {
        decisions.push({
          extensionId: entry.id,
          activated: false,
          reason: 'not_activated',
        });
      }
    }

    return decisions;
  }

  getActivatedIds(context: ActivationContext): string[] {
    return this.plan(context)
      .filter((d) => d.activated)
      .map((d) => d.extensionId);
  }

  /**
   * Split activated ids by manifest `activation.onStartup`.
   * Extensions without the field remain on the startup path (backward compatible).
   */
  filterActivatedIdsByLoadPhase(
    activatedIds: readonly string[],
    phase: ActivationLoadPhase,
  ): string[] {
    return activatedIds.filter((extensionId) => {
      const entry = this.registry.getEntry(extensionId);
      const onStartup = entry?.manifest.activation?.onStartup;
      const eager = onStartup !== false;
      return phase === 'startup' ? eager : !eager;
    });
  }

  explainPlan(context: ActivationContext): string {
    const decisions = this.plan(context);
    const lines: string[] = ['Extension Activation Plan:'];

    for (const decision of decisions) {
      const status = decision.activated ? '✅' : '❌';
      const trigger = decision.trigger ? ` (trigger: ${decision.trigger})` : '';
      lines.push(`  ${status} ${decision.extensionId}: ${decision.reason}${trigger}`);
    }

    return lines.join('\n');
  }

  private findTriggerEnvVar(
    entry: ManifestRegistryEntry,
    env: NodeJS.ProcessEnv,
  ): string | undefined {
    const manifest = entry.manifest;

    if (manifest.providerAuthEnvVars) {
      for (const envVars of Object.values(manifest.providerAuthEnvVars)) {
        for (const envVar of envVars) {
          if (env[envVar]) return envVar;
        }
      }
    }

    if (manifest.channelEnvVars) {
      for (const envVars of Object.values(manifest.channelEnvVars)) {
        for (const envVar of envVars) {
          if (env[envVar]) return envVar;
        }
      }
    }

    return undefined;
  }
}
