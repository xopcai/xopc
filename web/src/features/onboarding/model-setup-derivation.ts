import type { ConfiguredModel } from '@/features/chat/api/registry-api';
import { needsModelOrProviders } from '@/features/gateway/model-setup-state';

export type ModelSetupDerivationInput = {
  enabled: boolean;
  ready: boolean;
  configError: unknown;
  modelsError: unknown;
  config: unknown;
  modelsData: ConfiguredModel[] | undefined;
};

/**
 * Whether to show first-run model/provider onboarding.
 * Fetch errors (gateway still starting, network) must not open the modal — only a successful
 * config/models response that shows missing setup should.
 */
export function computeNeedsModelSetup(input: ModelSetupDerivationInput): boolean {
  const { enabled, ready, configError, modelsError, config, modelsData } = input;
  if (!enabled || !ready) return false;
  if (configError || modelsError) return false;
  const configNeeds = needsModelOrProviders(config);
  const noUsableModels = !Array.isArray(modelsData) || modelsData.length === 0;
  return configNeeds || noUsableModels;
}
