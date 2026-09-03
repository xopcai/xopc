import { getSupportedThinkingLevels, type Api, type Model } from '@earendil-works/pi-ai';
import type { ModelThinkingCapabilities } from '@xopcai/gateway-contract';

/** Use the same capability metadata as the provider runtime. */
export function getModelThinking(model: Model<Api>): ModelThinkingCapabilities {
  const base = { supportsAdaptive: false as const };
  if (!model.reasoning) return { ...base, mode: 'none', options: ['off'], initialValue: 'off' };
  const compat = model.compat as { thinkingFormat?: string; supportsReasoningEffort?: boolean } | undefined;
  const binaryFormat = ['zai', 'qwen', 'qwen-chat-template', 'chat-template'].includes(compat?.thinkingFormat ?? '');
  const binaryProvider = model.provider === 'zai' || model.provider === 'z.ai';
  if ((binaryFormat || binaryProvider) && compat?.supportsReasoningEffort !== true) {
    return { ...base, mode: 'toggle', options: ['off', 'high'], initialValue: 'high' };
  }
  if (compat?.supportsReasoningEffort === false) {
    return { ...base, mode: 'unknown', options: ['off'], initialValue: 'off' };
  }
  const options = getSupportedThinkingLevels(model);
  return {
    ...base,
    mode: options.length > 1 ? 'levels' : 'none',
    options,
    initialValue: options.includes('medium') ? 'medium' : options[0] ?? 'off',
  };
}
