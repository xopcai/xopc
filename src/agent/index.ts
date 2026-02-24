// Agent module - powered by @mariozechner/pi-agent-core
export { AgentService } from './service.js';
export type { AgentConfig } from './types.js';

// Refactored modules
export { SessionTracker } from './session-tracker.js';
export type { SessionUsage } from './session-tracker.js';
export { ModelManager } from './model-manager.js';
export { loadBootstrapFiles, extractTextContent, stripFrontMatter, truncateBootstrapContent } from './helpers.js';
export type { BootstrapFile, TruncateResult } from './helpers.js';

// Model configuration (xopcbot)
export * from './model-selection.js';
export * from './model-scan.js';
export * from './model-compat.js';
export * from './model-fallback.js';
