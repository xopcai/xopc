/**
 * Provider Factory
 * 
 * Uses @mariozechner/pi-ai for unified LLM access.
 * Supports 20+ providers: OpenAI, Anthropic, Google, Mistral, Groq, etc.
 */

import * as PiAI from '@mariozechner/pi-ai';
import type { LLMProvider } from '../types/index.js';
import type { Model, Api, KnownProvider } from '@mariozechner/pi-ai';

export { PiAI };
export type { LLMProvider, Model, Api, KnownProvider };

/**
 * Create a pi-ai provider based on config
 */
export function createProvider(config: { providers?: Record<string, any>; agents?: { defaults?: { model?: string } } }): LLMProvider {
  const providers = config.providers || {};
  const model = config.agents?.defaults?.model || 'gpt-4o';

  const { createPiAIProvider } = require('./pi-ai.js');
  return createPiAIProvider(providers, model);
}
