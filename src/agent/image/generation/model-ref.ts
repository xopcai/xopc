/**
 * Image-generation model reference parser.
 *
 * Thin wrapper over {@link parseCapabilityModelRef} (cross-capability) so
 * `runtime.ts` and tests have a stable image-specific entry point.
 */

import {
  parseCapabilityModelRef,
  type ParsedCapabilityModelRef,
} from '../../media-generation/index.js';

export type ParsedImageGenerationModelRef = ParsedCapabilityModelRef;

export function parseImageGenerationModelRef(
  raw: string | undefined | null,
): ParsedImageGenerationModelRef | null {
  return parseCapabilityModelRef(raw);
}
