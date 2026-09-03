/**
 * Models.json configuration types and schema
 * 
 * Supports custom providers and models (Ollama, vLLM, LM Studio, proxies)
 * 
 * File location: ~/.xopc/models.json (or XOPC_MODELS_JSON env var)
 */

import { z } from 'zod';
import { existsSync, readFileSync } from 'fs';
import { writeTextAtomicSync } from '../infra/write-file-atomic.js';
import { resolveModelsJsonPath } from './paths.js';

// Re-export for convenience
export { resolveModelsJsonPath as getModelsJsonPath } from './paths.js';

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
	thinkingFormat: z.enum(['openai', 'zai', 'dashscope', 'qwen', 'qwen-chat-template', 'chat-template', 'deepseek', 'openrouter', 'together', 'string-thinking', 'baseten', 'ant-ling']).optional(),
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
// Image Generation Definition
// ============================================

const ImageGenerationResolutionSchema = z.enum(['1K', '2K', '4K']);
const ImageGenerationQualitySchema = z.enum(['low', 'medium', 'high', 'auto']);
const ImageGenerationOutputFormatSchema = z.enum(['png', 'jpeg', 'webp']);
const ImageGenerationBackgroundSchema = z.enum(['transparent', 'opaque', 'auto']);

export const ImageGenerationCapabilitiesSchema = z.object({
	generate: z.object({
		maxCount: z.number().int().positive().optional(),
		supportsSize: z.boolean().optional(),
		supportsAspectRatio: z.boolean().optional(),
		supportsResolution: z.boolean().optional(),
	}).strict().optional(),
	edit: z.object({
		enabled: z.boolean(),
		maxInputImages: z.number().int().positive().optional(),
		supportsSize: z.boolean().optional(),
		supportsAspectRatio: z.boolean().optional(),
	}).strict().optional(),
	geometry: z.object({
		sizes: z.array(z.string().min(1)).optional(),
		aspectRatios: z.array(z.string().min(1)).optional(),
		resolutions: z.array(ImageGenerationResolutionSchema).optional(),
	}).strict().optional(),
	output: z.object({
		qualities: z.array(ImageGenerationQualitySchema).optional(),
		formats: z.array(ImageGenerationOutputFormatSchema).optional(),
		backgrounds: z.array(ImageGenerationBackgroundSchema).optional(),
	}).strict().optional(),
}).strict();

export const ImageGenerationModelSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1).optional(),
	capabilities: ImageGenerationCapabilitiesSchema,
	defaults: z.object({
		count: z.number().int().positive().optional(),
		size: z.string().min(1).optional(),
		outputFormat: ImageGenerationOutputFormatSchema.optional(),
	}).strict().optional(),
}).strict();

