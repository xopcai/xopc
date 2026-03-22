import type { Config } from '../config/schema.js';
import { DEFAULT_TTS_CONFIG, type TTSConfig } from './types.js';
import { isTTSAvailable } from './factory.js';

/**
 * Merge persisted app config `tts` with defaults to a full {@link TTSConfig}
 * for validation (provider chain, env-based keys, etc.).
 */
export function mergeTtsConfigFromAppConfig(tts: Config['tts'] | undefined): TTSConfig {
  const p = (tts ?? {}) as Partial<TTSConfig>;
  return {
    ...DEFAULT_TTS_CONFIG,
    ...p,
    enabled: p.enabled ?? DEFAULT_TTS_CONFIG.enabled,
    provider: p.provider ?? DEFAULT_TTS_CONFIG.provider,
    trigger: p.trigger ?? DEFAULT_TTS_CONFIG.trigger,
    fallback: {
      ...DEFAULT_TTS_CONFIG.fallback!,
      ...p.fallback,
    },
    modelOverrides: {
      ...DEFAULT_TTS_CONFIG.modelOverrides!,
      ...p.modelOverrides,
    },
    alibaba: { ...DEFAULT_TTS_CONFIG.alibaba, ...p.alibaba },
    openai: { ...DEFAULT_TTS_CONFIG.openai, ...p.openai },
    edge: { ...DEFAULT_TTS_CONFIG.edge, ...p.edge },
  };
}

/**
 * User-facing hint when TTS is enabled in settings but no provider can run.
 */
export function formatTtsSetupHint(): string {
  return (
    `⚠️ *TTS is on, but no provider can run yet.*\n\n` +
    `Configure one of the following in \`~/.xopcbot/config.json\` (or env):\n` +
    `• *OpenAI*: \`OPENAI_API_KEY\` or \`tts.openai.apiKey\` (and optional \`tts.openai.model\` / \`tts.openai.voice\`)\n` +
    `• *Alibaba*: \`DASHSCOPE_API_KEY\` or \`tts.alibaba.apiKey\`\n` +
    `• *Edge* (no key): \`/tts provider edge\` — ensure \`tts.edge.enabled\` is not \`false\`\n\n` +
    `You can also use the gateway Web UI → Settings → Voice.`
  );
}

/**
 * Append readiness / setup guidance when TTS is enabled but unavailable.
 */
export function appendTtsReadinessNote(content: string, appConfig: Config | undefined): string {
  const effective = mergeTtsConfigFromAppConfig(appConfig?.tts);
  if (!effective.enabled) {
    return content;
  }
  if (isTTSAvailable(effective)) {
    return content;
  }
  return `${content}\n\n${formatTtsSetupHint()}`;
}
