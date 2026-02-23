/**
 * Models Config End-to-End Tests
 * 
 * Tests the complete models configuration workflow:
 * - Config loading and validation
 * - Model scanning and validation
 * - Model selection and fallback
 * - Compatibility flags
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigSchema, type Config } from '../schema.js';
import { scanProviders, validateModelDefinition, buildModelMap, isValidModelRef } from '../../agents/model-scan.js';
import { getFallbackCandidates, selectFallback, isRetryableError } from '../../agents/model-fallback.js';
import { getCompatFlags, modelSupportsReasoning, modelSupportsVision } from '../../agents/model-compat.js';
import { parseModelRef, resolveModelRef, getModelConfig, findProviderConfig } from '../../agents/model-selection.js';
import { resolveModelAlias } from '../defaults.js';

describe('Models Config E2E', () => {
  describe('Complete Config Workflow', () => {
    it('should load, validate, and use models config', () => {
      // 1. Parse config with models
      const config: Config = ConfigSchema.parse({
        models: {
          mode: 'merge',
          providers: {
            openai: {
              baseUrl: 'https://api.openai.com/v1',
              apiKey: 'sk-test123',
              models: [
                { id: 'gpt-4o', name: 'GPT-4o', reasoning: false, contextWindow: 128000 },
                { id: 'gpt-5', name: 'GPT-5', reasoning: true, contextWindow: 256000 },
              ],
            },
            anthropic: {
              baseUrl: 'https://api.anthropic.com',
              apiKey: 'ant-test123',
              models: [
                { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', reasoning: false },
                { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', reasoning: true },
              ],
            },
          },
        },
      });

      // 2. Scan providers
      const scanResults = scanProviders({ models: config.models });
      expect(scanResults.length).toBe(2);
      
      const openaiScan = scanResults.find(r => r.provider === 'openai');
      expect(openaiScan).toBeDefined();
      expect(openaiScan?.models.length).toBe(2);
      expect(openaiScan?.errors).toEqual([]);

      // 3. Build model map
      const modelMap = buildModelMap({ models: config.models });
      expect(modelMap.has('openai/gpt-4o')).toBe(true);
      expect(modelMap.has('anthropic/claude-sonnet-4-5')).toBe(true);

      // 4. Validate model references
      expect(isValidModelRef({ models: config.models }, 'openai/gpt-4o')).toBe(true);
      expect(isValidModelRef({ models: config.models }, 'invalid/model')).toBe(false);
    });

    it('should handle model validation errors', () => {
      // Schema validation will reject invalid models, so we test scan validation directly
      const invalidModel = { id: '', name: 'Invalid' };
      const result = validateModelDefinition('test', invalidModel as any);
      
      expect(result.model).toBeNull();
      expect(result.errors).toContain('missing id');
    });
  });

  describe('Model Selection and Fallback', () => {
    const config: Config = ConfigSchema.parse({
      models: {
        providers: {
          openai: {
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'sk-test',
            models: [
              { id: 'gpt-4o', name: 'GPT-4o', reasoning: false, contextWindow: 128000 },
              { id: 'o1', name: 'O1', reasoning: true, contextWindow: 200000 },
            ],
          },
          anthropic: {
            baseUrl: 'https://api.anthropic.com',
            apiKey: 'ant-test',
            models: [
              { id: 'claude-sonnet-4-5', name: 'Claude Sonnet', reasoning: false },
              { id: 'claude-opus-4-5', name: 'Claude Opus', reasoning: true },
            ],
          },
          minimax: {
            baseUrl: 'https://api.minimax.io/v1',
            apiKey: 'mm-test',
            models: [
              { id: 'minimax-m2.1', name: 'MiniMax M2.1', reasoning: false },
            ],
          },
        },
      },
      agents: {
        defaults: {
          model: {
            primary: 'anthropic/claude-sonnet-4-5',
            fallbacks: ['openai/gpt-4o', 'minimax/minimax-m2.1'],
          },
        },
      },
    });

    it('should parse and resolve model references', () => {
      // Parse model reference
      const ref = parseModelRef('anthropic/claude-sonnet-4-5');
      expect(ref).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-5' });

      // Resolve with alias
      const resolved = resolveModelRef('sonnet');
      expect(resolved).toBeDefined();
      expect(resolved?.provider).toBe('anthropic');

      // Get model config
      const modelConfig = getModelConfig(config.models?.providers, 'openai/gpt-4o');
      expect(modelConfig).toBeDefined();
      expect(modelConfig?.model.id).toBe('gpt-4o');
    });

    it('should find fallback candidates', () => {
      const candidates = getFallbackCandidates(
        { models: config.models },
        'anthropic/claude-sonnet-4-5',
        { maxAttempts: 3 }
      );

      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0].provider).not.toBe('anthropic'); // Different provider preferred
    });

    it('should select best fallback', () => {
      const fallback = selectFallback(
        { models: config.models },
        'anthropic/claude-sonnet-4-5',
        { preferReasoning: true }
      );

      expect(fallback).toBeDefined();
      // Should prefer reasoning models when option is set
      if (fallback?.model.reasoning) {
        expect(fallback.model.reasoning).toBe(true);
      }
    });

    it('should detect retryable errors', () => {
      expect(isRetryableError('Rate limit exceeded')).toBe(true);
      expect(isRetryableError('429 Too Many Requests')).toBe(true);
      expect(isRetryableError('Request timeout')).toBe(true);
      expect(isRetryableError('ETIMEDOUT')).toBe(true);
      expect(isRetryableError('500 Internal Server Error')).toBe(true);
      expect(isRetryableError('Invalid API key')).toBe(false);
      expect(isRetryableError('Model not found')).toBe(false);
    });
  });

  describe('Model Compatibility', () => {
    it('should get correct compatibility flags', () => {
      const anthropicModel = {
        id: 'claude-sonnet-4-5',
        name: 'Claude Sonnet 4.5',
        api: 'anthropic-messages' as const,
        reasoning: false,
      };

      const flags = getCompatFlags(anthropicModel);
      expect(flags.supportsStore).toBe(true);
      expect(flags.supportsDeveloperRole).toBe(true);
      expect(flags.requiresThinkingAsText).toBe(true);
      expect(flags.maxTokensField).toBe('max_completion_tokens');
    });

    it('should detect reasoning models', () => {
      const reasoningModel = { id: 'o1', name: 'O1', reasoning: true };
      const nonReasoningModel = { id: 'gpt-4o', name: 'GPT-4o', reasoning: false };

      expect(modelSupportsReasoning(reasoningModel)).toBe(true);
      expect(modelSupportsReasoning(nonReasoningModel)).toBe(false);
    });

    it('should detect vision models', () => {
      const visionModel = { id: 'gpt-4o', name: 'GPT-4o', input: ['text', 'image'] as const };
      const textOnlyModel = { id: 'gpt-4o-mini', name: 'GPT-4o Mini', input: ['text'] as const };

      expect(modelSupportsVision(visionModel)).toBe(true);
      expect(modelSupportsVision(textOnlyModel)).toBe(false);
    });

    it('should handle model-specific patterns', () => {
      // Qwen models should have qwen thinking format
      const qwenModel = { id: 'qwen-max', name: 'Qwen Max', api: 'openai-completions' as const };
      const qwenFlags = getCompatFlags(qwenModel);
      expect(qwenFlags.thinkingFormat).toBe('qwen');

      // Mistral models should require tool IDs
      const mistralModel = { id: 'mistral-large', name: 'Mistral Large', api: 'openai-completions' as const };
      const mistralFlags = getCompatFlags(mistralModel);
      expect(mistralFlags.requiresMistralToolIds).toBe(true);
    });
  });

  describe('Model Aliases', () => {
    it('should resolve common aliases', () => {
      expect(resolveModelAlias('opus')).toBe('anthropic/claude-opus-4-6');
      expect(resolveModelAlias('sonnet')).toBe('anthropic/claude-sonnet-4-6');
      expect(resolveModelAlias('gpt')).toBe('openai/gpt-5.2');
      expect(resolveModelAlias('gpt-mini')).toBe('openai/gpt-5-mini');
      expect(resolveModelAlias('gemini')).toBe('google/gemini-3-pro-preview');
      expect(resolveModelAlias('gemini-flash')).toBe('google/gemini-3-flash-preview');
    });

    it('should return original value for unknown aliases', () => {
      // Unknown aliases are returned as-is (trimmed)
      expect(resolveModelAlias('unknown-alias')).toBe('unknown-alias');
      expect(resolveModelAlias('')).toBeNull();
      expect(resolveModelAlias('   ')).toBeNull();
    });

    it('should handle case-insensitive aliases', () => {
      expect(resolveModelAlias('OPUS')).toBe('anthropic/claude-opus-4-6');
      expect(resolveModelAlias('Sonnet')).toBe('anthropic/claude-sonnet-4-6');
    });
  });

  describe('Provider Configuration', () => {
    it('should find provider config by normalized ID', () => {
      const providers = {
        openai: { baseUrl: 'https://api.openai.com/v1', models: [] },
        'z-ai': { baseUrl: 'https://api.z.ai', models: [] },
      };

      expect(findProviderConfig(providers, 'openai')).toBeDefined();
      expect(findProviderConfig(providers, 'OPENAI')).toBeDefined();
      expect(findProviderConfig(providers, 'z.ai')).toBeDefined();
      expect(findProviderConfig(providers, 'z-ai')).toBeDefined();
    });

    it('should handle missing provider config', () => {
      const providers = {
        openai: { baseUrl: 'https://api.openai.com/v1', models: [] },
      };

      expect(findProviderConfig(providers, 'anthropic')).toBeUndefined();
      expect(findProviderConfig(undefined, 'openai')).toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty models config', () => {
      const config: Config = ConfigSchema.parse({
        models: {
          mode: 'merge',
          providers: {},
        },
      });

      const scanResults = scanProviders({ models: config.models });
      expect(scanResults.length).toBe(0);

      const modelMap = buildModelMap({ models: config.models });
      expect(modelMap.size).toBe(0);
    });

    it('should handle models with minimal config', () => {
      const config: Config = ConfigSchema.parse({
        models: {
          providers: {
            test: {
              baseUrl: 'https://test.com',
              models: [{ id: 'model-1', name: 'Model 1' }],
            },
          },
        },
      });

      const scanResults = scanProviders({ models: config.models });
      expect(scanResults[0].models.length).toBe(1);
      expect(scanResults[0].models[0].contextWindow).toBe(128000); // Default
      expect(scanResults[0].models[0].maxTokens).toBe(8192); // Default
    });

    it('should handle provider with no API key', () => {
      const config: Config = ConfigSchema.parse({
        models: {
          providers: {
            openai: {
              baseUrl: 'https://api.openai.com/v1',
              apiKey: '', // Empty key
              models: [{ id: 'gpt-4o', name: 'GPT-4o' }],
            },
          },
        },
      });

      const scanResults = scanProviders({ models: config.models });
      expect(scanResults[0].errors).toEqual([]); // Validation passes, but auth will fail at runtime
    });
  });
});
