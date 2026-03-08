/**
 * Models Module
 * 
 * Model management, selection, fallback, and compatibility.
 */

export { ModelManager, type ModelManagerConfig, type RunResult } from './manager.js';
export {
  parseModelRef,
  normalizeProviderId,
  resolveModelRef,
  modelKey,
  findProviderConfig,
  findModelConfig,
  getModelConfig,
  getAllModelIds,
  type ModelRef,
  type ThinkLevel,
} from './selection.js';
export {
  getFallbackCandidates,
  selectFallback,
  type FallbackCandidate,
  type FallbackOptions,
} from './fallback.js';
export {
  getCompatFlags,
  modelSupports,
  modelSupportsReasoning,
  modelSupportsVision,
  type CompatFlags,
} from './compat.js';
export {
  scanProviders,
  scanProvider,
  type ScanResult,
} from './scan.js';
