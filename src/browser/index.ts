export { BrowserManager, type BrowserManagerOptions } from './manager.js';
export { resolveBrowserBackendFromConfig } from './backend-from-config.js';
export { resolveBrowserCommandTimeoutMs } from './browser-command-timeout.js';
export {
  assertBrowserUrlAllowed,
  checkPostRedirectUrl,
  containsApiKeyPattern,
  isAlwaysBlockedUrl,
} from './url-policy.js';
export { CdpSupervisor, type DialogEvent, type ConsoleEntry, type DialogPolicy } from './cdp-supervisor.js';
export { truncateSnapshotAtBoundary, snapshotSummaryHeader } from './snapshot-helpers.js';
export {
  startTracing,
  stopTracing,
  checkBotDetection,
  cleanupOrphanProcesses,
  type TracingOptions,
  type BotDetectionResult,
} from './session-lifecycle.js';
export {
  BrowserBackSchema,
  BrowserCdpSchema,
  BrowserClickSchema,
  BrowserCloseSchema,
  BrowserConsoleSchema,
  BrowserDialogSchema,
  BrowserGetImagesSchema,
  BrowserNavigateSchema,
  BrowserPressSchema,
  BrowserScreenshotSchema,
  BrowserScrollSchema,
  BrowserSnapshotSchema,
  BrowserTypeSchema,
  BrowserVisionSchema,
} from './schemas.js';

export {
  humanizedClick,
  humanizedFill,
  humanizedPress,
  humanizedScroll,
  resolveHumanConfig,
  generateMousePath,
  generateTypingPlan,
  generateScrollPlan,
  type HumanConfig,
  type HumanPreset,
} from './humanize.js';

export {
  buildStealthArgs,
  buildLocalStealthArgs,
  generateFingerprintSeed,
  removeQuarantineAttr,
  makeExecutable,
  WEBDRIVER_OVERRIDE_SCRIPT,
  type StealthOptions,
} from './stealth.js';

export { createBrowserActionRegistry } from './actions/registry.js';
export type {
  BrowserActionName,
  BrowserActionContext,
  BrowserActionHandler,
  BrowserActionRegistry as BrowserActionRegistryType,
  BrowserActionResult,
  BrowserArtifact,
  BrowserDiagnostics,
} from './actions/types.js';

export { parseBrowserPipeline, type PipelineDocument, type PipelineStep } from './pipeline/schema.js';
export { runBrowserPipeline, validateBrowserPipeline } from './pipeline/runner.js';
export { loadBrowserPipelineSource } from './pipeline/source.js';
export { resolveTemplate, resolveTemplateDeep } from './pipeline/template.js';
