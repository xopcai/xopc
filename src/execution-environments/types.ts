export const EXECUTION_ENVIRONMENT_KINDS = ['local_checkout', 'managed_worktree'] as const;
export type ExecutionEnvironmentKind = (typeof EXECUTION_ENVIRONMENT_KINDS)[number];

export const EXECUTION_ENVIRONMENT_STATUSES = [
  'requested',
  'provisioning',
  'ready',
  'degraded',
  'deleting',
  'deleted',
  'error',
] as const;
export type ExecutionEnvironmentStatus = (typeof EXECUTION_ENVIRONMENT_STATUSES)[number];

export interface ExecutionEnvironment {
  id: string;
  projectId?: string;
  kind: ExecutionEnvironmentKind;
  status: ExecutionEnvironmentStatus;
  rootPath: string;
  repositoryRoot?: string;
  gitCommonDir?: string;
  baseRef?: string;
  baseSha?: string;
  branchRef?: string;
  version: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
  deletedAt?: number;
}

export interface ExecutionEnvironmentBinding {
  id: string;
  sessionKey: string;
  environmentId: string;
  createdAt: number;
  releasedAt?: number;
}

export interface ExecutionEnvironmentEvent {
  id: string;
  environmentId: string;
  fromStatus?: ExecutionEnvironmentStatus;
  toStatus: ExecutionEnvironmentStatus;
  reason: string;
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface CreateExecutionEnvironmentInput {
  id?: string;
  projectId?: string;
  kind: ExecutionEnvironmentKind;
  rootPath: string;
  repositoryRoot?: string;
  gitCommonDir?: string;
  baseRef?: string;
  baseSha?: string;
  branchRef?: string;
}

export interface ExecutionEnvironmentListQuery {
  projectId?: string;
  status?: ExecutionEnvironmentStatus;
  includeDeleted?: boolean;
  limit?: number;
}

export interface BindExecutionEnvironmentInput {
  sessionKey: string;
  environmentId: string;
}

export interface TransitionExecutionEnvironmentInput {
  environmentId: string;
  toStatus: ExecutionEnvironmentStatus;
  expectedVersion: number;
  reason: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export class ExecutionEnvironmentConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExecutionEnvironmentConflictError';
  }
}

export class ExecutionEnvironmentNotFoundError extends Error {
  constructor(environmentId: string) {
    super(`Execution environment not found: ${environmentId}`);
    this.name = 'ExecutionEnvironmentNotFoundError';
  }
}

const STATUS_TRANSITIONS: Record<ExecutionEnvironmentStatus, readonly ExecutionEnvironmentStatus[]> = {
  requested: ['provisioning', 'deleting', 'error'],
  provisioning: ['ready', 'degraded', 'deleting', 'error'],
  ready: ['degraded', 'deleting', 'error'],
  degraded: ['provisioning', 'deleting', 'error'],
  deleting: ['deleted', 'error'],
  deleted: [],
  error: ['provisioning', 'deleting'],
};

export function canTransitionExecutionEnvironment(
  fromStatus: ExecutionEnvironmentStatus,
  toStatus: ExecutionEnvironmentStatus,
): boolean {
  return STATUS_TRANSITIONS[fromStatus].includes(toStatus);
}
