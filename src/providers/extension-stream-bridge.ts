import {
	streamSimple,
	createAssistantMessageEventStream,
	type AssistantMessage,
	type Model,
	type Api,
	type Context,
	type SimpleStreamOptions,
} from '@earendil-works/pi-ai/compat';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { ProviderStreamParams } from '../extensions/types/providers.js';
import { getProviderRegistry } from './plugin-registry.js';
import { EXTENSION_PROVIDER_BASE_URL } from './index.js';
import { stripPromptCacheBoundary } from '../agent/prompt/cache-boundary.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ExtensionStreamBridge');

function createPartialMessage(model: Model<Api>): AssistantMessage {
	return {
		role: 'assistant',
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: 'stop',
		timestamp: Date.now(),
	};
}

function parseToolArguments(raw: string | undefined): Record<string, unknown> {
	if (!raw?.trim()) return {};
	try {
		return JSON.parse(raw) as Record<string, unknown>;
	} catch {
		return {};
	}
}

function collectExtraStreamOptions(options?: SimpleStreamOptions): Record<string, unknown> | undefined {
	if (!options) return undefined;
	const knownOptionKeys = new Set([
		'temperature',
		'maxTokens',
		'signal',
		'apiKey',
		'transport',
		'sessionId',
		'onPayload',
		'onResponse',
		'headers',
		'timeoutMs',
		'maxRetries',
		'maxRetryDelayMs',
		'metadata',
		'reasoning',
		'thinkingBudgets',
	]);
	const entries = Object.entries(options as Record<string, unknown>).filter(([key, value]) => {
		return !knownOptionKeys.has(key) && value !== undefined;
	});
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** Wraps {@link streamSimple} so extension-registered models use the plugin `createStream()` path. */
export function createExtensionAwareStreamFn(): StreamFn {
	return ((model: Model<Api>, context: Context, options?: SimpleStreamOptions) => {
		if (model.baseUrl !== EXTENSION_PROVIDER_BASE_URL) {
			return streamSimple(model, context, options);
		}

		const plugin = getProviderRegistry().get(model.provider);
		if (!plugin) {
			return streamSimple(model, context, options);
		}

		log.info({ provider: model.provider, modelId: model.id }, 'Streaming via extension provider');

		const stream = createAssistantMessageEventStream();

		const params: ProviderStreamParams = {
			model: model.id,
			systemPrompt: context.systemPrompt
				? stripPromptCacheBoundary(context.systemPrompt)
				: undefined,
			messages: context.messages as unknown as ProviderStreamParams['messages'],
			tools: context.tools as unknown as ProviderStreamParams['tools'],
			temperature: options?.temperature,
			maxTokens: options?.maxTokens,
			apiKey: options?.apiKey,
			sessionId: options?.sessionId,
			reasoning: options?.reasoning,
			headers: options?.headers,
			timeoutMs: options?.timeoutMs,
			maxRetries: options?.maxRetries,
			metadata: options?.metadata,
			transport: options?.transport,
			thinkingBudgets: options?.thinkingBudgets,
			extra: collectExtraStreamOptions(options),
			signal: options?.signal,
		};

		void (async () => {
			const partial = createPartialMessage(model);
			let textContentIndex = -1;
			let hasStarted = false;

			try {
				for await (const chunk of plugin.createStream(params)) {
					if (options?.signal?.aborted) {
						partial.stopReason = 'aborted';
						partial.errorMessage = 'Request aborted';
						stream.push({ type: 'error', reason: 'aborted', error: partial });
						return;
					}

					switch (chunk.type) {
						case 'text': {
							if (!hasStarted) {
								hasStarted = true;
								stream.push({ type: 'start', partial });
							}
							if (textContentIndex === -1) {
								textContentIndex = partial.content.length;
								partial.content.push({ type: 'text', text: '' });
								stream.push({ type: 'text_start', contentIndex: textContentIndex, partial });
							}
							const textContent = partial.content[textContentIndex];
							if (textContent?.type === 'text' && chunk.text) {
								textContent.text += chunk.text;
								stream.push({
									type: 'text_delta',
									contentIndex: textContentIndex,
									delta: chunk.text,
									partial,
								});
							}
							break;
						}
						case 'tool_call': {
							if (!hasStarted) {
								hasStarted = true;
								stream.push({ type: 'start', partial });
							}
							if (textContentIndex !== -1) {
								const tc = partial.content[textContentIndex];
								if (tc?.type === 'text') {
									stream.push({
										type: 'text_end',
										contentIndex: textContentIndex,
										content: tc.text,
										partial,
									});
								}
								textContentIndex = -1;
							}
							if (chunk.toolCall) {
								const idx = partial.content.length;
								const toolCall = {
									type: 'toolCall' as const,
									id: chunk.toolCall.id,
									name: chunk.toolCall.name,
									arguments: parseToolArguments(chunk.toolCall.arguments),
								};
								partial.content.push(toolCall);
								stream.push({ type: 'toolcall_start', contentIndex: idx, partial });
								stream.push({
									type: 'toolcall_delta',
									contentIndex: idx,
									delta: chunk.toolCall.arguments || '{}',
									partial,
								});
								stream.push({ type: 'toolcall_end', contentIndex: idx, toolCall, partial });
							}
							break;
						}
						case 'usage': {
							if (chunk.usage) {
								const inputCost = (chunk.usage.input / 1_000_000) * (model.cost?.input ?? 0);
								const outputCost = (chunk.usage.output / 1_000_000) * (model.cost?.output ?? 0);
								partial.usage = {
									input: chunk.usage.input,
									output: chunk.usage.output,
									cacheRead: chunk.usage.cacheRead ?? 0,
									cacheWrite: chunk.usage.cacheWrite ?? 0,
									totalTokens: chunk.usage.total
										?? chunk.usage.input + chunk.usage.output
										+ (chunk.usage.cacheRead ?? 0) + (chunk.usage.cacheWrite ?? 0),
									cost: {
										input: inputCost,
										output: outputCost,
										cacheRead: ((chunk.usage.cacheRead ?? 0) / 1_000_000) * (model.cost?.cacheRead ?? 0),
										cacheWrite: ((chunk.usage.cacheWrite ?? 0) / 1_000_000) * (model.cost?.cacheWrite ?? 0),
										total: inputCost + outputCost
											+ ((chunk.usage.cacheRead ?? 0) / 1_000_000) * (model.cost?.cacheRead ?? 0)
											+ ((chunk.usage.cacheWrite ?? 0) / 1_000_000) * (model.cost?.cacheWrite ?? 0),
									},
								};
							}
							break;
						}
						case 'error': {
							if (!hasStarted) {
								hasStarted = true;
								stream.push({ type: 'start', partial });
							}
							partial.stopReason = 'error';
							partial.errorMessage = chunk.error ?? 'Unknown extension provider error';
							stream.push({ type: 'error', reason: 'error', error: partial });
							return;
						}
						case 'done':
							break;
					}
				}

				if (textContentIndex !== -1) {
					const tc = partial.content[textContentIndex];
					if (tc?.type === 'text') {
						stream.push({
							type: 'text_end',
							contentIndex: textContentIndex,
							content: tc.text,
							partial,
						});
					}
				}
				if (!hasStarted) {
					hasStarted = true;
					stream.push({ type: 'start', partial });
				}

				const hasToolCalls = partial.content.some(c => c.type === 'toolCall');
				const stopReason = hasToolCalls ? 'toolUse' : 'stop';
				partial.stopReason = stopReason;
				stream.push({ type: 'done', reason: stopReason, message: partial });
			} catch (err) {
				if (!hasStarted) stream.push({ type: 'start', partial });
				partial.stopReason = 'error';
				partial.errorMessage = err instanceof Error ? err.message : String(err);
				stream.push({ type: 'error', reason: 'error', error: partial });
			}
		})();

		return stream;
	}) as StreamFn;
}
