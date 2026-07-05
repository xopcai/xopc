/**
 * Built-in image-generation providers: sources under extensions/*, compiled to dist/extensions/*.
 * Regenerate: pnpm run generate:bundled-image-providers
 */

import type { ImageGenerationProviderFactory } from '../agent/image/generation/bundled-registry.js';
import { buildOpenAIImageGenerationProvider } from '../../extensions/openai/src/image-generation-provider.js';
import { buildDashScopeCnImageGenerationProvider } from '../../extensions/dashscope/src/image-generation-provider.js';
import { buildDashScopeIntlImageGenerationProvider } from '../../extensions/dashscope/src/image-generation-provider.js';
import { buildMinimaxCnImageGenerationProvider } from '../../extensions/minimax/src/image-generation-provider.js';
import { buildMinimaxImageGenerationProvider } from '../../extensions/minimax/src/image-generation-provider.js';
import { buildGoogleImageGenerationProvider } from '../../extensions/google/src/image-generation-provider.js';
import { buildFalImageGenerationProvider } from '../../extensions/fal/src/image-generation-provider.js';

export { buildOpenAIImageGenerationProvider, buildDashScopeCnImageGenerationProvider, buildDashScopeIntlImageGenerationProvider, buildMinimaxCnImageGenerationProvider, buildMinimaxImageGenerationProvider, buildGoogleImageGenerationProvider, buildFalImageGenerationProvider };
export const bundledImageGenerationProviderBuilders: ImageGenerationProviderFactory[] = [buildOpenAIImageGenerationProvider, buildDashScopeCnImageGenerationProvider, buildDashScopeIntlImageGenerationProvider, buildMinimaxCnImageGenerationProvider, buildMinimaxImageGenerationProvider, buildGoogleImageGenerationProvider, buildFalImageGenerationProvider];
