import type { PaginatedResult } from '../session/types.js';

export type ProjectStatus = 'planned' | 'active' | 'paused' | 'completed' | 'cancelled' | 'archived';
export type ProjectHealth = 'unknown' | 'on_track' | 'at_risk' | 'off_track';
export type ProjectExecutionMode = 'local_checkout' | 'managed_worktree';

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
  executionMode: ProjectExecutionMode;
  brief?: string;
  instructions?: string;
  outcome?: string;
  successCriteria: string[];
  scope: Record<string, unknown>;
  nonGoals: string[];
  health: ProjectHealth;
  ownerId?: string;
  targetAt?: number;
  version: number;
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
  milestones: ProjectMilestone[];
  recentUpdates: ProjectUpdate[];
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
  executionMode?: ProjectExecutionMode;
  brief?: string;
  instructions?: string;
  outcome?: string;
  successCriteria?: string[];
  scope?: Record<string, unknown>;
  nonGoals?: string[];
  health?: ProjectHealth;
  ownerId?: string;
  targetAt?: number;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  defaultAgentId?: string | null;
  status?: ProjectStatus;
  workspaceRoot?: string | null;
  createWorkspaceRoot?: boolean;
  executionMode?: ProjectExecutionMode;
  brief?: string | null;
  instructions?: string | null;
  pinnedAt?: number | null;
  outcome?: string | null;
  successCriteria?: string[];
  scope?: Record<string, unknown>;
  nonGoals?: string[];
  health?: ProjectHealth;
  ownerId?: string | null;
  targetAt?: number | null;
}

export interface ProjectMilestone {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: 'planned' | 'active' | 'completed' | 'cancelled';
  targetAt?: number;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectUpdate {
  id: string;
  projectId: string;
  health: ProjectHealth;
  summary: string;
  progress: string[];
  risks: string[];
  nextSteps: string[];
  actor: Record<string, unknown>;
  createdAt: number;
}

export type ProjectListResult = PaginatedResult<Project>;
