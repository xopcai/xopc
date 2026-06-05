/**
 * Hoist legacy flat provider keys (e.g. `messages.tts.openai`) into
 * `providers.<id>` before strict schema validation.
 */

const STT_TOP_LEVEL_KEYS = new Set([
  'enabled',
  'provider',
  'fallback',
  'timeoutMs',
  'models',
  'providers',
]);

const TTS_TOP_LEVEL_KEYS = new Set([
  'enabled',
  'provider',
  'trigger',
  'fallback',
  'maxTextLength',
  'timeoutMs',
  'summarization',
  'modelOverrides',
  'providers',
]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function hoistFlatProviderKeys(
  block: Record<string, unknown>,
  reservedKeys: ReadonlySet<string>,
): Record<string, unknown> {
  const next = { ...block };
  const providers = { ...(asRecord(next.providers) ?? {}) };
  let hoisted = false;

  for (const [key, value] of Object.entries(block)) {
    if (reservedKeys.has(key)) continue;
    const slice = asRecord(value);
    if (!slice) continue;
    providers[key] = { ...(asRecord(providers[key]) ?? {}), ...slice };
    delete next[key];
    hoisted = true;
  }

  if (hoisted || Object.keys(providers).length > 0) {
    next.providers = providers;
  }

  return next;
}

/** Normalize one STT block (`tools.media.audio`). */
export function normalizeSttConfigBlock(raw: unknown): unknown {
  const block = asRecord(raw);
  if (!block) return raw;
  return hoistFlatProviderKeys(block, STT_TOP_LEVEL_KEYS);
}

/** Normalize one TTS block (`messages.tts`). */
export function normalizeTtsConfigBlock(raw: unknown): unknown {
  const block = asRecord(raw);
  if (!block) return raw;
  return hoistFlatProviderKeys(block, TTS_TOP_LEVEL_KEYS);
}

/** Normalize voice slices inside a parsed JSON config object before Zod parse. */
export function normalizeVoiceConfigInJson(json: unknown): unknown {
  if (!asRecord(json)) return json;
  const next = { ...(json as Record<string, unknown>) };

  const tools = asRecord(next.tools);
  if (tools) {
    const media = asRecord(tools.media);
    if (media && media.audio !== undefined) {
      next.tools = {
        ...tools,
        media: {
          ...media,
          audio: normalizeSttConfigBlock(media.audio),
        },
      };
    }
  }

  const messages = asRecord(next.messages);
  if (messages && messages.tts !== undefined) {
    next.messages = {
      ...messages,
      tts: normalizeTtsConfigBlock(messages.tts),
    };
  }

  return next;
}
