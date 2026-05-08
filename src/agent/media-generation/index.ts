/**
 * media-generation — cross-capability runtime layer (image / audio / video).
 *
 * Step 1: pure helpers + types. Step 2 wires them into the new
 * image-generation runtime. Step 4 will reuse them for video / music.
 */

export {
  hasMediaNormalizationEntry,
  type MediaNormalizationDerivationSource,
  type MediaNormalizationEntry,
  type MediaNormalizationValue,
} from './normalization.types.js';

export {
  parseCapabilityModelRef,
  formatCapabilityModelRef,
  type ParsedCapabilityModelRef,
} from './model-ref.js';

export {
  buildMediaGenerationNormalizationMetadata,
  buildNoCapabilityModelConfiguredMessage,
  recordCapabilityCandidateFailure,
  resolveCapabilityModelCandidates,
  resolveClosestAspectRatio,
  resolveClosestResolution,
  resolveClosestSize,
  throwCapabilityGenerationFailure,
  type BuildNoCapabilityModelConfiguredMessageParams,
  type CapabilityProviderCandidate,
  type RecordCapabilityCandidateFailureParams,
  type ResolveCapabilityModelCandidatesParams,
  type ResolvedCapabilityModelCandidate,
  type ThrowCapabilityGenerationFailureParams,
} from './runtime-shared.js';
