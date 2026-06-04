import type { Config } from '../../config/schema.js';
import { DEFAULT_TTS_CONFIG, type TTSConfig } from './types.js';
import { isTTSAvailable } from './factory.js';

/**
 * Merge persisted app config `tts` with defaults to a full {@link TTSConfig}
 * for validation (provider chain, env-based keys, etc.).
 */
function normalizeTtsTrigger(raw: unknown): TTSConfig['trigger'] {
  const t = typeof raw === 'string' ? raw.toLowerCase() : '';
  if (t === 'off' || t === 'always' || t === 'inbound' || t === 'tagged') return t;
  return DEFAULT_TTS_CONFIG.trigger;
}

function normalizeTtsProvider(raw: unknown): string {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : DEFAULT_TTS_CONFIG.provider;
}

function mergeProviderEntries(
  base: Record<string, Record<string, unknown>> | undefined,
  patch: Record<string, Record<string, unknown>> | undefined,
): Record<string, Record<string, unknown>> | undefined {
  if (!base && !patch) {
    return undefined;
  }
  const merged: Record<string, Record<string, unknown>> = { ...(base ?? {}) };
  for (const [providerId, slice] of Object.entries(patch ?? {})) {
    merged[providerId] = { ...(merged[providerId] ?? {}), ...slice };
  }
  return merged;
}

export function mergeTtsConfigFromAppConfig(tts: Partial<TTSConfig> | undefined): TTSConfig {
  const p = (tts ?? {}) as Partial<TTSConfig>;
  return {
    ...DEFAULT_TTS_CONFIG,
    ...p,
    enabled: p.enabled ?? DEFAULT_TTS_CONFIG.enabled,
    provider: normalizeTtsProvider(p.provider),
    trigger: normalizeTtsTrigger(p.trigger ?? DEFAULT_TTS_CONFIG.trigger),
    fallback: {
      ...DEFAULT_TTS_CONFIG.fallback!,
      ...p.fallback,
    },
    modelOverrides: {
      ...DEFAULT_TTS_CONFIG.modelOverrides!,
      ...p.modelOverrides,
    },
    providers: mergeProviderEntries(DEFAULT_TTS_CONFIG.providers, p.providers),
    summarization: {
      ...DEFAULT_TTS_CONFIG.summarization,
      ...p.summarization,
    },
  };
}

/**
 * User-facing hint when TTS is enabled in settings but no provider can run.
 */
export function formatTtsSetupHint(): string {
  return (
    `⚠️ *TTS is on, but no provider can run yet.*\n\n` +
    `Configure one of the following in \`~/.xopc/xopc.json\` (or env):\n` +
    `• *OpenAI*: \`OPENAI_API_KEY\` or \`messages.tts.providers.openai.apiKey\`\n` +
    `• *Alibaba*: \`DASHSCOPE_API_KEY\` or \`messages.tts.providers.alibaba.apiKey\`\n` +
    `• *MiniMax*: \`MINIMAX_API_KEY\` or \`messages.tts.providers.minimax.apiKey\`\n` +
    `• *Edge* (no key): ensure \`messages.tts.providers.edge.enabled\` is not \`false\`\n` +
    `• *Local CLI*: \`messages.tts.providers.tts-local-cli.command\`\n\n` +
    `You can also use the gateway Web UI → Settings → Voice.`
  );
}

/**
 * Append readiness / setup guidance when TTS is enabled but unavailable.
 */
export function appendTtsReadinessNote(content: string, appConfig: Config | undefined): string {
  const effective = mergeTtsConfigFromAppConfig(appConfig?.messages?.tts);
  if (!effective.enabled) {
    return content;
  }
  if (isTTSAvailable(effective)) {
    return content;
  }
  return `${content}\n\n${formatTtsSetupHint()}`;
}
