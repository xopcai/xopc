import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import type { WireAttachment } from '@/features/chat/composer/composer.types';

export type ProjectStatus = 'active' | 'paused' | 'archived';
export type ProjectKind = 'coding' | 'general' | 'unknown';
export type ProjectKindSelection = 'auto' | 'coding' | 'general';

export type Project = {
  id: string;
  name: string;
  slug: string;
  description?: string;
  status: ProjectStatus;
  defaultAgentId?: string;
  workspaceRoot?: string;
  brief?: string;
  instructions?: string;
  createdAt: string;
  updatedAt: string;
  lastActiveAt?: string;
};

export type ProjectWithDetails = Project & {
  sessionCount: number;
  goalCount: number;
  activeGoalCount: number;
  recentSessions: ProjectSession[];
  recentWorkflowRuns: Array<{
    runId: string;
    definitionId: string;
    status: string;
    createdAt: number;
  }>;
};

export type ProjectOverview = {
  project: ProjectWithDetails;
  stats: {
    sessionCount: number;
    goalCount: number;
    activeGoalCount: number;
    recentWorkflowRunCount: number;
    staleGoalCount?: number;
    attentionCount?: number;
    failedWorkflowRunCount?: number;
  };
  activeGoals: ProjectGoal[];
  blockedGoals: ProjectGoal[];
  staleGoals?: ProjectGoal[];
  nextActions: Array<{
    goalId: string;
    title: string;
    nextAction?: string;
    status: string;
    updatedAt?: number;
  }>;
  attentionItems?: Array<{
    id: string;
    kind: 'blocked_goal' | 'stale_goal' | 'failed_workflow';
    title: string;
    detail?: string;
    status?: string;
    href?: string;
    updatedAt?: number;
  }>;
  timeline?: Array<{
    id: string;
    kind: 'session' | 'goal' | 'workflow' | 'memory';
    title: string;
    detail?: string;
    timestamp: number;
    status?: string;
    href?: string;
  }>;
  digest?: {
    status: 'healthy' | 'attention' | 'idle' | 'empty';
    summary: string;
    nextAction?: string;
  };
  failedWorkflowRuns?: Array<{
    runId: string;
    definitionId: string;
    status: string;
    createdAt: number;
    errorMessage?: string;
  }>;
  recentSessions: ProjectWithDetails['recentSessions'];
  recentWorkflowRuns: ProjectWithDetails['recentWorkflowRuns'];
  recommendedAction?: string;
};

export type ProjectSession = {
  key: string;
  name?: string;
  updatedAt?: string;
  agentId?: string;
  routing?: {
    agentId?: string;
  };
  messageCount?: number;
  projectId?: string;
};

export type ProjectGoal = {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority?: string;
  agentId?: string;
  updatedAt?: number;
  nextAction?: string;
  blockedReason?: string;
  projectId?: string;
};

export type ProjectFileEntry = {
  name: string;
  path: string;
  type: 'directory' | 'file';
  size?: number;
  updatedAt?: string;
};

export type ProjectFilesResponse = {
  ok: true;
  root: string;
  path: string;
  parentPath: string | null;
  entries: ProjectFileEntry[];
};

export type CreateProjectGoalInput = {
  title: string;
  description?: string;
  attachments?: WireAttachment[];
  priority?: 'low' | 'normal' | 'high';
  deadlineAt?: number;
  maxTurns?: number;
  agentId?: string;
  judgeModelRef?: string;
};

export type ProjectListResponse = {
  ok: true;
  items: Project[];
  total: number;
};

export async function fetchProjects(query?: {
  status?: ProjectStatus;
  search?: string;
  sortBy?: 'updatedAt' | 'createdAt' | 'name';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}): Promise<ProjectListResponse> {
  const params = new URLSearchParams();
  if (query?.status) params.set('status', query.status);
  if (query?.search?.trim()) params.set('search', query.search.trim());
  if (query?.sortBy) params.set('sortBy', query.sortBy);
  if (query?.sortOrder) params.set('sortOrder', query.sortOrder);
  if (query?.limit) params.set('limit', String(query.limit));
  if (query?.offset) params.set('offset', String(query.offset));
  const suffix = params.toString();
  return fetchJson<ProjectListResponse>(apiUrl(`/api/projects${suffix ? `?${suffix}` : ''}`));
}

export async function fetchProject(id: string): Promise<ProjectWithDetails> {
  const res = await fetchJson<{ ok: true; project: ProjectWithDetails }>(
    apiUrl(`/api/projects/${encodeURIComponent(id)}`),
  );
  return res.project;
}

