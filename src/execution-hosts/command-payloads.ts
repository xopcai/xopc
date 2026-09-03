import { z } from 'zod';

import { isWorkspaceExecutionToolName } from '../agent/tools/workspace-execution-backend.js';

export const provisionEnvironmentPayloadSchema = z.strictObject({
  repositoryUrl: z.string().min(1).max(4_096),
  baseSha: z.string().regex(/^[0-9a-f]{40,64}$/i),
});

export const workspaceToolPayloadSchema = z.strictObject({
  toolCallId: z.string().min(1).max(200),
  toolName: z.string().refine(isWorkspaceExecutionToolName, 'Unsupported workspace execution tool'),
  params: z.unknown(),
});

const snapshotArtifactIdSchema = z.string().min(1).max(160).regex(/^[a-zA-Z0-9._-]+$/);
const snapshotShaSchema = z.string().regex(/^[0-9a-f]{64}$/i);
const gitShaSchema = z.string().regex(/^[0-9a-f]{40,64}$/i);

export const snapshotPayloadSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('create'), artifactId: snapshotArtifactIdSchema }),
  z.strictObject({
    action: z.literal('read'),
    artifactId: snapshotArtifactIdSchema,
    offset: z.number().int().nonnegative(),
    length: z.number().int().min(1).max(96 * 1024),
  }),
  z.strictObject({
    action: z.literal('begin_import'),
    artifactId: snapshotArtifactIdSchema,
    baseSha: gitShaSchema,
    size: z.number().int().positive().max(128 * 1024 * 1024),
    sha256: snapshotShaSchema,
  }),
  z.strictObject({
    action: z.literal('write_import'),
    artifactId: snapshotArtifactIdSchema,
    offset: z.number().int().nonnegative(),
    data: z.string().max(132 * 1024),
  }),
  z.strictObject({ action: z.literal('finalize_import'), artifactId: snapshotArtifactIdSchema }),
  z.strictObject({ action: z.literal('apply_import'), artifactId: snapshotArtifactIdSchema }),
  z.strictObject({ action: z.literal('remove'), artifactId: snapshotArtifactIdSchema }),
]);

export type ProvisionEnvironmentPayload = z.infer<typeof provisionEnvironmentPayloadSchema>;
export type WorkspaceToolPayload = z.infer<typeof workspaceToolPayloadSchema>;
export type SnapshotPayload = z.infer<typeof snapshotPayloadSchema>;
