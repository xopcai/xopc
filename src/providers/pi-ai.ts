/**
 * Pi-AI Provider Adapter (Refactored)
 * 
 * Unified LLM provider for xopcbot.
 * Now uses ModelRegistry for dynamic model loading.
 * 
 * Supports:
 * - Native models: OpenAI, Anthropic, Google, MiniMax, Groq, OpenRouter, xAI, etc.
 * - OpenAI-compatible APIs: Qwen, Kimi, DeepSeek via direct API
 * - Custom providers via models.json
 */

import * as PiAI from '@mariozechner/pi-ai';
import type { LLMProvider } from '../types/index.js';
import type { Config } from '../config/schema.js';
import { getApiKey } from '../config/schema.js';
import { ModelRegistry } from './registry.js';

export { PiAI };
export type { LLMProvider };

// ============================================
// Provider Implementation (New Architecture)
// ============================================

export class LLMProviderImpl implements LLMProvider {
	private model: PiAI.Model<PiAI.Api>;
	private modelId: string;
	private registry: ModelRegistry;
	private config: Config;

	constructor(config: Config, modelId: string) {
		this.config = config;
		this.modelId = modelId;
		this.registry = new ModelRegistry(config);

		// Parse model ref (provider/modelId format)
		const model = this.registry.findByRef(modelId);

		if (!model) {
			throw new Error(`Model not found: ${modelId}. Run 'xopcbot models list' to see available models.`);
		}

		this.model = model;
	}

	/**
	 * Get API key for the current model
	 */
	private getApiKey(): string | undefined {
		return getApiKey(this.config, this.model.provider);
	}

	async chat(
		messages: any[],
		tools?: any[],
		_model?: string,
		maxTokens?: number,
		temperature?: number
	): Promise<any> {
		const apiKey = this.getApiKey();
		const context = this.buildContext(messages, tools);

		try {
			const options: any = {
				apiKey,
				maxTokens,
				temperature: temperature ?? 0.7,
			};

			// Add provider-specific options based on API type
			if (this.model.api === 'anthropic-messages') {
				options.thinkingEnabled = this.model.reasoning;
				options.thinkingBudgetTokens = maxTokens ? Math.min(maxTokens, 8192) : 8192;
			} else if (this.model.api === 'google-generative-ai') {
				options.thinking = {
					enabled: this.model.reasoning,
					budgetTokens: maxTokens ? Math.min(maxTokens, 8192) : 8192,
				};
			} else if (this.model.api === 'openai-completions' && this.model.reasoning) {
				const compat = this.model.compat as any;
				if (compat?.thinkingFormat === 'qwen') {
					options.enableThinking = true;
				} else {
					options.reasoningEffort = 'medium';
				}
			}

			const result = await (PiAI.complete as any)(this.model, context, options);

			// Handle errors
			if (result.stopReason === 'error' || result.stopReason === 'aborted') {
				return {
					content: null,
					tool_calls: [],
					finish_reason: result.stopReason,
					error: result.errorMessage || 'Unknown error',
				};
			}

			// Parse response
			const contentArray = Array.isArray(result.content) ? result.content : [];
			const textContent = contentArray
				.filter((c: any) => c.type === 'text')
				.map((c: any) => c.text)
				.join('');

			const toolCalls = contentArray
				.filter((c: any) => c.type === 'toolCall')
				.map((tc: any) => ({
					id: tc.id || '',
					type: 'function' as const,
					function: {
						name: tc.name || '',
						arguments: typeof tc.arguments === 'string'
							? tc.arguments
							: JSON.stringify(tc.arguments || {}),
					},
				}));

			return {
				content: textContent || null,
				tool_calls: toolCalls,
				finish_reason: result.stopReason || 'stop',
				usage: result.usage ? {
					prompt_tokens: result.usage.input || 0,
					completion_tokens: result.usage.output || 0,
					total_tokens: result.usage.totalTokens || 0,
				} : undefined,
			};
		} catch (error) {
			return {
				content: null,
				tool_calls: [],
				finish_reason: 'error',
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	private buildContext(messages: any[], tools?: any[]) {
		return {
			messages: messages.map((m: any) => this.normalizeMessage(m)),
			tools: tools?.map((t: any) => this.normalizeTool(t)),
		};
	}

	private normalizeMessage(m: any) {
		// Handle toolResult messages
		if (m.role === 'toolResult') {
			return {
				role: 'toolResult',
				toolCallId: m.tool_call_id || m.toolCallId || m.tool_call_id$,
				toolName: m.toolName || m.tool_call_id,
				content: m.content
					? (typeof m.content === 'string'
						? [{ type: 'text', text: m.content }]
						: m.content)
					: [{ type: 'text', text: String(m.content) }],
				isError: m.isError || false,
				timestamp: m.timestamp || Date.now(),
			};
		}

		// Handle regular messages
		let content: any[] = [];

		if (typeof m.content === 'string') {
			content = [{ type: 'text', text: m.content }];
		} else if (Array.isArray(m.content)) {
			content = m.content.map((c: any) => {
				if (c.type === 'text') {
					return { type: 'text', text: c.text };
				} else if (c.type === 'image_url' || c.image_url) {
					const imageData = c.image_url?.data || c.data;
					const mimeType = c.image_url?.mime_type || c.mime_type || 'image/png';
					return { type: 'image', data: imageData, mimeType };
				}
				return { type: 'text', text: JSON.stringify(c) };
			});
		} else {
			content = [{ type: 'text', text: String(m.content) }];
		}

		return {
			role: m.role,
			content,
			timestamp: m.timestamp || Date.now(),
		};
	}

	private normalizeTool(t: any) {
		return {
			name: t.name,
			description: t.description,
			parameters: t.parameters,
		};
	}

	getDefaultModel(): string {
		return this.modelId;
	}

	getModelInfo(): { id: string; provider: string; contextWindow: number; maxTokens: number } {
		return {
			id: this.model.id,
			provider: this.model.provider,
			contextWindow: this.model.contextWindow,
			maxTokens: this.model.maxTokens,
		};
	}

	calculateCost(usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number }): number {
		const cost = PiAI.calculateCost(this.model, {
			input: usage.input,
			output: usage.output,
			cacheRead: usage.cacheRead || 0,
			cacheWrite: usage.cacheWrite || 0,
			totalTokens: usage.input + usage.output,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		});
		return cost.total;
	}
}

// ============================================
// Factory Functions
// ============================================

/**
 * Create a provider instance
 */
export function createProvider(config: Config, modelId: string): LLMProviderImpl {
	return new LLMProviderImpl(config, modelId);
}

/**
 * Get list of available models
 */
export function getAvailableModels(config: Config) {
	const registry = new ModelRegistry(config);
	const models = registry.getAll();

	// Filter to only models with configured auth
	const available = models.filter((m) => {
		const apiKey = getApiKey(config, m.provider);
		return !!apiKey || m.provider === 'ollama';
	});

	return available.map((m) => ({
		id: `${m.provider}/${m.id}`,
		name: m.name,
		provider: m.provider,
		contextWindow: m.contextWindow,
		maxTokens: m.maxTokens,
		reasoning: m.reasoning,
		input: m.input,
	}));
}

/**
 * List all models (including unavailable ones)
 */
export function listAllModels(config: Config) {
	const registry = new ModelRegistry(config);
	const models = registry.getAll();

	// Group by provider
	const byProvider = new Map<string, typeof models>();
	for (const model of models) {
		const list = byProvider.get(model.provider) ?? [];
		list.push(model);
		byProvider.set(model.provider, list);
	}

	return byProvider;
}
