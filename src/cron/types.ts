// Cron types and interfaces

export interface JobData {
  id: string;
  name?: string;
  schedule: string;
  message: string;
  enabled: boolean;
  timezone?: string;
  maxRetries: number;
  timeout: number;
  created_at: string;
  updated_at: string;
}

export interface JobExecution {
  id: string;
  jobId: string;
  status: 'running' | 'success' | 'failed' | 'cancelled';
  startedAt: string;
  endedAt?: string;
  duration?: number; // milliseconds
  error?: string;
  output?: string;
  retryCount: number;
}

export interface JobExecutor {
  execute(job: JobData, signal: AbortSignal): Promise<void>;
}

export interface CronMetrics {
  totalJobs: number;
  runningJobs: number;
  enabledJobs: number;
  failedLastHour: number;
  avgExecutionTime: number;
  nextScheduledJob?: {
    id: string;
    name?: string;
    runAt: Date;
  };
}

export interface CronHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  issues: string[];
  lastError?: string;
}

export interface AddJobOptions {
  name?: string;
  timezone?: string;
  maxRetries?: number;
  timeout?: number;
}

export interface JobWithNextRun extends Omit<JobData, 'created_at' | 'updated_at'> {
  next_run?: string;
}

export interface JobHistoryQuery {
  jobId: string;
  limit?: number;
  before?: Date;
}
