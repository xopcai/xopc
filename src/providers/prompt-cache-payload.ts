import type { Api, Model, SimpleStreamOptions } from '@earendil-works/pi-ai';

import { splitPromptCacheBoundary, stripPromptCacheBoundary } from '../agent/prompt/cache-boundary.js';
import { canonicalizeCacheValue, digestCacheText } from './prompt-cache-fingerprint.js';
import {
  resolvePromptCachePolicy,
  resolvePromptCacheProviderMode,
  isOfficialOpenAIModel,
  supportsExplicitOpenAICache,
  type PromptCachePlan,
  type PromptCachePolicy,
} from './prompt-cache-plan.js';
import { applyGoogleManagedPromptCache } from './google-managed-prompt-cache.js';

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

export function buildPromptCacheKey(
  model: Model<Api>,
  context: { systemPrompt?: string; tools?: unknown[] },
  reasoning?: string,
): string {
  const stablePrompt = context.systemPrompt
    ? splitPromptCacheBoundary(context.systemPrompt)?.stablePrefix
      ?? stripPromptCacheBoundary(context.systemPrompt)
    : '';
  const digest = digestCacheText(
    `v2\0${model.provider}\0${model.id}\0${reasoning ?? ''}\0${stablePrompt}\0${canonicalizeCacheValue(context.tools ?? [])}`,
  );
  return `xopc-v2-${digest}`;
}

export function buildPromptCachePlan(
  model: Model<Api>,
  context: { systemPrompt?: string; tools?: unknown[] },
  policyInput?: PromptCachePolicy,
  reasoning?: string,
): PromptCachePlan {
  const policy = resolvePromptCachePolicy(policyInput);
  const providerMode = resolvePromptCacheProviderMode(model, policy);
  return {
    policy,
    providerMode,
    ...(providerMode === 'implicit' || providerMode === 'explicit'
      ? { cacheKey: buildPromptCacheKey(model, context, reasoning) }
      : {}),
  };
}

function splitAnthropicSystem(payload: unknown, lifetime: 'short' | 'long'): unknown {
  const record = asRecord(payload);
  if (!record || !Array.isArray(record.system)) return payload;

  let changed = false;
  const system = record.system.flatMap((value) => {
    const block = asRecord(value);
    if (!block || typeof block.text !== 'string') return [value];
    const split = splitPromptCacheBoundary(block.text);
    if (!split) return [value];

    changed = true;
    const { text: _text, ...rest } = block;
    return [
      {
        ...rest,
        type: block.type ?? 'text',
        text: split.stablePrefix,
        cache_control: lifetime === 'long'
          ? { type: 'ephemeral', ttl: '1h' }
          : { type: 'ephemeral' },
      },
      ...(split.dynamicSuffix ? [{ type: block.type ?? 'text', text: split.dynamicSuffix }] : []),
    ];
  });
  return changed ? { ...record, system } : payload;
}

function addAnthropicHistoryBreakpoint(payload: unknown, lifetime: 'short' | 'long'): unknown {
  const record = asRecord(payload);
  if (!record || !Array.isArray(record.messages)) return payload;
  const messages = [...record.messages];
  const cacheControl = lifetime === 'long'
    ? { type: 'ephemeral', ttl: '1h' }
    : { type: 'ephemeral' };

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = asRecord(messages[index]);
    if (!message || message.role !== 'user') continue;
    const blocks = Array.isArray(message.content) ? [...message.content] : undefined;
    const containsToolResult = blocks?.some((block) => asRecord(block)?.type === 'tool_result') ?? false;
    if (index === messages.length - 1 && !containsToolResult) continue;

    if (!blocks) {
      if (typeof message.content !== 'string') continue;
      messages[index] = {
        ...message,
        content: [{ type: 'text', text: message.content, cache_control: cacheControl }],
      };
      return { ...record, messages };
    }
    for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = asRecord(blocks[blockIndex]);
      if (!block) continue;
      blocks[blockIndex] = { ...block, cache_control: cacheControl };
      messages[index] = { ...message, content: blocks };
      return { ...record, messages };
    }
  }
  return payload;
}

