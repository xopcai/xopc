import type { Api, Model, SimpleStreamOptions } from '@earendil-works/pi-ai';

import { splitPromptCacheBoundary, stripPromptCacheBoundary } from '../agent/prompt/cache-boundary.js';
import { canonicalizeCacheValue, digestCacheText } from './prompt-cache-fingerprint.js';
import {
  resolvePromptCachePolicy,
  resolvePromptCacheProviderMode,
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
    const split = block && typeof block.text === 'string'
      ? splitPromptCacheBoundary(block.text)
      : undefined;
    if (!split) {
      system.push(value);
      continue;
    }

    changed = true;
    system.push({ ...block, text: split.stablePrefix });
    const next = asRecord(record.system[index + 1]);
    if (next?.cachePoint) {
      system.push(next);
      index += 1;
    } else {
      system.push({ cachePoint: { type: 'default' } });
    }
    if (split.dynamicSuffix) system.push({ text: split.dynamicSuffix });
  }
  return changed ? { ...record, system } : payload;
}

function addBedrockHistoryBreakpoint(payload: unknown): unknown {
  const record = asRecord(payload);
  if (!record || !Array.isArray(record.messages)) return payload;
  const messages = [...record.messages];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = asRecord(messages[index]);
    if (!message || message.role !== 'user' || !Array.isArray(message.content)) continue;
    const content = [...message.content];
    const containsToolResult = content.some((block) => 'toolResult' in (asRecord(block) ?? {}));
    if (index === messages.length - 1 && !containsToolResult) continue;
    content.push({ cachePoint: { type: 'default' } });
    messages[index] = { ...message, content };
    return { ...record, messages };
  }
  return payload;
}

function addBreakpointToContent(content: unknown): unknown {
  if (typeof content === 'string') {
    return [{ type: 'input_text', text: content, prompt_cache_breakpoint: { mode: 'explicit' } }];
  }
  if (!Array.isArray(content)) return content;
  const blocks = [...content];
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = asRecord(blocks[index]);
    if (!block) continue;
    blocks[index] = { ...block, prompt_cache_breakpoint: { mode: 'explicit' } };
    return blocks;
  }
  return content;
}

function addOpenAIHistoryBreakpoint(items: unknown): unknown {
  if (!Array.isArray(items)) return items;
  const next = [...items];
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const item = asRecord(next[index]);
    if (!item) continue;
    if (item.type === 'function_call_output') {
      next[index] = { ...item, output: addBreakpointToContent(item.output) };
      return next;
    }
    if (!('content' in item)) continue;
    if (index === next.length - 1 && item.role === 'user') continue;
    const content = addBreakpointToContent(item.content);
    if (content === item.content) continue;
    next[index] = { ...item, content };
    return next;
  }
  return items;
}

function applyOpenAIExplicitCache(
  payload: unknown,
  context: { systemPrompt?: string },
  cacheKey: string,
): unknown {
  const record = asRecord(payload);
  if (!record) return payload;
  const split = splitPromptCacheBoundary(context.systemPrompt ?? '');
  const stablePrompt = split?.stablePrefix ?? stripPromptCacheBoundary(context.systemPrompt ?? '');
  const dynamicPrompt = split?.dynamicSuffix ?? '';
  const stableContent = [{
    type: 'input_text',
    text: stablePrompt,
    prompt_cache_breakpoint: { mode: 'explicit' },
  }];
  const dynamicContent = [{ type: 'input_text', text: dynamicPrompt }];

  if (Array.isArray(record.input)) {
    const expectedInstructions = stripPromptCacheBoundary(context.systemPrompt ?? '');
    const canReplaceInstructions = record.instructions === undefined
      || record.instructions === expectedInstructions;
    return {
      ...record,
      ...(canReplaceInstructions
        ? {
            instructions: [
              { type: 'message', role: 'system', content: stableContent },
              ...(dynamicPrompt ? [{ type: 'message', role: 'system', content: dynamicContent }] : []),
            ],
          }
        : {}),
      input: addOpenAIHistoryBreakpoint(record.input),
      prompt_cache_key: cacheKey,
      prompt_cache_options: { mode: 'explicit', ttl: '30m' },
    };
  }

  return {
    ...record,
    prompt_cache_key: cacheKey,
    prompt_cache_options: { mode: 'explicit', ttl: '30m' },
  };
}

export function transformPromptCachePayload(
  model: Model<Api>,
  payload: unknown,
  plan: PromptCachePlan = buildPromptCachePlan(model, {}),
  context: { systemPrompt?: string } = {},
): unknown {
  if (plan.providerMode === 'none' || plan.providerMode === 'managed') return payload;
  if (model.api === 'anthropic-messages') {
    return addAnthropicHistoryBreakpoint(
      splitAnthropicSystem(payload, plan.policy.lifetime),
      plan.policy.lifetime,
    );
  }
  if (model.api === 'bedrock-converse-stream') {
    return addBedrockHistoryBreakpoint(splitBedrockSystem(payload));
  }
  if (plan.providerMode === 'explicit' && plan.cacheKey) {
    return applyOpenAIExplicitCache(payload, context, plan.cacheKey);
  }
  const record = asRecord(payload);
  return record && plan.cacheKey ? { ...record, prompt_cache_key: plan.cacheKey } : payload;
}

export function preparePromptCacheContext<T extends { systemPrompt?: string }>(
  model: Model<Api>,
  context: T,
): T {
  if (model.api === 'anthropic-messages' || model.api === 'bedrock-converse-stream') return context;
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
  const cacheRetention = model.api === 'anthropic-messages' || model.api === 'bedrock-converse-stream'
    ? plan.providerMode === 'none' ? 'none' : plan.policy.lifetime
    : 'none';

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
