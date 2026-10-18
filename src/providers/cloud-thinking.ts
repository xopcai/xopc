import type { Api, Model } from '@earendil-works/pi-ai';

/** Explicit wire mapping for the verified Cloud Codex endpoint. */
export function cloudThinkingOverrides(provider: string, id: string): Pick<Model<Api>, 'thinkingLevelMap' | 'compat'> {
  return provider === 'xopc-cloud' && id === 'openai-codex/gpt-5.6-sol'
    ? { compat: { thinkingFormat: 'deepseek', supportsReasoningEffort: true } }
    : {};
}
