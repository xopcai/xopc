/**
 * Bundled image-generation provider registration helper.
 *
 * Step 3: vendor providers live under `extensions/<vendor>/src/image-generation-provider.ts`
 * and export a `buildXxxImageGenerationProvider()` factory. The generated file
 * `src/generated/bundled-image-generation-providers.ts` collects every such
 * factory; this helper walks that list and feeds each one into the registry.
 *
 * Side-effect-only: callers should `import './bundled.js'` once at runtime
 * load (see {@link ./bundled.ts}).
 */

import { createLogger } from '../../../utils/logger.js';
import {
  registerImageGenerationProvider,
  type ImageGenerationProvider,
} from './provider-registry.js';

const log = createLogger('ImageGen:Bundled');

export type ImageGenerationProviderFactory = () => ImageGenerationProvider;

/**
 * Register every bundled provider factory exactly once. Failures in a single
 * factory are isolated so one broken vendor does not knock out the rest.
 */
export function registerBundledImageGenerationProviders(
  factories: ReadonlyArray<ImageGenerationProviderFactory>,
): void {
  for (const factory of factories) {
    let provider: ImageGenerationProvider;
    try {
      provider = factory();
    } catch (err) {
      log.warn(
        { err, phase: 'factory_invoke' },
        `Skipping bundled image-generation provider factory: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      continue;
    }
    try {
      registerImageGenerationProvider(provider);
    } catch (err) {
      log.warn(
        { err, providerId: provider?.id, phase: 'register' },
        `Failed to register bundled image-generation provider: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
