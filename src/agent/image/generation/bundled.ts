/**
 * Bundled image-generation providers — side-effect entry point.
 *
 * Imported once from {@link ./runtime.ts}. Every vendor provider listed in
 * `src/generated/bundled-image-generation-providers.ts` (regenerated via
 * `pnpm run generate:bundled-image-providers`) is registered via the bundled
 * helper, mirroring how `src/channels/plugins/bundled.ts` wires bundled
 * channel plugins.
 */

import { bundledImageGenerationProviderBuilders } from '../../../generated/bundled-image-generation-providers.js';
import { registerBundledImageGenerationProviders } from './bundled-registry.js';

registerBundledImageGenerationProviders(bundledImageGenerationProviderBuilders);
