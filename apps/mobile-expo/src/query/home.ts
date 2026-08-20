import {
  parseHomeResponse,
  type TaskRunReceipt,
  type HomeResponse,
} from '@xopcai/gateway-contract';

import { apiFetch } from '../api/client';
import type { Language } from '../stores/preferences-store';
import type { NoteIndexEntry } from './notes';
import type { SessionListItem } from './sessions';

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

export type HomeAutomation = {
  id: string;
  name?: string;
  trigger: string;
  action: string;
  nextRunAt: string;
};

export type HomeDecision = {
  id: string;
  kind: 'agent_judgment' | 'task' | 'connector_approval';
  title: string;
  detail?: string;
  reason: 'needs_input' | 'blocked' | 'user_input' | 'user_approval' | 'dependency' | 'external' | 'scheduled' | 'retry' | 'paused' | 'overdue' | 'due_soon' | 'decision_needed' | 'approval_required';
  urgency: 'now' | 'soon';
  href: string;
  projectId?: string;
  projectName?: string;
  updatedAt: number;
  judgment?: {
    inboxItemId: string;
    whyNow: string;
    impact: string;
    workDone: string;
    recommendation: string;
    confidence: number;
    decision?: { question: string; options: Array<{ id: string; label: string; consequence: string }> };
  };
  response?: { kind: 'connector_approval'; approvalId: string };
};

export type HomeAttention = {
  id: string;
  kind: 'automation_run' | 'workflow_run';
  runId: string;
  title: string;
  detail: string;
  reason: 'run_failed' | 'run_timeout';
  href: string;
  updatedAt: number;
  sessionKey?: string;
};

export type HomeBriefing = {
  generatedAt: number;
  summary: string;
  focus: HomeDecision[];
  progress: {
    activeWorkflowCount: number;
    activeTaskCount: number;
    movingCount: number;
  };
  wins: Array<{
    id: string;
    kind: 'task' | 'workflow_run' | 'automation_run';
    title: string;
    href: string;
    completedAt: number;
  }>;
  nextScheduled?: HomeAutomation;
};

export interface HomeData {
  briefing: HomeBriefing;
  decisions: HomeDecision[];
  attention: HomeAttention[];
  recentlyOpened: NoteIndexEntry[];
  inboxCount: number;
  pendingTasks: NoteIndexEntry[];
  pendingTaskCount: number;
  recentSessions: SessionListItem[];
  activeAgent: HomeAgent;
  gateway: HomeGateway;
  workflowRuns: {
    active: HomeWorkflowRun[];
    recent: HomeWorkflowRun[];
  };
  upcomingAutomations: HomeAutomation[];
  recentTasks: TaskRunReceipt[];
  tasks: HomeResponse['tasks'];
}

function normalizedSessionName(session: SessionListItem): string | undefined {
  return session.name?.trim() || session.title?.trim() || session.displayName?.trim() || undefined;
}

export async function fetchHome(language: Language): Promise<HomeData> {
  const res = await apiFetch(`/api/home?locale=${encodeURIComponent(language)}`);
  if (!res.ok) throw new Error(`Failed to fetch home: ${res.status}`);
  const raw = await res.json() as unknown;
  const core = parseHomeResponse(raw);
  const home = raw as HomeData;
  return {
    ...home,
    tasks: core.tasks,
    recentTasks: core.recentTasks,
    recentSessions: home.recentSessions.map((session) => ({
      ...session,
      name: normalizedSessionName(session),
    })),
  };
}

export async function respondToHomeDecision(
  response: NonNullable<HomeDecision['response']>,
  decision: 'approve' | 'deny',
): Promise<{ ok: true; status: string }> {
  const res = await apiFetch('/api/home/decisions/respond', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...response, decision }),
  });
  if (!res.ok) throw new Error(`Failed to respond to decision: ${res.status}`);
  return res.json() as Promise<{ ok: true; status: string }>;
}

export async function acknowledgeHomeAttention(
  item: Pick<HomeAttention, 'kind' | 'runId'>,
): Promise<{ ok: true; status: 'acknowledged' }> {
  const res = await apiFetch('/api/home/attention/acknowledge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });
  if (!res.ok) throw new Error(`Failed to acknowledge attention item: ${res.status}`);
  return res.json() as Promise<{ ok: true; status: 'acknowledged' }>;
}

export async function retryHomeAttention(
  item: Pick<HomeAttention, 'kind' | 'runId'>,
): Promise<{ ok: true; runId: string; sessionKey?: string }> {
  const res = await apiFetch('/api/home/attention/retry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });
  if (!res.ok) throw new Error(`Failed to retry attention item: ${res.status}`);
  return res.json() as Promise<{ ok: true; runId: string; sessionKey?: string }>;
}
