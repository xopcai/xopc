import {
  ProjectOperatingSummarySchema,
  ProjectOperatingViewSchema,
  type ProjectOperatingView,
} from '@xopcai/gateway-contract';
import { z } from 'zod';

import { apiFetch } from '../api/client';

const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  status: z.string().optional(),
  defaultAgentId: z.string().optional(),
  executionMode: z.enum(['local_checkout', 'managed_worktree']).optional(),
  updatedAt: z.number().optional(),
  operating: ProjectOperatingSummarySchema,
});

const ProjectSessionSchema = z.object({
  key: z.string(),
  name: z.string().optional(),
  title: z.string().optional(),
  displayName: z.string().optional(),
  updatedAt: z.union([z.string(), z.number()]).optional(),
  agentId: z.string().optional(),
  sourceChannel: z.string().optional(),
  messageCount: z.number().optional(),
  projectId: z.string().optional(),
  routing: z.object({ agentId: z.string().optional() }).passthrough().optional(),
}).passthrough();

const ProjectMilestoneSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  status: z.enum(['planned', 'active', 'completed', 'cancelled']),
  targetAt: z.number().optional(),
  sortOrder: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const ProjectUpdateSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  health: z.enum(['unknown', 'on_track', 'at_risk', 'off_track']),
  summary: z.string(),
  progress: z.array(z.string()),
  risks: z.array(z.string()),
  nextSteps: z.array(z.string()),
  actor: z.record(z.string(), z.unknown()),
  createdAt: z.number(),
});

const ProjectDetailsSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  brief: z.string().optional(),
  outcome: z.string().optional(),
  status: z.string(),
  defaultAgentId: z.string().optional(),
  workspaceRoot: z.string().optional(),
  effectiveWorkspaceRoot: z.string().optional(),
  executionMode: z.enum(['local_checkout', 'managed_worktree']).optional(),
  pinnedAt: z.number().optional(),
  milestones: z.array(ProjectMilestoneSchema).default([]),
  recentUpdates: z.array(ProjectUpdateSchema).default([]),
}).passthrough();

const ProjectSkillSchema = z.object({
  key: z.string(),
  directoryId: z.string(),
  name: z.string(),
  description: z.string(),
  origin: z.enum(['extra', 'bundled', 'agents-global', 'agents-workspace', 'custom-global', 'xopc-global', 'xopc-workspace']),
  path: z.string(),
  effective: z.boolean(),
  shadowedBy: z.string().optional(),
  disableModelInvocation: z.boolean(),
});

const ProjectSkillSourceSchema = z.object({
  origin: z.enum(['xopc-workspace', 'agents-workspace']),
  rootDir: z.string(),
  state: z.enum(['active', 'missing', 'disabled', 'untrusted', 'invalid']),
});

const ProjectSkillsResponseSchema = z.object({
  ok: z.literal(true),
  workspaceRoot: z.string(),
  sources: z.array(ProjectSkillSourceSchema),
  items: z.array(ProjectSkillSchema),
  inheritedItems: z.array(ProjectSkillSchema),
  diagnostics: z.array(z.object({
    type: z.enum(['skipped', 'warning', 'collision', 'error']),
    message: z.string(),
    path: z.string().optional(),
  })),
});

const ProjectActivityEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  primaryObject: z.object({ kind: z.string(), id: z.string(), title: z.string().optional() }),
  actor: z.object({ kind: z.string(), id: z.string().optional(), name: z.string().optional(), agentId: z.string().optional() }).passthrough(),
  payload: z.record(z.string(), z.unknown()),
  importance: z.enum(['low', 'normal', 'high']),
  createdAt: z.number(),
}).passthrough();

export type Project = z.infer<typeof ProjectSchema>;
export type ProjectSession = z.infer<typeof ProjectSessionSchema>;
export type ProjectDetails = z.infer<typeof ProjectDetailsSchema>;
export type ProjectMilestone = z.infer<typeof ProjectMilestoneSchema>;
export type ProjectUpdate = z.infer<typeof ProjectUpdateSchema>;
export type ProjectSkill = z.infer<typeof ProjectSkillSchema>;
export type ProjectSkillSource = z.infer<typeof ProjectSkillSourceSchema>;
export type ProjectSkillsResponse = z.infer<typeof ProjectSkillsResponseSchema>;
export type ProjectActivityEvent = z.infer<typeof ProjectActivityEventSchema>;

async function readError(response: Response): Promise<Error> {
  const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
  return new Error(body.error || body.message || `HTTP ${response.status}`);
}

export async function fetchProjects(): Promise<Project[]> {
  const response = await apiFetch('/api/projects?limit=100&sortBy=updatedAt&sortOrder=desc&includeOperating=true');
  if (!response.ok) throw await readError(response);
  return z.object({ ok: z.literal(true), items: z.array(ProjectSchema) }).parse(await response.json()).items;
}

export async function fetchProjectOperatingView(projectId: string): Promise<ProjectOperatingView> {
  const response = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/operating-view`);
  if (!response.ok) throw await readError(response);
  return ProjectOperatingViewSchema.parse((await response.json() as { view?: unknown }).view);
}

export async function fetchProjectSessions(projectId: string): Promise<ProjectSession[]> {
  const response = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/sessions?limit=100`);
  if (!response.ok) throw await readError(response);
  return z.object({ ok: z.literal(true), sessions: z.array(ProjectSessionSchema) })
    .parse(await response.json()).sessions;
}

export async function fetchProject(projectId: string): Promise<ProjectDetails> {
  const response = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}`);
  if (!response.ok) throw await readError(response);
  return ProjectDetailsSchema.parse((await response.json() as { project?: unknown }).project);
}

export async function fetchProjectEnvironmentOptions(projectId: string) {
  const response = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/environment-options`);
  if (!response.ok) throw await readError(response);
  return z.object({
    options: z.object({
      localAvailable: z.boolean(),
      worktreeUnavailableReason: z.enum(['workspace_unavailable', 'git_commit_required', 'uncommitted_changes']).optional(),
    }),
  }).parse(await response.json()).options;
}

export async function fetchProjectActivity(projectId: string, limit = 8): Promise<ProjectActivityEvent[]> {
  const params = new URLSearchParams({ visibility: 'timeline', limit: String(limit) });
  const response = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/activity?${params.toString()}`);
  if (!response.ok) throw await readError(response);
  return z.object({ ok: z.literal(true), items: z.array(ProjectActivityEventSchema) })
    .parse(await response.json()).items;
}

export async function fetchProjectSkills(projectId: string): Promise<ProjectSkillsResponse> {
  const response = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/skills`);
  if (!response.ok) throw await readError(response);
  return ProjectSkillsResponseSchema.parse(await response.json());
}

async function projectAction(projectId: string, action: 'pin' | 'unpin'): Promise<ProjectDetails> {
  const response = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/${action}`, { method: 'POST' });
  if (!response.ok) throw await readError(response);
  return ProjectDetailsSchema.parse((await response.json() as { project?: unknown }).project);
}

export function pinProject(projectId: string): Promise<ProjectDetails> {
  return projectAction(projectId, 'pin');
}

export function unpinProject(projectId: string): Promise<ProjectDetails> {
  return projectAction(projectId, 'unpin');
}

export async function updateProjectStatus(projectId: string, status: 'active' | 'archived'): Promise<ProjectDetails> {
  const response = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
  if (!response.ok) throw await readError(response);
  return ProjectDetailsSchema.parse((await response.json() as { project?: unknown }).project);
}
