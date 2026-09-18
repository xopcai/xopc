import { checkEngineCompatibility, type EngineCheckResult } from './engine-check.js';

export const EXTENSION_API_VERSION = '1.0.0';
export const EXTENSION_UI_API_VERSION = '1.0.0';

export function checkExtensionApiCompatibility(
  requiredRange: string | undefined,
  currentVersion: string,
  engineName: 'extensionApi' | 'extensionUiApi',
): EngineCheckResult {
  if (!requiredRange) return { compatible: true };
  const result = checkEngineCompatibility(currentVersion, requiredRange);
  if (!result.compatible || result.parseWarning) {
    return {
      ...result,
      reason: result.parseWarning
        ? `Could not parse engines.${engineName} range: "${requiredRange}"`
        : `${engineName} version ${currentVersion} does not satisfy engines.${engineName}: "${requiredRange}"`,
    };
  }
  return result;
}
