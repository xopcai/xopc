// Session module exports

export { SessionManager } from './manager.js';
export { SessionStore } from './store.js';
export type { SessionStoreOptions } from './store.js';
export { SessionSearchIndex } from './search-index.js';
export {
  getOrLoadSessionSearchIndex,
  invalidateSessionSearchIndexCache,
} from './search-index-cache.js';
export { fileStemToSessionKey } from './session-file-key.js';
export { resolveSessionShardRelativePath, sanitizeSessionPathSegment } from './shard-path.js';
export { SessionConfigStore, resolveThinkingLevel, resolveReasoningLevel, resolveVerboseLevel } from './config-store.js';
export { resolveEffectiveThinkingLevel, resolveEffectiveReasoningLevel } from './thinking-resolve.js';
export type { SessionAgentConfig } from './config-store.js';

export {
  SessionStatus,
  type SessionMetadata,
  type SessionDetail,
  type SessionIndex,
  type SessionListQuery,
  type PaginatedResult,
  type SessionStats,
  type ExportFormat,
  type SessionExport,
} from './types.js';

// Re-export memory types for compatibility
export type { CompactionConfig, CompactionResult } from '../agent/memory/compaction.js';
export type { WindowConfig } from '../agent/memory/window.js';

export {
  maybeAutoTitleSessionStore,
  generateSessionTitleFromMessages,
  sanitizeSessionTitle,
  fallbackTitleFromMessages,
  isWebchatSessionKey,
  shouldAutoTitleSessionKey,
} from './session-title.js';
