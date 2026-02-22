/**
 * Models.dev Provider (DEPRECATED)
 *
 * This module is deprecated. All models are now loaded from @mariozechner/pi-ai.
 * 
 * The models-dev-data.ts file has been removed in favor of the centralized
 * model definitions in the pi-ai package.
 */

import type { Api, Model } from '@mariozechner/pi-ai';

/**
 * @deprecated Use pi-ai directly instead
 * Get all models from local cached data
 */
export function getLocalModelsDevModels(): Map<string, Model<Api>[]> {
	// Return empty map - all models now come from pi-ai
	return new Map();
}

/**
 * @deprecated Use pi-ai directly instead
 * Get models for a specific provider from local data
 */
export function getLocalModelsDevModelsForProvider(_provider: string): Model<Api>[] {
	// Return empty array - all models now come from pi-ai
	return [];
}

/**
 * Provider info from models.dev data
 * @deprecated No longer needed
 */
export interface ModelsDevProviderInfo {
	id: string;
	name: string;
	api?: string;
	envKey?: string;
}

/**
 * @deprecated Use pi-ai directly instead
 * Get provider info list from local data
 */
export function getModelsDevProviders(): ModelsDevProviderInfo[] {
	// Return empty array - all providers now come from pi-ai
	return [];
}