function splitBedrockSystem(payload: unknown): unknown {
  const record = asRecord(payload);
  if (!record || !Array.isArray(record.system)) return payload;

  let changed = false;
  const system: unknown[] = [];
  for (let index = 0; index < record.system.length; index += 1) {
    const value = record.system[index];
    const block = asRecord(value);
    if (typeof block?.text !== 'string') {
      system.push(value);
      continue;
    }
    const split = splitPromptCacheBoundary(block.text);
    if (!split) {
      system.push(value);
      continue;
    }
    changed = true;
    const next = asRecord(record.system[index + 1]);
    if (!next?.cachePoint) {
      system.push({ ...block, text: stripPromptCacheBoundary(block.text) });
      continue;
    }
    system.push({ ...block, text: split.stablePrefix }, next);
    index += 1;
    if (split.dynamicSuffix) system.push({ text: split.dynamicSuffix });
  }
  return changed ? { ...record, system } : payload;
}

function addBedrockHistoryBreakpoint(payload: unknown): unknown {
  const record = asRecord(payload);
  if (!record || !Array.isArray(record.messages)) return payload;
  const checkpoint = Array.isArray(record.system)
    ? record.system.map(asRecord).find(block => block?.cachePoint) : undefined;
  if (!checkpoint) return payload;
  const messages = [...record.messages];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = asRecord(messages[index]);
    if (!message || message.role !== 'user' || !Array.isArray(message.content)) continue;
    const content = [...message.content];
    const containsToolResult = content.some((block) => 'toolResult' in (asRecord(block) ?? {}));
    if (index === messages.length - 1 && !containsToolResult) continue;
    if (content.some(block => asRecord(block)?.cachePoint)) return payload;
    content.push(checkpoint);
    messages[index] = { ...message, content };
    return { ...record, messages };
  }
  return payload;
}

function applyOpenAIExplicitCache(
  model: Model<Api>,
  payload: unknown,
  context: { systemPrompt?: string },
  plan: PromptCachePlan,
): unknown {
  const record = asRecord(payload);
  if (!record) return payload;
  // Implicit lookup also checks recent user and tool boundaries from previous requests.
  const result: JsonRecord = {
    ...record,
    prompt_cache_key: plan.cacheKey,
    prompt_cache_options: { ...asRecord(record.prompt_cache_options), mode: 'implicit', ttl: '30m' },
  };
  const split = splitPromptCacheBoundary(context.systemPrompt ?? '');
  const stablePrompt = split?.stablePrefix ?? stripPromptCacheBoundary(context.systemPrompt ?? '');
  const dynamicPrompt = split?.dynamicSuffix ?? '';
  if (Array.isArray(record.input)) {
    const input = [...record.input];
    const initialMessage = asRecord(input[0]);
    const content = initialMessage?.content;
    const initialText = typeof content === 'string'
      ? content
      : Array.isArray(content) && content.length === 1 && asRecord(content[0])?.type === 'input_text'
        ? asRecord(content[0])?.text
        : undefined;
    if ((initialMessage?.role === 'system' || initialMessage?.role === 'developer')
      && initialText === stripPromptCacheBoundary(context.systemPrompt ?? '')
      && stablePrompt) {
      const lateInstructions = dynamicPrompt && /^gpt-6\.2(?:-|$)/.test(model.id)
        && record.instructions === undefined;
      const longPrefix = plan.policy.lifetime === 'long' && model.compat !== undefined
        && 'supportsLongCacheRetention' in model.compat && model.compat.supportsLongCacheRetention;
      input[0] = {
        ...initialMessage,
        ...(lateInstructions ? { role: 'developer' } : {}),
        content: [
          { type: 'input_text', text: stablePrompt,
            prompt_cache_breakpoint: { mode: 'explicit', ...(longPrefix ? { ttl: '12h' } : {}) } },
          ...(dynamicPrompt && !lateInstructions ? [{ type: 'input_text', text: dynamicPrompt }] : []),
        ],
      };
      if (lateInstructions) result.instructions = dynamicPrompt;
    }
    result.input = input;
  }
  return result;
}

