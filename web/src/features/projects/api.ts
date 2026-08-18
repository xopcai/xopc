import { ProjectOperatingViewSchema, type ProjectOperatingView } from '@xopcai/gateway-contract';

import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

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
  workspaceMode?: 'followAgent' | 'fixed';
  effectiveWorkspaceRoot?: string;
  brief?: string;
  instructions?: string;
  createdAt: string;
  updatedAt: string;
  lastActiveAt?: string;
  pinnedAt?: number;
};

export type ProjectWithDetails = Project & {
  sessionCount: number;
  recentSessions: ProjectSession[];
  recentWorkflowRuns: Array<{
    runId: string;
    definitionId: string;
    status: string;
    createdAt: number;
  }>;
};

export type ProjectSession = {
  key: string;
  name?: string;
  updatedAt?: string;
  agentId?: string;
  sourceChannel?: string;
  routing?: {
    agentId?: string;
  };
  messageCount?: number;
  projectId?: string;
};

export type ProjectBlocker = {
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
  absolutePath?: string;
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

export type ProjectFileSearchEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
};

export type ProjectActivityObjectKind =
  | 'project'
  | 'note'
  | 'work_item'
  | 'session'
  | 'outcome'
  | 'workflow_run'
  | 'automation';

export type ProjectActivityEvent = {
  id: string;
  type: string;
  primaryObject: {
    kind: ProjectActivityObjectKind;
    id: string;
    title?: string;
  };
  actor: {
    kind: string;
    id?: string;
    name?: string;
    sessionKey?: string;
    agentId?: string;
  };
  initiator?: {
    kind: string;
    id?: string;
    name?: string;
    sessionKey?: string;
    agentId?: string;
  };
  source: {
    kind: string;
    requestId?: string;
    toolCallId?: string;
    runId?: string;
  };
  payload: Record<string, unknown>;
  visibility: 'timeline' | 'audit' | 'debug';
  importance: 'low' | 'normal' | 'high';
  createdAt: number;
  scopes: Array<{
    activityId: string;
    scopeKind: string;
    scopeId: string;
    reason: string;
  }>;
  relatedProjects: Array<{
    activityId: string;
    projectId: string;
    reason: string;
    confidence: number;
    computedAt: number;
  }>;
};

export type ProjectActivityResponse = {
  ok: true;
  items: ProjectActivityEvent[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
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

export async function fetchProjectOperatingView(id: string): Promise<ProjectOperatingView> {
  const response = await fetchJson<unknown>(
    apiUrl(`/api/projects/${encodeURIComponent(id)}/operating-view`),
  );
  return ProjectOperatingViewSchema.parse(response && typeof response === 'object'
    ? (response as { view?: unknown }).view
    : undefined);
}

export async function fetchProjectActivity(
  projectId: string,
  options: { includeRelated?: boolean; limit?: number; offset?: number } = {},
): Promise<ProjectActivityResponse> {
  const params = new URLSearchParams();
  params.set('visibility', 'timeline');
  if (options.includeRelated) params.set('includeRelated', 'true');
  if (options.limit) params.set('limit', String(options.limit));
  if (options.offset) params.set('offset', String(options.offset));
  const suffix = params.toString();
  return fetchJson<ProjectActivityResponse>(
    apiUrl(`/api/projects/${encodeURIComponent(projectId)}/activity${suffix ? `?${suffix}` : ''}`),
  );
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

export async function renameProject(id: string, name: string): Promise<Project> {
  return updateProject(id, { name });
}

export async function archiveProject(id: string): Promise<Project> {
  return updateProject(id, { status: 'archived' });
}

export async function restoreProject(id: string): Promise<Project> {
  return updateProject(id, { status: 'active' });
}

export async function pinProject(id: string): Promise<Project> {
  const res = await fetchJson<{ ok: true; project: Project }>(
    apiUrl(`/api/projects/${encodeURIComponent(id)}/pin`),
    { method: 'POST' },
  );
  return res.project;
}

export async function unpinProject(id: string): Promise<Project> {
  const res = await fetchJson<{ ok: true; project: Project }>(
    apiUrl(`/api/projects/${encodeURIComponent(id)}/unpin`),
    { method: 'POST' },
  );
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

export async function createProjectBlocker(projectId: string, input: { title: string; reason?: string }): Promise<ProjectBlocker> {
  const res = await fetchJson<{ ok: true; blocker: ProjectBlocker }>(apiUrl(`/api/projects/${encodeURIComponent(projectId)}/blockers`), {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.blocker;
}

export async function fetchProjectFiles(projectId: string, path?: string): Promise<ProjectFilesResponse> {
  const params = new URLSearchParams();
  if (path) params.set('path', path);
  const suffix = params.toString();
  return fetchJson<ProjectFilesResponse>(
    apiUrl(`/api/projects/${encodeURIComponent(projectId)}/files${suffix ? `?${suffix}` : ''}`),
  );
}

export async function searchProjectFiles(projectId: string, query: string, limit = 50): Promise<ProjectFileSearchEntry[]> {
  const params = new URLSearchParams({ q: query.trim(), limit: String(limit) });
  const res = await fetchJson<{ ok: true; entries: ProjectFileSearchEntry[] }>(
    apiUrl(`/api/projects/${encodeURIComponent(projectId)}/files/search?${params.toString()}`),
  );
  return res.entries;
}

export async function createProjectSession(projectId: string, agentId?: string): Promise<ProjectSession> {
  const res = await fetchJson<{ session: ProjectSession }>(apiUrl('/api/sessions'), {
    method: 'POST',
    body: JSON.stringify({ projectId, ...(agentId ? { agentId } : {}) }),
  });
  return res.session;
}
