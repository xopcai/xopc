import { z } from 'zod';

export const LOCAL_APP_MAX_DIAGNOSTICS = 20;
export const LocalAppSourceHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const LocalAppStatusSchema = z.enum(['preview_ready', 'installed', 'degraded']);
export const LocalAppInstallationStateSchema = z.enum(['not_installed', 'installed']);
export const LocalAppReleaseHealthSchema = z.enum(['healthy', 'failed']);

export const LocalAppAcceptanceCheckSchema = z.strictObject({
  id: z.enum(['document', 'content', 'interaction', 'criteria']),
  status: z.enum(['passed', 'failed', 'skipped']),
  message: z.string().trim().min(1).max(500),
});

export const LocalAppAcceptanceResultSchema = z.strictObject({
  status: z.enum(['passed', 'failed']),
  checks: z.array(LocalAppAcceptanceCheckSchema).min(1).max(10),
  interactiveCount: z.number().int().min(0).max(10_000),
});

export const LocalAppAcceptanceInputSchema = LocalAppAcceptanceResultSchema.extend({
  sourceHash: LocalAppSourceHashSchema,
}).refine((value) => value.checks.length >= 3 && value.checks.length <= 4, {
  message: 'Acceptance input must contain three or four checks',
  path: ['checks'],
});

export const LocalAppAcceptanceOutputSchema = LocalAppAcceptanceInputSchema.safeExtend({
  id: z.string().min(1),
  appId: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
});

export const LocalAppReleaseSchema = z.strictObject({
  id: z.string().min(1),
  appId: z.string().min(1),
  version: z.number().int().positive(),
  sourceHash: LocalAppSourceHashSchema,
  healthStatus: LocalAppReleaseHealthSchema,
  createdAt: z.number().int().nonnegative(),
  activatedAt: z.number().int().nonnegative().optional(),
  isActive: z.boolean(),
});

