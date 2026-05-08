/**
 * Built-in image-generation providers: sources under extensions/*, compiled to dist/extensions/*.
 * Regenerate: pnpm run generate:bundled-image-providers
 */

import type { ImageGenerationProviderFactory } from '../agent/image/generation/bundled-registry.js';
import { buildOpenAIImageGenerationProvider } from '../../extensions/openai/src/image-generation-provider.js';
import { buildDashScopeImageGenerationProvider } from '../../extensions/dashscope/src/image-generation-provider.js';
import { buildMinimaxImageGenerationProvider } from '../../extensions/minimax/src/image-generation-provider.js';
import { buildGoogleImageGenerationProvider } from '../../extensions/google/src/image-generation-provider.js';
import { buildFalImageGenerationProvider } from '../../extensions/fal/src/image-generation-provider.js';

export { buildOpenAIImageGenerationProvider, buildDashScopeImageGenerationProvider, buildMinimaxImageGenerationProvider, buildGoogleImageGenerationProvider, buildFalImageGenerationProvider };
export const bundledImageGenerationProviderBuilders: ImageGenerationProviderFactory[] = [buildOpenAIImageGenerationProvider, buildDashScopeImageGenerationProvider, buildMinimaxImageGenerationProvider, buildGoogleImageGenerationProvider, buildFalImageGenerationProvider];
