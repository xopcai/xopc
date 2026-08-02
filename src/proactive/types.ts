import type { WorkUnderstandingThread } from '../work-discovery/types.js';

export type FocusWatchKind = 'progress' | 'staleness' | 'deadline' | 'intelligence';
export type FocusWatchStatus = 'active' | 'paused';

export interface FocusWatch {
  id: string;
  threadId: string;
  goalId?: string;
  automationId: string;
  kind: FocusWatchKind;
  status: FocusWatchStatus;
  config: Record<string, unknown>;
  trialEndsAt?: number;
  lastCursor?: string;
  lastRunAt?: number;
  lastUsefulResultAt?: number;
  consecutiveEmptyRuns: number;
  createdAt: number;
  updatedAt: number;
}

export interface FocusView {
  id: string;
  title: string;
  summary: string;
  status: WorkUnderstandingThread['status'];
  horizon: WorkUnderstandingThread['horizon'];
  confidence: number;
  focusScore: number;
  userStatus: WorkUnderstandingThread['userStatus'];
  projectIds: string[];
  goalId?: string;
  nextAction?: string;
  blockedReason?: string;
  watches: FocusWatch[];
  lastObservedAt: number;
}

export type ProactiveInsightStatus = 'unread' | 'read' | 'approved' | 'dismissed';

export interface ProactiveEvidence {
  label: string;
  source?: string;
  publishedAt?: string;
}

export interface ProactiveInsight {
  id: string;
  watchId: string;
  runId: string;
  kind: FocusWatchKind;
  title: string;
  summary: string;
  whyItMatters: string;
  nextAction: string;
  evidence: ProactiveEvidence[];
  status: ProactiveInsightStatus;
  createdAt: number;
  updatedAt: number;
}

export interface FocusCalendarSignal {
  id: string;
  focusId: string;
  focusTitle: string;
  title: string;
  startsAt: number;
  endsAt?: number;
  sourceInstanceId: string;
}
