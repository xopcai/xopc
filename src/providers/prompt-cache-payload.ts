import { createHash } from 'node:crypto';

import type { Api, Model, SimpleStreamOptions } from '@earendil-works/pi-ai';

import {
  splitPromptCacheBoundary,
  stripPromptCacheBoundary,
} from '../agent/prompt/cache-boundary.js';

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function supportsPromptCacheKey(model: Model<Api>): boolean {
  if (model.api === 'openai-codex-responses' || model.api === 'azure-openai-responses') {
    return true;
  }
  if (model.api !== 'openai-completions' && model.api !== 'openai-responses') {
    return false;
  }
  return model.provider === 'openai' || model.baseUrl?.includes('api.openai.com') === true;
}

function splitAnthropicSystem(payload: unknown): unknown {
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
      { ...rest, type: block.type ?? 'text', text: split.stablePrefix },
      ...(split.dynamicSuffix
        ? [{ type: block.type ?? 'text', text: split.dynamicSuffix }]
        : []),
    ];
  });

  return changed ? { ...record, system } : payload;
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
    }
    if (split.dynamicSuffix) {
      system.push({ text: split.dynamicSuffix });
    }
  }

  return changed ? { ...record, system } : payload;
}

export function transformPromptCachePayload(model: Model<Api>, payload: unknown): unknown {
  if (model.api === 'anthropic-messages') return splitAnthropicSystem(payload);
  if (model.api === 'bedrock-converse-stream') return splitBedrockSystem(payload);
  return payload;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = asRecord(value);
  if (record) {
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function buildPromptCacheKey(
  model: Model<Api>,
  context: { systemPrompt?: string; tools?: unknown[] },
): string {
  const stablePrompt = context.systemPrompt
    ? splitPromptCacheBoundary(context.systemPrompt)?.stablePrefix
      ?? stripPromptCacheBoundary(context.systemPrompt)
    : '';
  const digest = createHash('sha256')
    .update(`${model.provider}\0${model.id}\0${stablePrompt}\0${canonicalJson(context.tools ?? [])}`)
    .digest('base64url');
  return `xopc-${digest}`;
}

export function preparePromptCacheContext<T extends { systemPrompt?: string }>(
  model: Model<Api>,
  context: T,
): T {
  if (model.api === 'anthropic-messages' || model.api === 'bedrock-converse-stream') {
    return context;
  }
  if (!context.systemPrompt) return context;
  return { ...context, systemPrompt: stripPromptCacheBoundary(context.systemPrompt) };
}

export function withPromptCachePayloadTransform(
  model: Model<Api>,
  context: { systemPrompt?: string; tools?: unknown[] },
  options: SimpleStreamOptions | undefined,
): SimpleStreamOptions | undefined {
  const explicitBoundary = model.api === 'anthropic-messages' || model.api === 'bedrock-converse-stream';
  const openAiCacheKey = supportsPromptCacheKey(model) && options?.cacheRetention !== 'none';
  if (!explicitBoundary && !openAiCacheKey) {
    return options;
  }

  const upstream = options?.onPayload;
  const promptCacheKey = openAiCacheKey ? buildPromptCacheKey(model, context) : undefined;
  return {
    ...options,
    onPayload: async (payload, payloadModel) => {
      const upstreamPayload = await upstream?.(payload, payloadModel);
      const transformed = transformPromptCachePayload(
        model,
        upstreamPayload === undefined ? payload : upstreamPayload,
      );
      const record = asRecord(transformed);
      return record && promptCacheKey
        ? { ...record, prompt_cache_key: promptCacheKey }
        : transformed;
    },
  };
}
