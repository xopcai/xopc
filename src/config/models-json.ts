/**
 * Models.json configuration types and schema
 * 
 * Supports custom providers and models (Ollama, vLLM, LM Studio, proxies)
 */

import { z } from 'zod';

// ============================================
// OpenAI Compatibility Settings
// ============================================

export const OpenRouterRoutingSchema = z.object({
	only: z.array(z.string()).optional(),
	order: z.array(z.string()).optional(),
});

export const VercelGatewayRoutingSchema = z.object({
	only: z.array(z.string()).optional(),
	order: z.array(z.string()).optional(),
});

export const OpenAICompletionsCompatSchema = z.object({
	supportsStore: z.boolean().optional(),
	supportsDeveloperRole: z.boolean().optional(),
	supportsReasoningEffort: z.boolean().optional(),
	supportsUsageInStreaming: z.boolean().optional(),
	maxTokensField: z.enum(['max_completion_tokens', 'max_tokens']).optional(),
	requiresToolResultName: z.boolean().optional(),
	requiresAssistantAfterToolResult: z.boolean().optional(),
	requiresThinkingAsText: z.boolean().optional(),
	requiresMistralToolIds: z.boolean().optional(),
	thinkingFormat: z.enum(['openai', 'zai', 'qwen']).optional(),
	openRouterRouting: OpenRouterRoutingSchema.optional(),
	vercelGatewayRouting: VercelGatewayRoutingSchema.optional(),
	supportsStrictMode: z.boolean().optional(),
});

export const OpenAIResponsesCompatSchema = z.object({});

export const OpenAICompatSchema = z.union([
	OpenAICompletionsCompatSchema,
	OpenAIResponsesCompatSchema,
]);

// ============================================
// Model Definition
// ============================================

export const CustomModelSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1).optional(),
	api: z.enum([
		'openai-completions',
		'openai-responses',
		'anthropic-messages',
		'google-generative-ai',
		'azure-openai-responses',
		'bedrock-converse-stream',
		'openai-codex-responses',
		'google-gemini-cli',
		'google-vertex',
	]).optional(),
	reasoning: z.boolean().optional(),
	input: z.array(z.enum(['text', 'image'])).optional(),
	contextWindow: z.number().positive().optional(),
	maxTokens: z.number().positive().optional(),
	cost: z.object({
		input: z.number(),
		output: z.number(),
		cacheRead: z.number(),
		cacheWrite: z.number(),
	}).optional(),
	headers: z.record(z.string(), z.string()).optional(),
	compat: OpenAICompatSchema.optional(),
});

// ============================================
// Model Override (for built-in models)
// ============================================

export const ModelOverrideSchema = z.object({
	name: z.string().min(1).optional(),
	reasoning: z.boolean().optional(),
	input: z.array(z.enum(['text', 'image'])).optional(),
	contextWindow: z.number().positive().optional(),
	maxTokens: z.number().positive().optional(),
	cost: z.object({
		input: z.number().optional(),
		output: z.number().optional(),
		cacheRead: z.number().optional(),
		cacheWrite: z.number().optional(),
	}).optional(),
	headers: z.record(z.string(), z.string()).optional(),
	compat: OpenAICompatSchema.optional(),
});

// ============================================
// Provider Configuration
// ============================================

export const ProviderConfigSchema = z.object({
	baseUrl: z.string().url().optional(),
	apiKey: z.string().optional(),
	api: z.enum([
		'openai-completions',
		'openai-responses',
		'anthropic-messages',
		'google-generative-ai',
		'azure-openai-responses',
		'bedrock-converse-stream',
		'openai-codex-responses',
		'google-gemini-cli',
		'google-vertex',
	]).optional(),
	headers: z.record(z.string(), z.string()).optional(),
	authHeader: z.boolean().optional(),
	models: z.array(CustomModelSchema).optional(),
	modelOverrides: z.record(z.string(), ModelOverrideSchema).optional(),
});

// ============================================
// Root Models.json Schema
// ============================================

export const ModelsJsonSchema = z.object({
	providers: z.record(z.string(), ProviderConfigSchema),
});

// ============================================
// TypeScript Types
// ============================================

export type OpenRouterRouting = z.infer<typeof OpenRouterRoutingSchema>;
export type VercelGatewayRouting = z.infer<typeof VercelGatewayRoutingSchema>;
export type OpenAICompletionsCompat = z.infer<typeof OpenAICompletionsCompatSchema>;
export type OpenAIResponsesCompat = z.infer<typeof OpenAIResponsesCompatSchema>;
export type OpenAICompat = z.infer<typeof OpenAICompatSchema>;
export type CustomModel = z.infer<typeof CustomModelSchema>;
export type ModelOverride = z.infer<typeof ModelOverrideSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type ModelsJsonConfig = z.infer<typeof ModelsJsonSchema>;

// ============================================
// Validation Types
// ============================================

export interface ValidationError {
	path: string;
	message: string;
	severity: 'error' | 'warning';
}

