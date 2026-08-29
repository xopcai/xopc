import type { Config } from '../../config/schema.js';
import { createLogger } from '../../utils/logger.js';
import { startLocalVoiceModelInstall } from './model-manager.js';
import { DEFAULT_LOCAL_VOICE_MODEL_ID, isLocalVoiceModelInstalled } from './models.js';

const log = createLogger('Voice:Local');

export function localVoiceModelForProviderSwitch(
  previousProvider: string | undefined,
  config: Config,
): string | null {
  const audio = config.tools?.media?.audio;
  const previous = previousProvider?.trim() || 'xopc-local';
  if (audio?.enabled === false || previous === 'xopc-local' || audio?.provider !== 'xopc-local') {
    return null;
  }
  const configuredModel = audio.providers?.['xopc-local']?.model;
  return typeof configuredModel === 'string' && configuredModel.trim()
    ? configuredModel.trim()
    : DEFAULT_LOCAL_VOICE_MODEL_ID;
}

/** Start a missing local STT model only after the provider changes to xopc-local. */
export function prepareLocalVoiceModelAfterProviderSwitch(
  previousProvider: string | undefined,
  config: Config,
): void {
  const modelId = localVoiceModelForProviderSwitch(previousProvider, config);
  if (!modelId || isLocalVoiceModelInstalled(modelId)) return;
  try {
    startLocalVoiceModelInstall(modelId);
    log.info({ modelId, phase: 'provider_switch' }, 'Local voice model preparation started');
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log.warn(
      { err, modelId, errorMessage, phase: 'provider_switch' },
      `Local voice model preparation failed: ${errorMessage}`,
    );
  }
}
