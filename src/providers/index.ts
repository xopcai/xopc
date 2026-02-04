/**
 * Provider Factory
 * 
 * Uses @mariozechner/pi-ai for unified LLM access.
 * Supports 20+ providers: OpenAI, Anthropic, Google, Mistral, Groq, etc.
 * Supports custom providers via models configuration.
 */

import * as PiAI from '@mariozechner/pi-ai';
import type { LLMProvider } from '../types/index.js';
import type { Model, Api, KnownProvider } from '@mariozechner/pi-ai';
import type { Config } from '../config/schema.js';
import { createPiAIProvider, listAvailableModels } from './pi-ai.js';

export { PiAI, createPiAIProvider, listAvailableModels };
export type { LLMProvider, Model, Api, KnownProvider };

/**
 * Create a pi-ai provider based on config
 */
export function createProvider(config: Config): LLMProvider {
  const model = config.agents?.defaults?.model || 'anthropic/claude-sonnet-4-5';
  return createPiAIProvider(config, model);
}

/**
 * List available models from config
 */
export function getAvailableModels(config: Config) {
  return listAvailableModels(config);
}
