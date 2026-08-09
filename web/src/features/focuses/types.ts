export type FocusStatus = 'active' | 'paused' | 'completed';
export type FocusMonitorKind = 'progress' | 'external_changes';
export type FocusMonitorRunState = 'idle' | 'queued' | 'running' | 'failed';

export type FocusEvidence = {
  label: string;
  source?: string;
  publishedAt?: string;
};

export type FocusMonitor = {
  id: string;
  focusId: string;
  kind: FocusMonitorKind;
  enabled: boolean;
  runState: FocusMonitorRunState;
  cadence: { kind: 'interval'; everyMs: number };
  lastRunAt?: number;
  nextRunAt?: number;
  lastMeaningfulResultAt?: number;
  lastError?: string;
  consecutiveFailures: number;
};

export type FocusInsight = {
  id: string;
  focusId: string;
  monitorId: string;
  kind: FocusMonitorKind;
  title: string;
  summary: string;
  whyItMatters: string;
  nextAction: string;
  evidence: FocusEvidence[];
  status: 'unread' | 'dismissed' | 'approved';
  createdAt: number;
  updatedAt: number;
};

export type Focus = {
  id: string;
  title: string;
  summary: string;
  status: FocusStatus;
  source: 'user' | 'discovery';
  projectIds: string[];
  goalId?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  lastActivityAt?: number;
  monitors: FocusMonitor[];
  latestInsight?: FocusInsight;
};

export type FocusActivity = {
  id: string;
  focusId: string;
  monitorId?: string;
  type: string;
  summary: string;
  details: Record<string, unknown>;
  createdAt: number;
};

export type FocusCandidate = {
  id: string;
  title: string;
  summary: string;
  confidence: number;
  evidence: FocusEvidence[];
  projectIds: string[];
  status: 'pending' | 'accepted' | 'dismissed';
  discoveredAt: number;
};
