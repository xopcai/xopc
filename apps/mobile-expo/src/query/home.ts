import { apiFetch } from '../api/client';
import type { SessionListItem } from './sessions';
import type { NoteIndexEntry } from './notes';

export type HomeAgent = {
  id: string;
  name?: string;
  description?: string;
};

export type HomeGateway = {
  status: string;
  ready: boolean;
  httpListening: boolean;
  version: string;
  uptime: number;
  tunnel: {
    state: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';
    publicUrl: string | null;
    connected: boolean;
  };
};

export type HomeWorkflowRun = {
  id: string;
  definitionId: string;
  title: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timeout';
  sessionKey?: string;
  createdAtMs: number;
  startedAtMs?: number;
  completedAtMs?: number;
  metrics: {
    agentCount: number;
    doneAgentCount: number;
    errorAgentCount: number;
    skippedAgentCount: number;
    artifactCount: number;
    durationMs?: number;
  };
};

export type HomeCronJob = {
  id: string;
  name?: string;
  schedule: string;
  nextRunAt: string;
  payloadKind: string;
};

export type HomeCronRun = {
  id: string;
  jobId: string;
  jobName?: string;
  status: 'running' | 'success' | 'failed' | 'cancelled' | 'skipped';
  startedAt: string;
  endedAt?: string;
  error?: string;
  summary?: string;
  sessionKey?: string;
  workflowRunId?: string;
};

export interface HomeData {
  recentlyOpened: NoteIndexEntry[];
  inboxCount: number;
  pendingTasks: NoteIndexEntry[];
  pendingTaskCount: number;
  recentSessions: SessionListItem[];
  activeAgent: HomeAgent;
  gateway: HomeGateway;
  workflowRuns: {
    active: HomeWorkflowRun[];
    attention: HomeWorkflowRun[];
    recent: HomeWorkflowRun[];
  };
  nextCronJobs: HomeCronJob[];
  recentCronRuns: HomeCronRun[];
}

function normalizedSessionName(session: SessionListItem): string | undefined {
  return session.name?.trim() || session.title?.trim() || session.displayName?.trim() || undefined;
}

export async function fetchHome(): Promise<HomeData> {
  const res = await apiFetch('/api/home');
  if (!res.ok) throw new Error(`Failed to fetch home: ${res.status}`);
  const home = (await res.json()) as HomeData;
  return {
    ...home,
    recentSessions: (home.recentSessions ?? []).map((session) => ({
      ...session,
      name: normalizedSessionName(session),
    })),
  };
}
