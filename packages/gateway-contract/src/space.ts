import { z } from 'zod';

export const SpacePatchSchema = z.object({
  revision: z.number().int().positive(),
  title: z.string().trim().min(1).max(240).optional(),
  favorite: z.boolean().optional(),
}).strict();

export const SpaceSaveReplySchema = z.object({
  conversationId: z.string().min(1).max(160),
  entryId: z.string().min(1).max(160).optional(),
  turnId: z.string().min(1).max(160).optional(),
}).strict().refine(input => Boolean(input.entryId) !== Boolean(input.turnId));

export type SpaceOrigin = {
  kind: 'chat' | 'task' | 'automation';
  versionId?: string;
  conversationId: string;
  transcriptId?: string;
  entryId?: string;
  projectId?: string;
  taskId?: string;
  automationRunId?: string;
  label?: string;
  available: boolean;
};

export type SpaceVersion = {
  id: string;
  ordinal: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: number;
  indexStatus: 'pending' | 'ready' | 'unsupported' | 'failed';
};

export type SpaceItem = {
  id: string;
  title: string;
  kind: string;
  favorite: boolean;
  trashedAt: number | null;
  updatedAt: number;
  revision: number;
  currentVersion: SpaceVersion;
  origin?: SpaceOrigin;
  hit?: { text: string; locator: Record<string, unknown> };
};

export type SpaceDetail = SpaceItem & { versions: SpaceVersion[]; origins: SpaceOrigin[] };
export type SpaceList = { items: SpaceItem[]; nextCursor?: string };
