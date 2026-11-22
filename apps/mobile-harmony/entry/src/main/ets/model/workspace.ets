export type XopcSection = 'tasks' | 'projects' | 'automations';
export interface XopcWorkspaceItem {
  id: string; title: string; body: string; status: string; version: number;
  displayStatus?: string; statusReason?: string; needsAttention?: boolean;
  projectId?: string; priority?: string; dueAt?: number; resolution?: string; updatedAt?: number; brief?: string; outcome?: string;
  cron?: string; automationTimeZone?: string; enabled?: boolean; editable: boolean; actions: string[]; automation?: XopcAutomation;
  taskDetail?: XopcMobileTaskDetail;
}
export interface XopcTask {
  id: string; title: string; body?: string; phase: string; version: number; projectId?: string; priority: string;
  closedAt?: number; dueAt?: number; updatedAt?: number; resolution?: string; latestContractVersion?: number; contract?: XopcTaskContract;
}
export interface XopcTaskResult {
  task: XopcTask; allowedCommands?: string[]; operationalState?: string;
  presentation?: XopcTaskPresentation; attention?: XopcMobileTaskAttention[];
}
export interface XopcTaskList { items: XopcTaskResult[]; total?: number; }
export interface XopcTaskContract {
  objective: string; expectedOutputs: string[]; acceptanceCriteria: string[]; constraints: string[];
  approvalRequired: string[]; assumptions: string[]; risks: string[]; acceptancePolicy: string; outputDestinations: Object[];
}
export interface XopcMobileTaskAttention { kind: string; summary: string; }
export interface XopcMobileTaskReview {
  checkId?: string;
  contractVersion: number; criterionIndex: number; status: string; reviewedAt: number;
}
export interface XopcMobileTaskCheck { checkId?: string; criterion: string; status: string; evidenceTitles: string[]; }
export interface XopcMobileTaskEvidence { kind: string; title: string; strength: string; verifies?: string[]; uri?: string; }
export interface XopcMobileTaskVerification { checks: XopcMobileTaskCheck[]; }
export interface XopcMobileTaskReceipt {
  runId: string; summary: string; status: string; finalizedAt: number; evidence: XopcMobileTaskEvidence[];
  verification: XopcMobileTaskVerification; remainingWork: string[];
}
export interface XopcMobileTaskContext { id: string; role: string; targetKind: string; targetId: string; title?: string; }
export interface XopcMobileTaskSession { id: string; conversationId: string; role: string; status: string; }
export interface XopcMobileTaskDependency { id: string; title: string; phase: string; }
export interface XopcMobileTaskRun {
  id: string; contractVersion: number; version?: number; status?: string; parentRunId?: string;
  queuedAt?: number; executorKind?: string; executorRef?: XopcTaskExecutorRef;
}
export interface XopcTaskExecutorRef { agentId?: string; actorId?: string; provider?: string; config?: Object; }
export interface XopcMobileTaskWait { id: string; kind: string; status: string; reason: string; }
export interface XopcMobileTaskConversation { activeConversationId?: string; }
export interface XopcTaskChangeActor { kind: string; id?: string; }
export interface XopcTaskPhaseChange {
  id: string; fromPhase: string; toPhase: string; fromResolution?: string; toResolution?: string;
  actor: XopcTaskChangeActor; source: string; createdAt: number;
}
export interface XopcTaskAcceptanceCheck { id: string; criterion: string; }
export interface XopcTaskAcceptanceTarget { id: string; runId?: string; canSignOff: boolean; }
export interface XopcTaskPrimaryAction { type: string; resultId?: string; runId?: string; }
export interface XopcTaskPresentation { status?: string; reason?: string; primaryAction?: XopcTaskPrimaryAction; }
export interface XopcTaskCheckMutation { expectedVersion: number; contractVersion: number; resultId: string; status: string; }
export interface XopcMobileTaskDetail {
  phaseChanges?: XopcTaskPhaseChange[];
  contract?: XopcTaskContract; latestContractVersion: number; operationalState?: string; waits?: XopcMobileTaskWait[];
  attention: XopcMobileTaskAttention[]; criterionReviews: XopcMobileTaskReview[];
  acceptanceChecks?: XopcTaskAcceptanceCheck[]; acceptanceTarget?: XopcTaskAcceptanceTarget; presentation?: XopcTaskPresentation;
  receipts: XopcMobileTaskReceipt[]; context: XopcMobileTaskContext[];
  sessions: XopcMobileTaskSession[]; dependencies: XopcMobileTaskDependency[];
  dependents: XopcMobileTaskDependency[]; runs: XopcMobileTaskRun[]; activeConversationId?: string;
}
export interface XopcMobileTaskDetailResult extends XopcTaskResult {
  phaseChanges?: XopcTaskPhaseChange[];
  operationalState?: string; waits?: XopcMobileTaskWait[];
  attention: XopcMobileTaskAttention[]; criterionReviews: XopcMobileTaskReview[];
  acceptanceChecks?: XopcTaskAcceptanceCheck[]; acceptanceTarget?: XopcTaskAcceptanceTarget; presentation?: XopcTaskPresentation;
  receipts: XopcMobileTaskReceipt[]; context: XopcMobileTaskContext[];
  sessions: XopcMobileTaskSession[]; dependencies: XopcMobileTaskDependency[];
  dependents: XopcMobileTaskDependency[]; runs: XopcMobileTaskRun[];
  conversation?: XopcMobileTaskConversation;
}
export interface XopcTaskActivation { mode: string; phase: string; }
export interface XopcTaskCreate {
  idempotencyKey: string; title: string; body: string; projectId?: string; priority?: string; dueAt?: number; contract: XopcTaskContract; activation: XopcTaskActivation;
}
export interface XopcTaskPatch { expectedVersion: number; title: string; body: string; projectId: string | null; priority: string; dueAt: number | null; }
export interface XopcTaskWaitInput { kind: string; reason: string; condition: Object; }
export interface XopcTaskCommand {
  type: string; resultId?: string; phase?: string; resolution?: string; executor?: XopcExecutor;
  waitId?: string; wait?: XopcTaskWaitInput;
}
export interface XopcExecutor extends XopcTaskExecutorRef { kind: string; }
export interface XopcTaskCommandBody { source?: string; idempotencyKey: string; expectedVersion: number; command: XopcTaskCommand; }
export interface XopcProject {
  id: string; name: string; description?: string; status: string; brief?: string; outcome?: string;
  defaultAgentId?: string; workspaceRoot?: string; executionMode?: string;
}
export interface XopcProjectList { items: XopcProject[]; }
export interface XopcProjectResult { project: XopcProject; }
export interface XopcProjectWrite { name?: string; description?: string; status?: string; }
export interface XopcSchedule { kind: string; expr?: string; tz?: string; at?: string; everyMs?: number; }
export interface XopcTrigger { kind: string; schedule?: XopcSchedule; }
export interface XopcAutomationAction { kind: string; instruction?: string; }
export interface XopcAutomationState {
  nextRunAtMs?: number; runningRunId?: string; lastRunAtMs?: number; lastRunStatus?: string;
  lastError?: string; consecutiveFailures?: number;
}
export interface XopcAutomationManagement { editable: string[]; runnable: boolean; deletable: boolean; }
export interface XopcAutomation {
  id: string; name: string; description?: string; enabled: boolean; trigger: XopcTrigger; action: XopcAutomationAction;
  conversationMode?: string; state?: XopcAutomationState; projectId?: string; updatedAtMs?: number;
  management?: XopcAutomationManagement;
}
export interface XopcAutomationWrite { name: string; trigger: XopcTrigger; action: XopcAutomationAction; expectedRevision?: number; }
export interface XopcAutomationList { automations: XopcAutomation[]; }
export interface XopcAutomationResult { automation: XopcAutomation; }
export interface XopcAutomationRun {
  id: string; status: string; createdAtMs?: number; startedAtMs?: number; endedAtMs?: number; durationMs?: number;
  summary?: string; error?: string;
}
export interface XopcAutomationRunResult { run: XopcAutomationRun; }
export interface XopcAutomationRuns { runs: XopcAutomationRun[]; }
export interface XopcAutomationMetricsNext { automationId: string; name: string; runAtMs: number; }
export interface XopcAutomationMetrics {
  totalAutomations: number; enabledAutomations: number; runningRuns: number; failedLastHour: number;
  nextRun?: XopcAutomationMetricsNext;
}
export interface XopcWorkspacePage { items: XopcWorkspaceItem[]; hasMore: boolean; }
