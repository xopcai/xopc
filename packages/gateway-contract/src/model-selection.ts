export type ModelThinkingValue = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type ModelThinkingCapabilities = {
  mode: 'none' | 'toggle' | 'levels' | 'unknown';
  options: ModelThinkingValue[];
  initialValue: ModelThinkingValue;
  supportsAdaptive: false;
};

export type ModelSelection = {
  model: string;
  thinkingLevel: string;
  configVersion: number;
};

export function chooseModelThinking(
  capabilities: ModelThinkingCapabilities,
  current?: string,
  remembered?: string,
): ModelThinkingValue {
  for (const value of [remembered, current]) {
    if (capabilities.options.includes(value as ModelThinkingValue)) return value as ModelThinkingValue;
  }
  return capabilities.initialValue;
}
