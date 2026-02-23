/**
 * Model Compatibility
 * 
 * Handles model-specific compatibility checks and configurations.
 * Based on OpenClaw's model-compat.ts approach.
 */

import type { ModelCompatConfig, ModelDefinitionConfig } from '../config/types.models.js';

// ============================================
// Compatibility Flags
// ============================================

export interface CompatFlags {
  supportsStore: boolean;
  supportsDeveloperRole: boolean;
  supportsReasoningEffort: boolean;
  supportsUsageInStreaming: boolean;
  supportsStrictMode: boolean;
  maxTokensField: 'max_completion_tokens' | 'max_tokens';
  thinkingFormat: 'openai' | 'zai' | 'qwen' | undefined;
  requiresToolResultName: boolean;
  requiresAssistantAfterToolResult: boolean;
  requiresThinkingAsText: boolean;
  requiresMistralToolIds: boolean;
}

// ============================================
// Default Compatibility by API Type
// ============================================

const DEFAULT_COMPAT_BY_API: Record<string, Partial<ModelCompatConfig>> = {
  'anthropic-messages': {
    supportsStore: true,
    supportsDeveloperRole: true,
    requiresThinkingAsText: true,
  },
  'openai-responses': {
    supportsStore: true,
    supportsDeveloperRole: true,
    supportsReasoningEffort: true,
    thinkingFormat: 'openai',
  },
  'openai-completions': {
    maxTokensField: 'max_tokens',
  },
  'google-generative-ai': {
    thinkingFormat: 'openai',
  },
  'github-copilot': {
    maxTokensField: 'max_tokens',
  },
  'ollama': {
    maxTokensField: 'max_tokens',
  },
};

// ============================================
// Model Pattern Matching
// ============================================

const MODEL_PATTERNS: Array<{ pattern: RegExp; compat: Partial<ModelCompatConfig> }> = [
  // Anthropic models
  { pattern: /^claude-opus/i, compat: { supportsStore: true, supportsDeveloperRole: true, requiresThinkingAsText: true } },
  { pattern: /^claude-sonnet/i, compat: { supportsStore: true, supportsDeveloperRole: true, requiresThinkingAsText: true } },
  { pattern: /^claude-haiku/i, compat: { supportsStore: true, supportsDeveloperRole: true, requiresThinkingAsText: true } },
  
  // OpenAI reasoning models
  { pattern: /^o1-/i, compat: { supportsReasoningEffort: false, supportsDeveloperRole: false } },
  { pattern: /^o3/i, compat: { supportsReasoningEffort: false, supportsDeveloperRole: false } },
  { pattern: /^o4/i, compat: { supportsReasoningEffort: false, supportsDeveloperRole: false } },
  
  // Qwen models
  { pattern: /^qwen/i, compat: { thinkingFormat: 'qwen' } },
  
  // Z.AI models
  { pattern: /^zai-/i, compat: { thinkingFormat: 'zai' } },
  
  // Mistral models
  { pattern: /^mistral/i, compat: { requiresMistralToolIds: true } },
];

// ============================================
// Functions
// ============================================

/**
 * Get compatibility flags for a model
 */
export function getCompatFlags(model: ModelDefinitionConfig): CompatFlags {
  // Start with API defaults
  const apiCompat = model.api ? DEFAULT_COMPAT_BY_API[model.api] ?? {} : {};
  
  // Apply model-specific patterns
  let patternCompat: Partial<ModelCompatConfig> = {};
  for (const { pattern, compat } of MODEL_PATTERNS) {
    if (pattern.test(model.id)) {
      patternCompat = { ...patternCompat, ...compat };
    }
  }
  
  // Override with explicit model config
  const explicit = model.compat ?? {};
  
  // Merge all sources (explicit > pattern > api > defaults)
  const merged = { ...apiCompat, ...patternCompat, ...explicit };
  
  return {
    supportsStore: merged.supportsStore ?? false,
    supportsDeveloperRole: merged.supportsDeveloperRole ?? false,
    supportsReasoningEffort: merged.supportsReasoningEffort ?? false,
    supportsUsageInStreaming: merged.supportsUsageInStreaming ?? true,
    supportsStrictMode: merged.supportsStrictMode ?? false,
    maxTokensField: merged.maxTokensField ?? 'max_completion_tokens',
    thinkingFormat: merged.thinkingFormat,
    requiresToolResultName: merged.requiresToolResultName ?? false,
    requiresAssistantAfterToolResult: merged.requiresAssistantAfterToolResult ?? false,
    requiresThinkingAsText: merged.requiresThinkingAsText ?? false,
    requiresMistralToolIds: merged.requiresMistralToolIds ?? false,
  };
}

/**
 * Check if a model supports a specific feature
 */
export function modelSupports(
  model: ModelDefinitionConfig,
  feature: keyof CompatFlags,
): boolean {
  const flags = getCompatFlags(model);
  const value = flags[feature];
  
  if (typeof value === 'boolean') {
    return value;
  }
  
  return false;
}

/**
 * Check if model supports reasoning/thinking
 */
export function modelSupportsReasoning(model: ModelDefinitionConfig): boolean {
  return model.reasoning === true;
}

/**
 * Check if model supports vision (image input)
 */
export function modelSupportsVision(model: ModelDefinitionConfig): boolean {
  return model.input.includes('image');
}