export async function fetchProjectOverview(id: string): Promise<ProjectOverview> {
  const res = await fetchJson<{ ok: true; overview: ProjectOverview }>(
    apiUrl(`/api/projects/${encodeURIComponent(id)}/overview`),
  );
  return res.overview;
}

export async function createProject(input: {
  name?: string;
  description?: string;
  defaultAgentId?: string;
  workspaceRoot?: string;
  createWorkspaceRoot?: boolean;
  projectKind?: ProjectKindSelection;
  brief?: string;
  instructions?: string;
}): Promise<Project> {
  const res = await fetchJson<{ ok: true; project: Project }>(apiUrl('/api/projects'), {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.project;
}

export async function inferProjectDefaults(input: {
  name?: string;
  description?: string;
  workspaceRoot?: string;
  projectKind?: ProjectKindSelection;
}): Promise<{
  inference: {
    kind: ProjectKind;
    confidence: number;
    reasons: string[];
  };
  defaultAgentId?: string;
}> {
  const res = await fetchJson<{
    ok: true;
    inference: {
      kind: ProjectKind;
      confidence: number;
      reasons: string[];
    };
    defaultAgentId?: string;
  }>(apiUrl('/api/projects/infer-defaults'), {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return { inference: res.inference, defaultAgentId: res.defaultAgentId };
}

export async function updateProject(
  id: string,
  input: Partial<Pick<Project, 'name' | 'description' | 'status' | 'defaultAgentId' | 'workspaceRoot' | 'brief' | 'instructions'>> & {
    createWorkspaceRoot?: boolean;
  },
): Promise<Project> {
  const res = await fetchJson<{ ok: true; project: Project }>(apiUrl(`/api/projects/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return res.project;
}

export async function deleteProject(id: string): Promise<void> {
  await fetchJson(apiUrl(`/api/projects/${encodeURIComponent(id)}`), { method: 'DELETE' });
}

export async function fetchProjectSessions(projectId: string): Promise<ProjectSession[]> {
  const res = await fetchJson<{ ok: true; sessions: ProjectSession[] }>(
    apiUrl(`/api/projects/${encodeURIComponent(projectId)}/sessions?limit=100`),
  );
  return res.sessions;
}

export async function summarizeProjectSession(projectId: string, sessionKey: string): Promise<void> {
  await fetchJson(apiUrl(`/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionKey)}/summary-memory`), {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function saveProjectDigest(projectId: string): Promise<void> {
  await fetchJson(apiUrl(`/api/projects/${encodeURIComponent(projectId)}/digest-memory`), {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function createProjectBlocker(projectId: string, input: { title: string; reason?: string }): Promise<ProjectGoal> {
  const res = await fetchJson<{ ok: true; goal: ProjectGoal }>(apiUrl(`/api/projects/${encodeURIComponent(projectId)}/blockers`), {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.goal;
}

export async function fetchProjectGoals(projectId: string): Promise<ProjectGoal[]> {
  const res = await fetchJson<{ ok: true; goals: ProjectGoal[] }>(
    apiUrl(`/api/projects/${encodeURIComponent(projectId)}/goals?limit=100`),
  );
  return res.goals;
}

export async function fetchProjectFiles(projectId: string, path?: string): Promise<ProjectFilesResponse> {
  const params = new URLSearchParams();
  if (path) params.set('path', path);
  const suffix = params.toString();
  return fetchJson<ProjectFilesResponse>(
    apiUrl(`/api/projects/${encodeURIComponent(projectId)}/files${suffix ? `?${suffix}` : ''}`),
  );
}

export async function createProjectSession(projectId: string, agentId?: string): Promise<ProjectSession> {
  const res = await fetchJson<{ session: ProjectSession }>(apiUrl('/api/sessions'), {
    method: 'POST',
    body: JSON.stringify({ projectId, ...(agentId ? { agentId } : {}) }),
  });
  return res.session;
}

export async function createProjectGoal(projectId: string, input: CreateProjectGoalInput): Promise<ProjectGoal> {
  const res = await fetchJson<{ ok: true; goal: ProjectGoal }>(apiUrl('/api/goals'), {
    method: 'POST',
    body: JSON.stringify({
      title: input.title,
      projectId,
      priority: input.priority ?? 'normal',
      contextMessage: {
        text: input.description ?? '',
        attachments: input.attachments?.length ? input.attachments : undefined,
      },
      deadlineAt: input.deadlineAt,
      maxTurns: input.maxTurns,
      agentId: input.agentId,
      judgeModelRef: input.judgeModelRef,
      source: 'api',
    }),
  });
  return res.goal;
}

export async function addProjectGoalChecklistItem(goalId: string, text: string): Promise<void> {
  await fetchJson(apiUrl(`/api/goals/${encodeURIComponent(goalId)}/checklist`), {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}
