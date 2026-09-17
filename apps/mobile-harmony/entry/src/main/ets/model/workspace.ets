export type XopcSection = 'tasks' | 'projects' | 'automations' | 'notes';
export interface XopcWorkspaceItem {
  id: string; title: string; body: string; status: string; version: number;
  projectId?: string; cron?: string; enabled?: boolean; editable: boolean; actions: string[]; automation?: XopcAutomation;
}
export interface XopcTask {
  id: string; title: string; body?: string; phase: string; version: number; projectId?: string; priority: string;
  closedAt?: number; updatedAt?: number; resolution?: string;
}
export interface XopcTaskResult { task: XopcTask; allowedCommands?: string[]; }
export interface XopcTaskList { items: XopcTaskResult[]; }
export interface XopcTaskContract {
  objective: string; expectedOutputs: string[]; acceptanceCriteria: string[]; constraints: string[];
  approvalRequired: string[]; assumptions: string[]; risks: string[]; acceptancePolicy: string; outputDestinations: Object[];
}
export interface XopcTaskActivation { mode: string; phase: string; }
export interface XopcTaskCreate {
  idempotencyKey: string; title: string; body: string; projectId?: string; contract: XopcTaskContract; activation: XopcTaskActivation;
}
export interface XopcTaskPatch { expectedVersion: number; title: string; body: string; projectId?: string; }
export interface XopcTaskCommand { type: string; phase?: string; resolution?: string; executor?: XopcExecutor; }
export interface XopcExecutor { kind: string; agentId: string; }
export interface XopcTaskCommandBody { idempotencyKey: string; expectedVersion: number; command: XopcTaskCommand; }
export interface XopcProject { id: string; name: string; description?: string; status: string; brief?: string; outcome?: string; }
export interface XopcProjectList { items: XopcProject[]; }
export interface XopcProjectResult { project: XopcProject; }
export interface XopcProjectWrite { name?: string; description?: string; status?: string; }
export interface XopcSchedule { kind: string; expr?: string; }
export interface XopcTrigger { kind: string; schedule?: XopcSchedule; }
export interface XopcAutomationAction { kind: string; instruction?: string; }
export interface XopcAutomation {
  id: string; name: string; enabled: boolean; trigger: XopcTrigger; action: XopcAutomationAction;
}
export interface XopcAutomationWrite { name: string; trigger: XopcTrigger; action: XopcAutomationAction; enabled?: boolean; conversationMode?: string; notificationPolicy?: string; }
export interface XopcAutomationList { automations: XopcAutomation[]; }
export interface XopcAutomationResult { automation: XopcAutomation; }
export interface XopcAutomationRun { id: string; status: string; startedAt?: number; error?: string; }
export interface XopcAutomationRuns { runs: XopcAutomationRun[]; }
export interface XopcNote { id: string; title?: string; markdown?: string; snippet?: string; status: string; remoteVersion?: number; updatedAt?: number; }
export interface XopcNoteList { items: XopcNote[]; hasMore?: boolean; }
export interface XopcNoteResult { note: XopcNote; }
export interface XopcNoteWrite { title?: string; markdown: string; kind?: string; channel?: string; platform?: string; }
export interface XopcWorkspacePage { items: XopcWorkspaceItem[]; hasMore: boolean; }
