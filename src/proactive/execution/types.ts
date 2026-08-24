export interface ContextSnapshot {
  id: string;
  batchId: string;
  content: Record<string, unknown>;
  evidenceIds: string[];
  createdAt: string;
}

export interface InsightCandidate {
  title: string;
  summary: string;
  whyNow: string;
  impact: string;
  recommendation: string;
  workDone: string;
  decision?: {
    question: string;
    options: Array<{ id: string; label: string; consequence: string }>;
  };
  proposedAction?: {
    id: 'create_project_task';
    risk: 'low';
    rationale: string;
    input: { title: string; objective: string };
  };
  urgency: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  evidenceIds: string[];
}

export interface ProactiveInsight extends InsightCandidate {
  id: string;
  runId: string;
  subscriptionId: string;
  scenarioKey: string;
  valueScore: number;
  disposition?: 'record_silently' | 'show_in_work' | 'request_approval' | 'auto_execute';
  dispositionReason?: string;
  actionStatus?: 'not_authorized' | 'approval_required' | 'pending' | 'executing' | 'completed' | 'rejected' | 'failed';
  actionResult?: Record<string, unknown>;
  actionError?: string;
  createdAt: string;
}

export interface ProactiveAgentExecutor {
  execute(input: {
    systemPrompt: string;
    userPrompt: string;
    authorizedContext: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<{ text: string; modelRef?: string }>;
}

export interface ContextProvider {
  id: string;
  supports(scenarioKey: string): boolean;
  collect(input: {
    scenarioKey: string;
    batchId: string;
    eventIds: string[];
    subscriptionId: string;
  }): Promise<ResolvedContext>;
}

export interface ResolvedContext {
  content: Record<string, unknown>;
  snapshotContent?: Record<string, unknown>;
  evidenceIds: string[];
}
