import { z } from 'zod';

export const FileSpaceBindingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('agent'), id: z.string().min(1) }),
  z.object({ kind: z.literal('project'), id: z.string().min(1) }),
  z.object({ kind: z.literal('session'), id: z.string().min(1) }),
]);

export const FileCapabilitySchema = z.enum(['preview', 'edit', 'download', 'share', 'upload']);

export const FileSpaceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  kind: z.enum(['workspace', 'artifact_store']),
  bindings: z.array(FileSpaceBindingSchema),
  writable: z.boolean(),
  lastActivityAt: z.number().int().nonnegative().optional(),
});

export const FileResourceSchema = z.object({
  id: z.string().min(1),
  spaceId: z.string().min(1),
  name: z.string(),
  relativePath: z.string(),
  parentPath: z.string(),
  kind: z.enum(['file', 'directory']),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  modifiedAt: z.number().int().nonnegative(),
  revision: z.string().min(1),
  capabilities: z.array(FileCapabilitySchema),
});

export const FileResourceResponseSchema = z.object({ resource: FileResourceSchema });
export const FileSpacesResponseSchema = z.object({ spaces: z.array(FileSpaceSchema) });
export const FileResourcesResponseSchema = z.object({ items: z.array(FileResourceSchema) });

export type FileSpaceBinding = z.infer<typeof FileSpaceBindingSchema>;
export type FileCapability = z.infer<typeof FileCapabilitySchema>;
export type FileSpace = z.infer<typeof FileSpaceSchema>;
export type FileResource = z.infer<typeof FileResourceSchema>;