export const LocalAppRecordSchema = z.strictObject({
  id: z.string().min(1),
  extensionId: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  idea: z.string().min(1),
  status: LocalAppStatusSchema,
  workspaceRoot: z.string().min(1),
  draftVersion: z.number().int().positive(),
  activeVersion: z.number().int().positive().optional(),
  activeReleaseId: z.string().min(1).optional(),
  installationState: LocalAppInstallationStateSchema,
  enabled: z.boolean(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  installedAt: z.number().int().nonnegative().optional(),
});

export const LocalAppAcceptanceRunSchema = LocalAppAcceptanceOutputSchema;

export const LocalAppDetailSchema = LocalAppRecordSchema.extend({
  draftPreviewUrl: z.string().startsWith('/api/local-apps/preview/'),
  permissions: z.array(z.string()),
  releases: z.array(LocalAppReleaseSchema),
  acceptanceRuns: z.array(LocalAppAcceptanceRunSchema),
});

export const LocalAppValidationIssueSchema = z.strictObject({
  code: z.string().trim().min(1).max(80),
  severity: z.enum(['error', 'warning']),
  message: z.string().trim().min(1).max(500),
});

export const LocalAppChangedFileSchema = z.strictObject({
  path: z.string().min(1).max(4096),
  status: z.enum(['added', 'modified', 'deleted']),
});

export const LocalAppAcceptanceScenarioSummarySchema = z.strictObject({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  stepCount: z.number().int().nonnegative(),
});

export const LocalAppValidationSchema = z.strictObject({
  status: z.enum(['healthy', 'failed']),
  checkedAt: z.number().int().nonnegative(),
  sourceHash: LocalAppSourceHashSchema.optional(),
  hasDraftChanges: z.boolean(),
  changedFiles: z.array(LocalAppChangedFileSchema).max(50),
  changedFileCount: z.number().int().nonnegative(),
  permissions: z.array(z.string()),
  permissionDelta: z.strictObject({ added: z.array(z.string()), removed: z.array(z.string()) }),
  acceptanceScenarioCount: z.number().int().nonnegative(),
  acceptanceScenarios: z.array(LocalAppAcceptanceScenarioSummarySchema),
  issues: z.array(LocalAppValidationIssueSchema).max(100),
});

export const LocalAppPreviewSnapshotSchema = z.strictObject({
  appId: z.string().min(1),
  sourceHash: LocalAppSourceHashSchema,
  status: z.enum(['ready', 'invalid']),
  createdAt: z.number().int().nonnegative(),
  entryPath: z.string().min(1).max(4096).optional(),
  previewUrl: z.string().startsWith('/api/local-apps/preview/').optional(),
  validation: LocalAppValidationSchema,
}).superRefine((snapshot, context) => {
  const runnable = snapshot.status === 'ready';
  if (runnable !== Boolean(snapshot.entryPath)) {
    context.addIssue({ code: 'custom', path: ['entryPath'], message: 'Ready snapshots require an entry path' });
  }
  if (snapshot.previewUrl && !runnable) {
    context.addIssue({ code: 'custom', path: ['previewUrl'], message: 'Invalid snapshots cannot have a preview URL' });
  }
  if (snapshot.validation.sourceHash !== snapshot.sourceHash) {
    context.addIssue({ code: 'custom', path: ['validation', 'sourceHash'], message: 'Snapshot validation hash must match the snapshot' });
  }
});

export const LocalAppDiagnosticPhaseSchema = z.enum([
  'build',
  'boot',
  'runtime',
  'acceptance',
  'runner',
  'capability',
]);

export const LocalAppDiagnosticSchema = z.strictObject({
  phase: LocalAppDiagnosticPhaseSchema,
  message: z.string().trim().min(1).max(500),
  code: z.string().trim().min(1).max(80).optional(),
});

export const LocalAppFixGuidanceInputSchema = z.strictObject({
  sourceHash: LocalAppSourceHashSchema.optional(),
  locale: z.enum(['en', 'zh']).default('en'),
  diagnostics: z.array(LocalAppDiagnosticSchema).min(1).max(LOCAL_APP_MAX_DIAGNOSTICS),
});

export const LocalAppFixGuidanceSchema = z.strictObject({
  appId: z.string().min(1),
  sourceHash: LocalAppSourceHashSchema.optional(),
  owner: z.enum(['generated_code', 'platform', 'configuration']),
  action: z.enum(['fix_code', 'retry', 'fix_config']),
  diagnostics: z.array(LocalAppDiagnosticSchema).max(LOCAL_APP_MAX_DIAGNOSTICS),
  prompt: z.string().min(1),
});

export const LocalAppRuntimeIssueSchema = z.strictObject({
  kind: z.enum(['script_error', 'unhandled_rejection']),
  message: z.string().trim().min(1).max(500),
  filename: z.string().max(500).optional(),
  line: z.number().nonnegative().optional(),
  column: z.number().nonnegative().optional(),
});

export const LocalAppCriteriaScenarioResultSchema = z.strictObject({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  status: z.enum(['passed', 'failed']),
  message: z.string().trim().min(1).max(500),
  failureKind: z.enum(['scenario', 'runner']).default('scenario'),
});

export const LocalAppCriteriaResultSchema = z.strictObject({
  status: z.enum(['passed', 'failed']),
  scenarioCount: z.number().int().min(0).max(10),
  scenarios: z.array(LocalAppCriteriaScenarioResultSchema).max(10),
});

const runtimeEnvelope = z.strictObject({
  source: z.literal('xopc-local-app-preview'),
  version: z.literal(1),
});

export const LocalAppRuntimeMessageSchema = z.discriminatedUnion('type', [
  runtimeEnvelope.extend({
    type: z.literal('ready'),
    detail: z.strictObject({ readyState: z.string().max(100).optional() }),
  }),
  runtimeEnvelope.extend({ type: z.literal('error'), detail: LocalAppRuntimeIssueSchema }),
  runtimeEnvelope.extend({ type: z.literal('acceptance'), detail: LocalAppAcceptanceResultSchema }),
  runtimeEnvelope.extend({ type: z.literal('criteria'), detail: LocalAppCriteriaResultSchema }),
]);

export type LocalAppStatus = z.infer<typeof LocalAppStatusSchema>;
export type LocalAppInstallationState = z.infer<typeof LocalAppInstallationStateSchema>;
export type LocalAppReleaseHealth = z.infer<typeof LocalAppReleaseHealthSchema>;
export type LocalAppAcceptanceCheck = z.infer<typeof LocalAppAcceptanceCheckSchema>;
export type LocalAppAcceptanceResult = z.infer<typeof LocalAppAcceptanceResultSchema>;
export type LocalAppAcceptanceInput = z.infer<typeof LocalAppAcceptanceInputSchema>;
export type LocalAppAcceptanceRun = z.infer<typeof LocalAppAcceptanceRunSchema>;
export type LocalAppRelease = z.infer<typeof LocalAppReleaseSchema>;
export type LocalAppRecord = z.infer<typeof LocalAppRecordSchema>;
export type LocalAppDetail = z.infer<typeof LocalAppDetailSchema>;
export type LocalAppValidationIssue = z.infer<typeof LocalAppValidationIssueSchema>;
export type LocalAppChangedFile = z.infer<typeof LocalAppChangedFileSchema>;
export type LocalAppAcceptanceScenarioSummary = z.infer<typeof LocalAppAcceptanceScenarioSummarySchema>;
export type LocalAppValidationResult = z.infer<typeof LocalAppValidationSchema>;
export type LocalAppPreviewSnapshot = z.infer<typeof LocalAppPreviewSnapshotSchema>;
export type LocalAppDiagnosticPhase = z.infer<typeof LocalAppDiagnosticPhaseSchema>;
export type LocalAppDiagnostic = z.infer<typeof LocalAppDiagnosticSchema>;
export type LocalAppFixGuidanceInput = z.input<typeof LocalAppFixGuidanceInputSchema>;
export type LocalAppFixGuidance = z.infer<typeof LocalAppFixGuidanceSchema>;
export type LocalAppRuntimeIssue = z.infer<typeof LocalAppRuntimeIssueSchema>;
export type LocalAppCriteriaScenarioResult = z.infer<typeof LocalAppCriteriaScenarioResultSchema>;
export type LocalAppCriteriaResult = z.infer<typeof LocalAppCriteriaResultSchema>;
export type LocalAppRuntimeMessageEnvelope = z.infer<typeof LocalAppRuntimeMessageSchema>;

export type LocalAppRuntimeMessage =
  | { type: 'ready'; detail: { readyState?: string } }
  | { type: 'error'; detail: LocalAppRuntimeIssue }
  | { type: 'acceptance'; detail: LocalAppAcceptanceResult }
  | { type: 'criteria'; detail: LocalAppCriteriaResult };

export function parseLocalAppRuntimeMessage(value: unknown): LocalAppRuntimeMessage | null {
  const parsed = LocalAppRuntimeMessageSchema.safeParse(value);
  if (!parsed.success) return null;
  const { type, detail } = parsed.data;
  return { type, detail } as LocalAppRuntimeMessage;
}