export const ImageGenerationProviderSchema = z.object({
	api: z.literal('openai-images'),
	name: z.string().min(1),
	documentationUrl: z.string().url().optional(),
	apiKeyUrl: z.string().url().optional(),
	defaultModel: z.string().min(1),
	auth: z.discriminatedUnion('type', [
		z.object({ type: z.literal('bearer') }).strict(),
		z.object({
			type: z.literal('header'),
			headerName: z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/),
		}).strict(),
		z.object({ type: z.literal('none') }).strict(),
	]),
	paths: z.object({
		generations: z.string().startsWith('/').optional(),
		edits: z.string().startsWith('/').optional(),
	}).strict().optional(),
	network: z.object({
		allowedHosts: z.array(z.string().min(1).refine(
			(host) => host === host.trim() && !host.includes('://') && !/[/?#]/.test(host),
			'Use an exact hostname or IP without scheme, port, or path',
		)).min(1),
	}).strict().optional(),
	models: z.array(ImageGenerationModelSchema).min(1),
}).strict();

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
	thinkingLevelMap: z.partialRecord(z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']), z.string().nullable()).optional(),
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
	thinkingLevelMap: z.partialRecord(z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']), z.string().nullable()).optional(),
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
	modelDiscovery: z.object({ enabled: z.boolean() }).strict().optional(),
	imageGeneration: ImageGenerationProviderSchema.optional(),
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
export type ImageGenerationModelConfig = z.infer<typeof ImageGenerationModelSchema>;
export type ImageGenerationProviderConfig = z.infer<typeof ImageGenerationProviderSchema>;
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
/** pi-ai KnownProvider ids — overriding in models.json requires baseUrl (see validation below). */
const RESERVED_PROVIDER_IDS = new Set([
	'amazon-bedrock', 'anthropic', 'azure-openai-responses', 'cerebras',
	'cloudflare-ai-gateway', 'cloudflare-workers-ai', 'dashscope', 'deepseek', 'fal', 'fireworks', 'github-copilot',
	'google', 'google-antigravity', 'google-gemini-cli', 'google-vertex', 'groq',
	'huggingface', 'kimi-coding', 'minimax', 'minimax-cn', 'mistral', 'moonshotai', 'moonshotai-cn',
	'openai', 'openai-codex', 'opencode', 'opencode-go', 'openrouter',
	'together', 'vercel-ai-gateway', 'xai', 'xiaomi', 'xiaomi-token-plan-ams', 'xiaomi-token-plan-cn',
	'xiaomi-token-plan-sgp', 'zai',
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
		if (providerName === 'xopc-cloud') {
			errors.push({
				path: 'providers.xopc-cloud',
				message: 'xopc-cloud is managed by OAuth and the runtime model catalog; it cannot be configured in models.json',
				severity: 'error',
			});
			continue;
		}

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
		const imageGeneration = providerConfig.imageGeneration;

		if (imageGeneration) {
			if (RESERVED_PROVIDER_IDS.has(providerName)) {
				errors.push({
					path: `providers.${providerName}.imageGeneration`,
					message: 'Custom image generation cannot override a built-in provider ID',
					severity: 'error',
				});
			}
			if (!hasBaseUrl) {
				errors.push({
					path: `providers.${providerName}.baseUrl`,
					message: 'baseUrl is required when defining image generation models',
					severity: 'error',
				});
			}

			const credentialHeaderNames = new Set([
				'authorization',
				'proxy-authorization',
				'cookie',
				...(imageGeneration.auth.type === 'header'
					? [imageGeneration.auth.headerName.toLowerCase()]
					: []),
			]);
			for (const headerName of Object.keys(providerConfig.headers ?? {})) {
				if (credentialHeaderNames.has(headerName.toLowerCase())) {
					errors.push({
						path: `providers.${providerName}.headers.${headerName}`,
						message: 'Credential headers must be stored in the credential store, not models.json',
						severity: 'error',
					});
				}
			}
			for (const [headerName, headerValue] of Object.entries(providerConfig.headers ?? {})) {
				if (!isHttpHeaderValue(headerValue)) {
					errors.push({
						path: `providers.${providerName}.headers.${headerName}`,
						message: 'Header values must contain only HTTP ByteString characters and no control characters',
						severity: 'error',
					});
				}
			}

			const imageModelIds = new Set<string>();
			for (let i = 0; i < imageGeneration.models.length; i++) {
				const model = imageGeneration.models[i];
				if (model.id.includes('/')) {
					errors.push({
						path: `providers.${providerName}.imageGeneration.models[${i}].id`,
						message: 'Image model ID cannot contain "/" character',
						severity: 'error',
					});
				}
				if (imageModelIds.has(model.id)) {
					errors.push({
						path: `providers.${providerName}.imageGeneration.models[${i}].id`,
						message: `Duplicate image model ID "${model.id}"`,
						severity: 'error',
					});
				}
				imageModelIds.add(model.id);
			}
			if (!imageModelIds.has(imageGeneration.defaultModel)) {
				errors.push({
					path: `providers.${providerName}.imageGeneration.defaultModel`,
					message: 'defaultModel must reference a configured image generation model',
					severity: 'error',
				});
			}
		}

		// Custom models require an endpoint. Credentials may live in the auth profile store.
		if (hasModels) {
			if (!hasBaseUrl) {
				errors.push({
					path: `providers.${providerName}.baseUrl`,
					message: 'baseUrl is required when defining custom models',
					severity: 'error',
				});
			}
		}

		// If no models and no baseUrl and no modelOverrides, apiKey alone is valid (auth for built-in providers)
		if (!hasModels && !hasBaseUrl && !hasModelOverrides && !providerConfig.apiKey && !imageGeneration) {
			errors.push({
				path: `providers.${providerName}`,
				message: 'Must specify baseUrl, modelOverrides, models, or apiKey',
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

function isHttpHeaderValue(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code > 255 || (code < 32 && code !== 9) || code === 127) return false;
	}
	return true;
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

// ============================================
// File Operations
// ============================================

/**
 * Load models.json from disk
 */
export function loadModelsJson(path: string = resolveModelsJsonPath()): { config: ModelsJsonConfig; error?: string } {
	if (!existsSync(path)) {
		return { config: { providers: {} } };
	}

	try {
		const content = readFileSync(path, 'utf-8');
		const config = JSON.parse(content);
		const validation = validateModelsConfig(config);
		
		if (!validation.valid) {
			const errors = validation.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
			return { config, error: `Validation failed: ${errors}` };
		}
		
		return { config };
	} catch (error) {
		return {
			config: { providers: {} },
			error: error instanceof Error ? error.message : 'Failed to load models.json',
		};
	}
}

/**
 * Save models.json to disk
 */
export function saveModelsJson(path: string, config: ModelsJsonConfig): { success: boolean; error?: string } {
	try {
		// Validate before saving
		const validation = validateModelsConfig(config);
		if (!validation.valid) {
			const errors = validation.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
			return { success: false, error: `Validation failed: ${errors}` };
		}

		writeTextAtomicSync(path, JSON.stringify(config, null, 2));
		return { success: true };
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Failed to save models.json',
		};
	}
}

/**
 * Check if models.json exists
 */
export function modelsJsonExists(path: string = resolveModelsJsonPath()): boolean {
	return existsSync(path);
}