export function transformPromptCachePayload(
  model: Model<Api>,
  payload: unknown,
  plan: PromptCachePlan = buildPromptCachePlan(model, {}),
  context: { systemPrompt?: string } = {},
): unknown {
  if (model.api === 'openai-completions' && model.provider === 'deepseek' && model.id === 'deepseek-flash'
    && URL.parse(model.baseUrl)?.origin === 'https://api.deepseek.com' && plan.policy.mode !== 'off') {
    const record = asRecord(payload);
    const systemPrompt = context.systemPrompt ?? '';
    const split = splitPromptCacheBoundary(systemPrompt);
    if (Array.isArray(record?.messages) && record.messages.length > 1 && split?.stablePrefix && split.dynamicSuffix) {
      const [first, ...history] = record.messages;
      const initial = asRecord(first);
      if (initial?.role === 'system' && initial.content === stripPromptCacheBoundary(systemPrompt)) {
        return { ...record, messages: [{ ...initial, content: split.stablePrefix }, ...history,
          { role: 'system', content: split.dynamicSuffix }] };
      }
    }
  }
  if (model.api === 'openai-codex-responses' && plan.policy.mode !== 'off'
    && model.compat && 'supportsMidConvoSystemMessages' in model.compat && model.compat.supportsMidConvoSystemMessages) {
    const record = asRecord(payload);
    const systemPrompt = context.systemPrompt ?? '';
    const split = splitPromptCacheBoundary(systemPrompt);
    if (record?.instructions === stripPromptCacheBoundary(systemPrompt) && Array.isArray(record.input)
      && split?.stablePrefix && split.dynamicSuffix) {
      return { ...record, instructions: split.stablePrefix,
        input: [...record.input, { role: 'developer', content: split.dynamicSuffix }] };
    }
  }
  if (plan.providerMode === 'none' || plan.providerMode === 'managed') return payload;
  if (model.api === 'anthropic-messages') {
    const lifetime = plan.policy.lifetime === 'long' && model.compat && 'supportsLongCacheRetention' in model.compat
      && model.compat.supportsLongCacheRetention === false ? 'short' : plan.policy.lifetime;
    return addAnthropicHistoryBreakpoint(
      splitAnthropicSystem(payload, lifetime),
      lifetime,
    );
  }
  if (model.api === 'bedrock-converse-stream') {
    return addBedrockHistoryBreakpoint(splitBedrockSystem(payload));
  }
  if (plan.providerMode === 'explicit' && plan.cacheKey
    && supportsExplicitOpenAICache(model)
    && asRecord(payload)?.prompt_cache_options != null) {
    // pi resolves authentication after xopc's stream wrapper. Respect the cache
    // field it omits for subscription credentials and unsupported models.
    return applyOpenAIExplicitCache(model, payload, context, plan);
  }
  const record = asRecord(payload);
  return record && plan.cacheKey ? { ...record, prompt_cache_key: plan.cacheKey } : payload;
}

export function preparePromptCacheContext<T extends { systemPrompt?: string }>(
  model: Model<Api>,
  context: T,
  policy = resolvePromptCachePolicy(),
): T {
  if (policy.mode !== 'off' && (model.api === 'anthropic-messages' || model.api === 'bedrock-converse-stream')) return context;
  if (!context.systemPrompt) return context;
  return { ...context, systemPrompt: stripPromptCacheBoundary(context.systemPrompt) };
}

export function withPromptCachePayloadTransform(
  model: Model<Api>,
  context: { systemPrompt?: string; tools?: unknown[] },
  options: SimpleStreamOptions | undefined,
  policyInput?: PromptCachePolicy,
): SimpleStreamOptions {
  const plan = buildPromptCachePlan(model, context, policyInput, options?.reasoning);
  const upstream = options?.onPayload;
  const usesSdkRetention = model.api === 'anthropic-messages' || model.api === 'bedrock-converse-stream';
  const usesOpenAILongRetention = plan.providerMode === 'implicit' && isOfficialOpenAIModel(model)
    && plan.policy.lifetime === 'long' && model.compat !== undefined
    && 'supportsLongCacheRetention' in model.compat && model.compat.supportsLongCacheRetention;
  const cacheRetention = plan.policy.mode === 'off' ? 'none'
    : usesSdkRetention || usesOpenAILongRetention ? plan.policy.lifetime
      : model.api === 'openai-codex-responses' ? 'short' : 'none';

  return {
    ...options,
    cacheRetention,
    onPayload: async (payload, payloadModel) => {
      const upstreamPayload = await upstream?.(payload, payloadModel);
      const transformed = transformPromptCachePayload(
        model,
        upstreamPayload === undefined ? payload : upstreamPayload,
        plan,
        context,
      );
      if (plan.providerMode !== 'managed') return transformed;
      return applyGoogleManagedPromptCache({
        model,
        context,
        payload: transformed,
        policy: plan.policy,
        apiKey: options?.apiKey,
        fetchImpl: options?.fetch,
      });
    },
  };
}
