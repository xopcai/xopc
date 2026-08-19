import type { PaginatedResult } from '../session/types.js';

export type ProjectStatus = 'active' | 'paused' | 'archived';

export interface Project {
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
  createdAt: number;
  updatedAt: number;
  lastActiveAt?: number;
  pinnedAt?: number;
}

export interface ProjectWithDetails extends Project {
  sessionCount: number;
  taskCount: number;
  activeTaskCount: number;
  recentSessions: Array<{
    key: string;
    name?: string;
    updatedAt: string;
    agentId: string;
  }>;
  recentWorkflowRuns: Array<{
    runId: string;
    definitionId: string;
    status: string;
    createdAt: number;
  }>;
}

export interface ProjectListQuery {
  status?: ProjectStatus | ProjectStatus[];
  search?: string;
  sortBy?: 'updatedAt' | 'createdAt' | 'name';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface SidebarProjectListQuery {
  status?: ProjectStatus | ProjectStatus[];
  updatedAfter?: number;
  includePinned?: boolean;
  includeSessionKey?: string;
  limit?: number;
  offset?: number;
}

export interface CreateProjectInput {
  name?: string;
  slug?: string;
  description?: string;
  defaultAgentId?: string;
  workspaceRoot?: string;
  createWorkspaceRoot?: boolean;
  projectKind?: string;
  brief?: string;
  instructions?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  defaultAgentId?: string | null;
  status?: ProjectStatus;
  workspaceRoot?: string | null;
  createWorkspaceRoot?: boolean;
  brief?: string | null;
  instructions?: string | null;
  pinnedAt?: number | null;
}

export type ProjectListResult = PaginatedResult<Project>;
