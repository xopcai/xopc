export type ImportSource = 'codex' | 'claude-code';
export type ImportScope = 'user' | 'project';
export type Compatibility = 'compatible' | 'needs_setup' | 'blocked' | 'unsupported';
export interface ImportFile { path: string; data: string; executable: boolean }
export interface ImportCandidate {
  id: string;
  source: ImportSource;
  kind: 'skill' | 'mcp' | 'rule';
  name: string;
  description: string;
  scope: ImportScope;
  location: string;
  hash: string;
  compatibility: Compatibility;
  findings: string[];
  files: ImportFile[];
  content?: string;
  mcp?: Record<string, unknown>;
  requiredEnv: string[];
  shared: boolean;
  connected?: boolean;
}
export interface ImportScan {
  id: string;
  createdAt: number;
  source: ImportSource;
  candidates: ImportCandidate[];
  diagnostics: string[];
  projectRoots?: string[];
}
export interface ImportTarget { projectId?: string; root: string }
export interface ImportAction {
  candidateId: string;
  operation: 'skip' | 'create' | 'rename' | 'replace';
  name: string;
  beforeHash: string | null;
}
export interface ImportPlan {
  id: string;
  scanId: string;
  createdAt: number;
  expiresAt: number;
  target: ImportTarget;
  targetRevision: string;
  actions: ImportAction[];
}
export interface ImportJobItem {
  action: ImportAction;
  status: 'staged' | 'skipped' | 'publishing' | 'active' | 'rolling_back' | 'rolled_back' | 'failed';
  error?: string;
  afterHash?: string;
  backupPath?: string;
}
export interface ImportJob {
  id: string;
  plan: ImportPlan;
  createdAt: number;
  expiresAt: number;
  items: ImportJobItem[];
}
export class ImportError extends Error {
  constructor(readonly code: string, message: string, readonly status: 400 | 403 | 404 | 409 | 413 = 400) {
    super(message);
    this.name = 'ImportError';
  }
}

export type InventoryStatus = 'ready' | 'existing' | 'conflict' | 'blocked';
export interface InventoryItem {
  id: string;
  kind: 'skill' | 'context' | 'project';
  parentId?: string;
  name: string;
  description: string;
  displayPath: string;
  scope: ImportScope;
  status: InventoryStatus;
  reason?: string;
  suggested: boolean;
  targetName?: string;
}
export interface ImportInventory {
  id: string;
  source: ImportSource;
  createdAt: number;
  expiresAt: number;
  candidates: InventoryItem[];
  notices: string[];
  complete: boolean;
}
export interface StoredInventoryItem extends InventoryItem {
  location: string;
  scanId?: string;
  candidate?: ImportCandidate;
  targetRoot?: string;
  projectId?: string;
}
export interface StoredInventory extends Omit<ImportInventory, 'candidates'> {
  candidates: StoredInventoryItem[];
  scanIds: string[];
}
export interface ImportSelection {
  inventoryId: string;
  candidateIds: string[];
  requestId: string;
  retryOf?: string;
}
export interface ImportRunItem {
  candidateId: string;
  kind: InventoryItem['kind'];
  name: string;
  status: 'pending' | 'imported' | 'existing' | 'failed';
  targetId?: string;
  jobId?: string;
  error?: string;
}
export interface ProductImportResult {
  id: string;
  source: ImportSource;
  createdAt: number;
  inventoryId: string;
  selectionHash: string;
  status: 'running' | 'completed' | 'partial';
  items: ImportRunItem[];
  skills: number;
  context: number;
  projects: number;
  skipped: number;
  issues: Array<{ name: string; reason: string }>;
}
export interface DetectedImportSource {
  id: ImportSource;
  name: string;
  detected: boolean;
  lastImport?: ProductImportResult;
}
