export { resolveXopcDatabasePath, XOPC_DB_FILENAME } from './paths.js';
export {
  XOPC_DB_SCHEMA_VERSION,
  XOPC_DB_BASELINE_SCHEMA_VERSION,
  SCHEMA_META_SCHEMA_VERSION_KEY,
  ensureXopcDatabaseSchema,
  readSchemaVersionForTest,
  readSchemaVersion,
} from './schema.js';
export {
  applyPendingMigrations,
  inspectSchemaMigrationStatus,
  resolveMigrationsDir,
  type SchemaMigrationStatus,
} from './migrations/runner.js';
export {
  DatabaseSchemaMigrationGapError,
  DatabaseSchemaTooNewError,
} from './migrations/errors.js';
export { discoverSqlMigrations, listRegisteredMigrationTargets } from './migrations/discover.js';
export {
  closeXopcDatabase,
  getXopcDatabase,
  isXopcDatabaseOpen,
  openXopcDatabase,
  requireXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  type OpenXopcDatabaseOptions,
  type XopcDatabase,
} from './connection.js';
export { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';
export {
  buildDefaultSessionMetadata,
  type SessionMetadataSeed,
} from './session-metadata.js';
export {
  buildGlobalSessionStats,
  classifyStoredRow,
  estimateTokensFromMessages,
  extractFtsContent,
  metadataToSessionInsert,
  sessionConfigRowToConfig,
  sessionRowToMetadata,
  transcriptEntryRowToStoredRow,
  type SessionConfigRow,
  type SessionRow,
  type TranscriptEntryRow,
} from './row-mappers.js';
export {
  deleteSessionRecord,
  ensureSessionRecord,
  getCurrentSessionId,
  getGlobalSessionStats,
  findSessionKeyBySessionId,
  getSessionPersistedLevels,
  getSessionMetadata,
  incrementSessionStatsOnAppend,
  listSessionMetadata,
  listSessionsByAgent,
  patchSessionMetadata,
  resetSessionRecord,
  resolveSessionAgentId,
  updateSessionStats,
} from './session-repository.js';
export {
  appendTranscriptEntry,
  captureCompactionCheckpoint,
  getCompactionCheckpointDetail,
  listCompactionCheckpoints,
  loadCheckpointRows,
  loadLlmMessagesForSession,
  loadTranscriptRows,
  loadTranscriptRowsForSession,
  paginateTranscriptMessages,
  replaceTranscriptRows,
  restoreCompactionCheckpoint,
} from './transcript-repository.js';
export {
  appendCronRun,
  deleteCronRunsForJob,
  readAllCronRuns,
  readCronJobHistory,
} from './cron-run-repository.js';
export {
  deleteCronJob,
  getCronJob,
  listCronJobs,
  saveCronJob,
  saveCronJobs,
} from './cron-job-repository.js';
export {
  deleteNoteRecord,
  getNoteRecord,
  listNoteRecords,
  upsertNoteRecord,
} from './notes-repository.js';
export {
  deleteNoteAgentContextRecord,
  getNoteAgentContextRecord,
  upsertNoteAgentContextRecord,
  type NoteAgentContextRecord,
} from './note-agent-context-repository.js';
export {
  resolveAgentIdFromMemoriesDir,
  searchMemoryIndex,
  syncMemoryIndex,
  type MemorySearchHit,
} from './memory-index-repository.js';
export {
  appendMemorySignal,
  appendMemoryTraceEvent,
  deleteMemoryRecord,
  getMemoryProviderState,
  getMemoryRecord,
  listMemorySignals,
  listMemoryTraceEvents,
  listMemoryRecords,
  searchMemoryRecords,
  setMemoryProviderState,
  setMemoryTraceFeedback,
  summarizeMemoryRecallFeedback,
  upsertMemoryRecord,
  type AppendMemorySignalInput,
  type AppendMemoryTraceEventInput,
  type ListMemoryRecordsOptions,
  type MemoryRecallFeedbackSummary,
  type MemorySignalRowPayload,
  type MemoryTraceFeedback,
  type MemoryTraceEventPayload,
  type SearchMemoryRecordsOptions,
  type SetMemoryTraceFeedbackInput,
  type UpsertMemoryRecordInput,
} from './memory-records-repository.js';
export {
  deleteSessionConfig,
  getSessionConfig,
  hasSessionConfig,
  setSessionConfig,
  updateSessionConfig,
} from './config-repository.js';
