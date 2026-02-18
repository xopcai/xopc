/**
 * API Strategy Patterns
 * 
 * Encapsulates provider-specific API options building
 * to eliminate scattered if-else chains in pi-ai.ts
 */

import type { ApiType, ApiStrategy, ApiStrategyOptions } from './types.js';

/**
 * Anthropic Messages API Strategy
 * Supports thinking/reasoning mode
 */
const anthropicStrategy: ApiStrategy = {
  buildOptions(opts: ApiStrategyOptions) {
    const options: Record<string, unknown> = {};
    
    if (opts.reasoning) {
      options.thinkingEnabled = true;
      options.thinkingBudgetTokens = opts.maxTokens 
        ? Math.min(opts.maxTokens, opts.modelMaxTokens) 
        : opts.modelMaxTokens;
    }
    
    return options;
  },
};

/**
 * Google Generative AI Strategy
 */
const googleStrategy: ApiStrategy = {
  buildOptions(opts: ApiStrategyOptions) {
    const options: Record<string, unknown> = {};
    
    if (opts.reasoning) {
      options.thinking = {
        enabled: true,
        budgetTokens: opts.maxTokens 
          ? Math.min(opts.maxTokens, opts.modelMaxTokens) 
          : opts.modelMaxTokens,
      };
    }
    
    return options;
  },
};

/**
 * OpenAI Completions API Strategy
 * Handles different thinking formats (qwen, openai)
 */
const openaiStrategy: ApiStrategy = {
  buildOptions(opts: ApiStrategyOptions) {
    const options: Record<string, unknown> = {};
    
    if (opts.reasoning) {
      // Qwen uses enableThinking flag
      if (opts.thinkingFormat === 'qwen') {
        options.enableThinking = true;
      } else {
        // Standard OpenAI reasoning
        options.reasoningEffort = 'medium';
      }
    }
    
    return options;
  },
};

/**
 * GitHub Copilot Strategy
 */
const githubCopilotStrategy: ApiStrategy = {
  buildOptions(_opts: ApiStrategyOptions) {
    // GitHub Copilot doesn't expose thinking controls
    return {};
  },
};

// ============================================
// Strategy Registry
// ============================================

const STRATEGIES: Record<ApiType, ApiStrategy> = {
  'anthropic-messages': anthropicStrategy,
  'google-generative-ai': googleStrategy,
  'openai-completions': openaiStrategy,
  'github-copilot': githubCopilotStrategy,
};

/**
 * Get API strategy for the given API type
 */
export function getApiStrategy(apiType: string): ApiStrategy {
  const strategy = STRATEGIES[apiType as ApiType];
  if (!strategy) {
    // Return noop strategy for unknown API types
    return { buildOptions: () => ({}) };
  }
  return strategy;
}

/**
 * Build provider-specific options
 */
export function buildProviderOptions(
  apiType: string,
  opts: ApiStrategyOptions
): Record<string, unknown> {
  const strategy = getApiStrategy(apiType);
  return strategy.buildOptions(opts);
}
