import { z } from 'zod';

export const TURN_OUTCOME_VERSION = 1 as const;

export const TurnOutcomeDeliverableKindSchema = z.enum([
  'document',
  'spreadsheet',
  'presentation',
  'pdf',
  'image',
  'video',
  'audio',
  'site',
  'archive',
  'file',
]);

export const TurnOutcomeArtifactLocationSchema = z.enum([
  'workspace',
  'external_host',
  'worktree',
  'remote_runtime',
  'artifact_store',
]);

export const TurnOutcomeArtifactAvailabilitySchema = z.enum([
  'materializing',
  'available',
  'expired',
  'missing',
  'failed',
]);

export const TurnOutcomeArtifactCapabilitySchema = z.enum([
  'preview',
  'download',
  'open',
  'import',
  'share',
  'regenerate',
]);

export const TurnOutcomeDeliverableSchema = z.object({
  artifactId: z.string().min(1),
  title: z.string().min(1),
  kind: TurnOutcomeDeliverableKindSchema,
  mimeType: z.string().optional(),
  sizeBytes: z.number().nonnegative().optional(),
  availability: TurnOutcomeArtifactAvailabilitySchema,
  location: TurnOutcomeArtifactLocationSchema,
  capabilities: z.array(TurnOutcomeArtifactCapabilitySchema),
  uri: z.string().optional(),
  workspaceRelativePath: z.string().optional(),
  shareUrl: z.string().url().optional(),
  thumbnailUrl: z.string().optional(),
  expiresAt: z.string().optional(),
});

export const TurnOutcomeChangedFileSchema = z.object({
  path: z.string().min(1),
  status: z.enum(['added', 'modified', 'deleted', 'renamed']).optional(),
  added: z.number().nonnegative().optional(),
  removed: z.number().nonnegative().optional(),
});

export const TurnOutcomeChangeSetSchema = z.object({
  changeSetId: z.string().min(1),
  files: z.array(TurnOutcomeChangedFileSchema),
  added: z.number().nonnegative(),
  removed: z.number().nonnegative(),
  diff: z.string(),
  diffTruncated: z.boolean().optional(),
  environment: z.enum(['workspace', 'worktree', 'remote_runtime']),
});

export const TurnOutcomeEvidenceSchema = z.object({
  evidenceId: z.string().min(1),
  kind: z.enum(['check', 'screenshot', 'video', 'log']),
  label: z.string().min(1),
  status: z.enum(['passed', 'failed', 'warning']),
  durationMs: z.number().nonnegative().optional(),
  command: z.string().optional(),
  artifactId: z.string().optional(),
});

export const TurnOutcomeSchema = z.object({
  version: z.literal(TURN_OUTCOME_VERSION),
  outcomeId: z.string().min(1),
  runId: z.string().min(1),
  turnId: z.string().min(1),
  status: z.enum(['succeeded', 'partial', 'failed']),
  summary: z.string().optional(),
  deliverables: z.array(TurnOutcomeDeliverableSchema),
  changeSet: TurnOutcomeChangeSetSchema.optional(),
  evidence: z.array(TurnOutcomeEvidenceSchema),
  createdAt: z.string(),
});

export type TurnOutcomeDeliverableKind = z.infer<typeof TurnOutcomeDeliverableKindSchema>;
export type TurnOutcomeArtifactLocation = z.infer<typeof TurnOutcomeArtifactLocationSchema>;
export type TurnOutcomeArtifactAvailability = z.infer<typeof TurnOutcomeArtifactAvailabilitySchema>;
export type TurnOutcomeArtifactCapability = z.infer<typeof TurnOutcomeArtifactCapabilitySchema>;
export type TurnOutcomeDeliverable = z.infer<typeof TurnOutcomeDeliverableSchema>;
export type TurnOutcomeChangedFile = z.infer<typeof TurnOutcomeChangedFileSchema>;
export type TurnOutcomeChangeSet = z.infer<typeof TurnOutcomeChangeSetSchema>;
export type TurnOutcomeEvidence = z.infer<typeof TurnOutcomeEvidenceSchema>;
export type TurnOutcome = z.infer<typeof TurnOutcomeSchema>;

export function parseTurnOutcome(value: unknown): TurnOutcome | null {
  const parsed = TurnOutcomeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
