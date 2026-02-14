// Session module exports

export { SessionManager } from './manager.js';
export { SessionStore } from './store.js';
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
