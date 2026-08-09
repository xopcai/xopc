export type FocusStatus = 'active' | 'paused' | 'completed';
export type FocusSource = 'user' | 'discovery';
export type FocusCandidateStatus = 'pending' | 'accepted' | 'dismissed';
export type FocusMonitorKind = 'progress' | 'external_changes';
export type FocusMonitorRunState = 'idle' | 'queued' | 'running' | 'failed';
export type FocusInsightStatus = 'unread' | 'dismissed' | 'approved';

export type FocusActivityType =
  | 'created'
  | 'updated'
  | 'paused'
  | 'resumed'
  | 'completed'
  | 'monitor_enabled'
  | 'monitor_disabled'
  | 'run_started'
  | 'run_no_change'
  | 'run_failed'
  | 'insight_created'
  | 'insight_dismissed'
  | 'insight_approved';

export interface FocusEvidence {
  label: string;
  source?: string;
  publishedAt?: string;
}

export interface FocusCandidate {
  id: string;
  canonicalKey: string;
  title: string;
  summary: string;
  confidence: number;
  evidence: FocusEvidence[];
  projectIds: string[];
  status: FocusCandidateStatus;
  discoveredAt: number;
  updatedAt: number;
}

export interface Focus {
  id: string;
  title: string;
  summary: string;
  status: FocusStatus;
  source: FocusSource;
  sourceCandidateId?: string;
  projectIds: string[];
  goalId?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  lastActivityAt?: number;
}

export interface FocusCadence {
  kind: 'interval';
  everyMs: number;
}

export interface FocusMonitor {
  id: string;
  focusId: string;
  kind: FocusMonitorKind;
  enabled: boolean;
  runState: FocusMonitorRunState;
  cadence: FocusCadence;
  automationId?: string;
  lastRunId?: string;
  lastRunAt?: number;
  nextRunAt?: number;
  lastMeaningfulResultAt?: number;
  lastError?: string;
  consecutiveFailures: number;
  createdAt: number;
  updatedAt: number;
}

export interface FocusActivity {
  id: string;
  focusId: string;
  monitorId?: string;
  type: FocusActivityType;
  summary: string;
  details: Record<string, unknown>;
  createdAt: number;
}

export interface FocusInsight {
  id: string;
  focusId: string;
  monitorId: string;
  runId: string;
  kind: FocusMonitorKind;
  title: string;
  summary: string;
  whyItMatters: string;
  nextAction: string;
  evidence: FocusEvidence[];
  status: FocusInsightStatus;
  valueScore: number;
  valueReasons: string[];
  createdAt: number;
  updatedAt: number;
}

export interface FocusDetail extends Focus {
  monitors: FocusMonitor[];
  latestInsight?: FocusInsight;
}
