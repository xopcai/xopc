import { getSupportedThinkingLevels, type Api, type Model } from '@earendil-works/pi-ai';
import type { ModelThinkingCapabilities } from '@xopcai/gateway-contract';

const TOGGLE_THINKING_FORMATS = new Set([
  'zai',
  'qwen',
  'qwen-chat-template',
  'chat-template',
  'deepseek',
  'together',
  'baseten',
  'string-thinking',
]);

function preferredEnabledLevel(options: ModelThinkingCapabilities['options']) {
  return options.includes('high')
    ? 'high' as const
    : options.find((option) => option !== 'off');
}

/** Use the same capability metadata as the provider runtime. */
export function getModelThinking(model: Model<Api>): ModelThinkingCapabilities {
  const base = { supportsAdaptive: false as const };
  if (!model.reasoning) return { ...base, mode: 'none', options: ['off'], initialValue: 'off' };
  const compat = model.compat as { thinkingFormat?: string; supportsReasoningEffort?: boolean } | undefined;
  const options = getSupportedThinkingLevels(model);
  const enabledLevel = preferredEnabledLevel(options);
  const hasToggleControl = TOGGLE_THINKING_FORMATS.has(compat?.thinkingFormat ?? '')
    || model.provider === 'zai'
    || model.provider === 'z.ai';

  // These adapters consume only an enabled/disabled value when effort levels
  // are unavailable. Do not expose several labels that all send the same request.
  if (hasToggleControl && compat?.supportsReasoningEffort !== true && enabledLevel) {
    if (options.includes('off')) {
      return { ...base, mode: 'toggle', options: ['off', enabledLevel], initialValue: enabledLevel };
    }
    return { ...base, mode: 'fixed', options: [enabledLevel], initialValue: enabledLevel };
  }

  // A reasoning model without an effort or toggle control is always-on from
  // the user's perspective. Treating it as `off` would make both the UI and
  // persisted session configuration claim a capability the adapter cannot send.
  if (compat?.supportsReasoningEffort === false) {
    if (enabledLevel) {
      return { ...base, mode: 'fixed', options: [enabledLevel], initialValue: enabledLevel };
    }
    return { ...base, mode: 'none', options: ['off'], initialValue: 'off' };
  }

  if (options.length === 1) {
    const only = options[0] ?? 'off';
    return only === 'off'
      ? { ...base, mode: 'none', options: ['off'], initialValue: 'off' }
      : { ...base, mode: 'fixed', options: [only], initialValue: only };
  }

  return {
    ...base,
    mode: 'levels',
    options,
    initialValue: options.includes('medium') ? 'medium' : options[0] ?? 'off',
  };
}
