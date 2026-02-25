// Agent module - powered by @mariozechner/pi-agent-core
export { AgentService } from './service.js';
export type { AgentConfig } from './types.js';

// Refactored modules
export { SessionTracker } from './session-tracker.js';
export type { SessionUsage } from './session-tracker.js';
export { ModelManager } from './models/index.js';

// Legacy helpers (backward compatibility)
export { loadBootstrapFiles, extractTextContent, stripFrontMatter, truncateBootstrapContent } from './helpers.js';
export type { BootstrapFile, TruncateResult } from './helpers.js';

// New workspace module (OpenClaw-style)
export {
  loadWorkspaceBootstrapFiles,
  ensureBootstrapFiles,
  readFileWithCache,
  fileExists,
  stripFrontMatter as stripWorkspaceFrontMatter,
  isWorkspaceOnboardingCompleted,
  filterBootstrapFilesForSession,
  invalidateCache,
  clearWorkspaceCache,
  // Constants
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_USER_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_BOOTSTRAP_FILENAME,
  DEFAULT_MEMORY_FILENAME,
  DEFAULT_MEMORY_ALT_FILENAME,
} from './workspace.js';
export type { WorkspaceBootstrapFile, WorkspaceBootstrapFileName, WorkspaceOnboardingState } from './workspace.js';

// System prompt builder (OpenClaw-style)
export { buildSystemPrompt, buildMinimalSystemPrompt, getBootstrapFile, hasBootstrapFile } from './system-prompt.js';
export type { SystemPromptOptions, MemoryCitationsMode } from './system-prompt.js';

// Model module
export * from './models/index.js';
