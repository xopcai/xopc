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

const FILE_RESOURCE_ARTIFACT_URI_PREFIX = 'xopc-file:';

export function fileResourceArtifactUri(fileResourceId: string): string {
  return `${FILE_RESOURCE_ARTIFACT_URI_PREFIX}${encodeURIComponent(fileResourceId)}`;
}

export function parseFileResourceArtifactUri(uri: string): string | null {
  if (!uri.startsWith(FILE_RESOURCE_ARTIFACT_URI_PREFIX)) return null;
  try {
    const id = decodeURIComponent(uri.slice(FILE_RESOURCE_ARTIFACT_URI_PREFIX.length)).trim();
    return id || null;
  } catch {
    return null;
  }
}

export function turnOutcomeKindFromFileName(fileName: string): TurnOutcomeDeliverableKind {
  const extension = fileName.toLowerCase().split('.').pop() ?? '';
  if (extension === 'xlsx' || extension === 'xls' || extension === 'csv' || extension === 'tsv') return 'spreadsheet';
  if (extension === 'pptx' || extension === 'ppt') return 'presentation';
  if (extension === 'pdf') return 'pdf';
  if (['doc', 'docx', 'md', 'rtf', 'txt'].includes(extension)) return 'document';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(extension)) return 'image';
  if (['mp4', 'mov', 'webm'].includes(extension)) return 'video';
  if (['mp3', 'wav', 'ogg', 'm4a'].includes(extension)) return 'audio';
  if (['zip', 'tar', 'gz', 'tgz'].includes(extension)) return 'archive';
  if (extension === 'html' || extension === 'htm') return 'site';
  return 'file';
}

export function turnOutcomeMimeTypeFromFileName(fileName: string): string | undefined {
  const extension = fileName.toLowerCase().split('.').pop() ?? '';
  const mimeTypes: Record<string, string> = {
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
    csv: 'text/csv',
    tsv: 'text/tab-separated-values',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ppt: 'application/vnd.ms-powerpoint',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
    pdf: 'application/pdf',
    md: 'text/markdown',
    txt: 'text/plain',
    html: 'text/html',
    htm: 'text/html',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
    zip: 'application/zip',
  };
  return mimeTypes[extension];
}

export function parseTurnOutcome(value: unknown): TurnOutcome | null {
  const parsed = TurnOutcomeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
