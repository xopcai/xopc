/**
 * Provider Factory
 * 
 * Uses @mariozechner/pi-ai for unified LLM access.
 */

import { createProvider, getAvailableModels } from './pi-ai.js';
import type { Config } from '../config/schema.js';

export { createProvider, getAvailableModels };
export type { LLMProvider } from './pi-ai.js';
