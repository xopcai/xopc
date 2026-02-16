/**
 * Models.dev Provider
 *
 * Provides local model data cached from models.dev API.
 * models.dev is a comprehensive open-source database of AI model specifications.
 * 
 * This module provides the cached model data without requiring network requests at runtime.
 */

import type { Api, Model } from '@mariozechner/pi-ai';
import { LOCAL_MODELS_DEV_DATA } from './models-dev-data.js';

/**
 * Get all models from local cached data
 */
export function getLocalModelsDevModels(): Map<string, Model<Api>[]> {
	const models = new Map<string, Model<Api>[]>();

	for (const [provider, providerModels] of Object.entries(LOCAL_MODELS_DEV_DATA)) {
		models.set(provider, providerModels as Model<Api>[]);
	}

	return models;
}

/**
 * Get models for a specific provider from local data
 */
export function getLocalModelsDevModelsForProvider(provider: string): Model<Api>[] {
	return LOCAL_MODELS_DEV_DATA[provider] ?? [];
}

/**
 * Provider info from models.dev data
 */
export interface ModelsDevProviderInfo {
	id: string;
	name: string;
	api?: string;
	envKey?: string;
}

/**
 * Get provider info list from local data
 */
export function getModelsDevProviders(): ModelsDevProviderInfo[] {
	const providers: ModelsDevProviderInfo[] = [];
	const localModels = getLocalModelsDevModels();

	for (const [providerId, models] of localModels) {
		// Extract provider name from first model
		const model = models[0];
		providers.push({
			id: providerId,
			name: model?.provider ?? providerId,
		});
	}

	return providers;
}
