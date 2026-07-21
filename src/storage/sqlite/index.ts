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
  searchMemoryIndex,
  syncMemoryIndex,
  type MemorySearchHit,
} from './memory-index-repository.js';
export {
  appendMemorySignal,
  appendMemoryTraceEvent,
  deleteMemoryRecord,
  findLatestMemoryInjectTrace,
  getMemoryProviderState,
  getMemoryRecord,
  hasUnresolvedMemoryConflict,
  listMemorySignals,
  listMemoryTraceEvents,
  listMemoryRecords,
  markMemoryRecordsConflicted,
  searchMemoryRecords,
  setMemoryProviderState,
  setMemoryTraceFeedback,
  setLatestMemoryInjectFeedback,
  summarizeMemoryRecallFeedback,
  summarizeUserUnderstandingQuality,
  USER_UNDERSTANDING_REMEDIATION_POLICY,
  upsertMemoryRecord,
  type AppendMemorySignalInput,
  type AppendMemoryTraceEventInput,
  type FindLatestMemoryInjectTraceInput,
  type ListMemoryRecordsOptions,
  type MemoryRecallFeedbackSummary,
  type MemoryFeedbackRemediationResult,
  type MemorySignalRowPayload,
  type MemoryTraceFeedback,
  type MemoryTraceEventPayload,
  type UserUnderstandingQualityMetrics,
  type SearchMemoryRecordsOptions,
  type SetMemoryTraceFeedbackInput,
  type SetLatestMemoryInjectFeedbackInput,
  type UpsertMemoryRecordInput,
} from './memory-records-repository.js';
export {
  attachMemoryEvidence,
  claimKnowledgeSourceItems,
  completeKnowledgeSourceItemSynthesis,
  deleteMemoryEvidenceForRecord,
  finishKnowledgeSyncRun,
  getKnowledgeConsumerWatermark,
  getKnowledgeSourceCursor,
  getKnowledgeSourceItem,
  listKnowledgeSourceItems,
  listKnowledgeSourceChanges,
  listKnowledgeSyncRuns,
  listMemoryEvidence,
  setKnowledgeSourceItemSynthesisStatus,
  setKnowledgeConsumerWatermark,
  setKnowledgeSourceCursor,
  startKnowledgeSyncRun,
  upsertKnowledgeSourceItems,
} from './knowledge-repository.js';
export {
  deleteSessionConfig,
  getSessionConfig,
  hasSessionConfig,
  setSessionConfig,
  updateSessionConfig,
} from './config-repository.js';
export {
  createObjectLinkRecord,
  getActivityEventRecord,
  listActivityRecords,
  listObjectActivityRecords,
  listObjectLinkRecords,
  listProjectActivityRecords,
  recordActivityEvent,
} from './activity-repository.js';
export {
  appendConnectorExecutionAudit,
  claimConnectorWebhookDelivery,
  completeConnectorWebhookDelivery,
  consumeConnectorApproval,
  createConnectorApproval,
  decideConnectorApproval,
  deleteConnectorConnection,
  deleteConnectorInstallation,
  getConnectorConnection,
  getConnectorApproval,
  getConnectorInstallation,
  getCachedConnectorCatalogEntry,
  listCachedConnectorCatalogEntries,
  listConnectorActionMetadata,
  listConnectorApprovals,
  listConnectorConnections,
  listConnectorExecutionAudit,
  listConnectorInstallations,
  releaseConnectorWebhookDelivery,
  upsertConnectorActionMetadata,
  upsertConnectorCatalogEntry,
  upsertConnectorConnection,
  upsertConnectorInstallation,
  type CachedConnectorCatalogEntry,
} from './connector-repository.js';
export {
  getUserTrustPolicy,
  setUserTrustPolicy,
} from './user-trust-repository.js';
export {
  consumeMemoryReferenceConsent,
  decideMemoryReferenceConsent,
  ensureMemoryReferenceConsentRequest,
  hasMemoryReferenceConsent,
  listMemoryReferenceConsents,
  revokeMemoryReferenceConsent,
  type MemoryReferenceConsent,
  type MemoryReferenceGrantScope,
} from './memory-reference-consent-repository.js';
export {
  getUserProfilePromptState,
  setUserProfilePromptState,
} from './user-profile-setup-repository.js';
