export interface WorkflowResultEnvelope {
  title?: string;
  summary: string;
  sections?: WorkflowResultSection[];
  actions?: WorkflowNextAction[];
  artifacts?: WorkflowArtifactRef[];
  followUps?: WorkflowFollowUp[];
  /** Machine-readable workflow output. It is intentionally not rendered as user-facing content. */
  data?: unknown;
}

export interface WorkflowFollowUp {
  id: string;
  title: string;
  prompt?: string;
  priority?: 'low' | 'medium' | 'high';
}

export type WorkflowResultSection =
  | WorkflowTextSection
  | WorkflowFindingsSection
  | WorkflowRisksSection
  | WorkflowQuestionsSection;

export interface WorkflowTextSection {
  kind: 'text';
  title: string;
  content: string;
}

export interface WorkflowFindingsSection {
  kind: 'findings';
  title: string;
  items: WorkflowFinding[];
}

export interface WorkflowRisksSection {
  kind: 'risks';
  title: string;
  items: WorkflowRisk[];
}

export interface WorkflowQuestionsSection {
  kind: 'questions';
  title: string;
  items: string[];
}

export interface WorkflowFinding {
  title: string;
  severity?: WorkflowSeverity;
  file?: string;
  line?: number;
  detail?: string;
  recommendation?: string;
}

export interface WorkflowRisk {
  title: string;
  severity?: WorkflowSeverity;
  likelihood?: 'low' | 'medium' | 'high';
  impact?: string;
  mitigation?: string;
}

export interface WorkflowNextAction {
  id: string;
  label: string;
  kind: 'open_artifact' | 'copy_result' | 'start_followup' | 'custom';
  payload?: unknown;
}

export interface WorkflowArtifactRef {
  id: string;
  runId: string;
  name: string;
  title?: string;
  mimeType: string;
  sizeBytes: number;
  createdAtMs: number;
}

export type WorkflowSeverity = 'low' | 'medium' | 'high' | 'critical';