export interface ValidationResult {
	valid: boolean;
	errors: ValidationError[];
}

// ============================================
// Strict Provider ID Validation
// ============================================

const PROVIDER_ID_REGEX = /^[a-z0-9]([a-z0-9-_]*[a-z0-9])?$/;
const RESERVED_PROVIDER_IDS = new Set([
	'openai', 'anthropic', 'google', 'groq', 'deepseek', 'minimax', 'mistral',
	'xai', 'cerebras', 'openrouter', 'huggingface', 'opencode', 'zai',
	'amazon-bedrock', 'azure-openai-responses', 'google-vertex', 'vercel-ai-gateway',
	'github-copilot', 'openai-codex', 'google-gemini-cli', 'google-antigravity'
]);

// ============================================
// Validation Function
// ============================================

export function validateModelsConfig(config: unknown): ValidationResult {
	const errors: ValidationError[] = [];

	const result = ModelsJsonSchema.safeParse(config);
	
	if (!result.success) {
		for (const issue of result.error.issues) {
			errors.push({
				path: issue.path.join('.'),
				message: issue.message,
				severity: 'error',
			});
		}
		return { valid: false, errors };
	}

	const data = result.data;

	// Additional validation rules
	for (const [providerName, providerConfig] of Object.entries(data.providers)) {
		// Validate provider ID format
		if (!PROVIDER_ID_REGEX.test(providerName)) {
			errors.push({
				path: `providers.${providerName}`,
				message: 'Provider ID must start/end with alphanumeric, contain only lowercase letters, numbers, hyphens, and underscores',
				severity: 'error',
			});
		}

		// Warn about reserved provider IDs (can override but not recommended)
		if (RESERVED_PROVIDER_IDS.has(providerName) && !providerConfig.baseUrl) {
			errors.push({
				path: `providers.${providerName}`,
				message: `Overriding built-in provider "${providerName}" requires baseUrl to be specified`,
				severity: 'warning',
			});
		}

		const hasModels = providerConfig.models && providerConfig.models.length > 0;
		const hasModelOverrides = providerConfig.modelOverrides && Object.keys(providerConfig.modelOverrides).length > 0;
		const hasBaseUrl = !!providerConfig.baseUrl;

		// If defining custom models, baseUrl and apiKey are required
		if (hasModels) {
			if (!hasBaseUrl) {
				errors.push({
					path: `providers.${providerName}.baseUrl`,
					message: 'baseUrl is required when defining custom models',
					severity: 'error',
				});
			}
			if (!providerConfig.apiKey) {
				errors.push({
					path: `providers.${providerName}.apiKey`,
					message: 'apiKey is required when defining custom models',
					severity: 'error',
				});
			}
		}

		// If no models and no baseUrl and no modelOverrides, it's invalid
		if (!hasModels && !hasBaseUrl && !hasModelOverrides) {
			errors.push({
				path: `providers.${providerName}`,
				message: 'Must specify baseUrl, modelOverrides, or models',
				severity: 'error',
			});
		}

		// Validate each model
		if (providerConfig.models) {
			for (let i = 0; i < providerConfig.models.length; i++) {
				const model = providerConfig.models[i];
				if (!model.api && !providerConfig.api) {
					errors.push({
						path: `providers.${providerName}.models[${i}].api`,
						message: 'api is required when not specified at provider level',
						severity: 'error',
					});
				}

				// Validate model ID doesn't contain slashes
				if (model.id.includes('/')) {
					errors.push({
						path: `providers.${providerName}.models[${i}].id`,
						message: 'Model ID cannot contain "/" character',
						severity: 'error',
					});
				}

				// Validate cost values are non-negative
				if (model.cost) {
					const costFields = ['input', 'output', 'cacheRead', 'cacheWrite'] as const;
					for (const field of costFields) {
						const value = model.cost[field];
						if (value !== undefined && value < 0) {
							errors.push({
								path: `providers.${providerName}.models[${i}].cost.${field}`,
								message: 'Cost value cannot be negative',
								severity: 'error',
							});
						}
					}
				}
			}
		}

		// Validate modelOverrides keys don't contain slashes
		if (providerConfig.modelOverrides) {
			for (const modelId of Object.keys(providerConfig.modelOverrides)) {
				if (!modelId.includes('/')) {
					errors.push({
						path: `providers.${providerName}.modelOverrides.${modelId}`,
						message: 'Model override key should be in format "provider/model-id"',
						severity: 'warning',
					});
				}
			}
		}
	}

	return {
		valid: errors.filter(e => e.severity === 'error').length === 0,
		errors,
	};
}

// ============================================
// Default Values
// ============================================

export function getDefaultModelValues(): Required<Pick<CustomModel, 'input' | 'contextWindow' | 'maxTokens' | 'cost'>> {
	return {
		input: ['text'],
		contextWindow: 128000,
		maxTokens: 16384,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		},
	};
}
