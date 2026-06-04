// Session module exports

export { SessionIndex, type SessionIndexConfig } from './manager.js';
export {
  onSessionTranscriptUpdate,
  emitSessionTranscriptUpdate,
  type SessionTranscriptUpdate,
} from './transcript-events.js';
export { SessionStore } from './store.js';
export type { SessionStoreOptions } from './store.js';
export { SessionSearchIndex } from './search-index.js';
export {
  getOrLoadSessionSearchIndex,
  invalidateSessionSearchIndexCache,
} from './search-index-cache.js';
export { SessionConfigStore, resolveThinkingLevel, resolveReasoningLevel, resolveVerboseLevel } from './config-store.js';
export { resolveEffectiveThinkingLevel, resolveEffectiveReasoningLevel } from './thinking-resolve.js';
export type { SessionAgentConfig } from './config-store.js';
export {
  normalizeWorkingDirectoryInput,
  effectiveWorkspacePathForSession,
} from './session-workspace.js';

export {
  SessionStatus,
  type SessionMetadata,
  type SessionDetail,
  type SessionListQuery,
  type PaginatedResult,
  type SessionStats,
  type ExportFormat,
  type SessionExport,
  type SessionTranscriptSummary,
  type CompactionCheckpointSummary,
  type CompactionCheckpointDetail,
} from './types.js';

export { normalizeCompactionCheckpointId } from './compaction-checkpoints.js';

export { shouldSkipWebchatInboundByAbortCutoff } from './abort-cutoff.js';

export {
  DEFAULT_RESET_AT_HOUR,
  DEFAULT_RESET_MODE,
  DEFAULT_IDLE_MINUTES,
  evaluateSessionFreshness,
  resolveDailyResetAtMs,
  resolveSessionResetPolicy,
  type SessionFreshness,
  type SessionResetConfig,
  type SessionResetMode,
  type SessionResetPolicy,
  type SessionResetType,
} from './reset-policy.js';
export {
  isThreadSessionKey,
  resolveChannelResetConfig,
  resolveSessionResetType,
} from './reset-type.js';
export { resolveSessionLifecycleTimestamps, type SessionLifecycleEntry } from './lifecycle-timestamps.js';
export {
  resolveSession,
  resolveSessionKeyForRequest,
  type SessionKeyResolution,
  type SessionResolution,
} from './resolve-session.js';

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

export { messagesToClientHistory, flattenMessageContent, type ClientHistoryMessage } from './client-history.js';

export {
  XOPC_SESSION_TRANSCRIPT_TYPE,
  CURRENT_SESSION_TRANSCRIPT_VERSION,
} from './transcript-format.js';
export {
  buildSessionContextForLlm,
  isTranscriptContextEntry,
  mergeLlmMessagesPreservingContextRows,
  transcriptRowsFromJsonArray,
  type TranscriptStoredRow,
  type XopcTranscriptContextEntry,
} from './session-context-for-llm.js';
export type { XopcSessionTranscriptV1, TranscriptCompactionRecord } from './transcript-format.js';

export { applySessionPatchToMetadata, type SessionPatchBody } from './patch-metadata.js';
