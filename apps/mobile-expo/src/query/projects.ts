import { ProjectOperatingViewSchema, type ProjectOperatingView } from '@xopcai/gateway-contract';
import { z } from 'zod';

import { apiFetch } from '../api/client';

const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  status: z.string().optional(),
  defaultAgentId: z.string().optional(),
  updatedAt: z.number().optional(),
});

export type Project = z.infer<typeof ProjectSchema>;

async function readError(response: Response): Promise<Error> {
  const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
  return new Error(body.error || body.message || `HTTP ${response.status}`);
}

export async function fetchProjects(): Promise<Project[]> {
  const response = await apiFetch('/api/projects?limit=100&sortBy=updatedAt&sortOrder=desc');
  if (!response.ok) throw await readError(response);
  return z.object({ ok: z.literal(true), items: z.array(ProjectSchema) }).parse(await response.json()).items;
}

export async function fetchProjectOperatingView(projectId: string): Promise<ProjectOperatingView> {
  const response = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/operating-view`);
  if (!response.ok) throw await readError(response);
  return ProjectOperatingViewSchema.parse((await response.json() as { view?: unknown }).view);
}
