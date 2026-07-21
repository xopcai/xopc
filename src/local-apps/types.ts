export type LocalAppStatus = 'preview_ready' | 'installed' | 'degraded';
export type LocalAppInstallationState = 'not_installed' | 'installed';
export type LocalAppReleaseHealth = 'healthy' | 'failed';

export interface LocalAppRelease {
  id: string;
  appId: string;
  version: number;
  sourceHash: string;
  healthStatus: LocalAppReleaseHealth;
  createdAt: number;
  activatedAt?: number;
  isActive: boolean;
}

export interface LocalApp {
  id: string;
  extensionId: string;
  projectId: string;
  name: string;
  description?: string;
  idea: string;
  status: LocalAppStatus;
  workspaceRoot: string;
  draftVersion: number;
  activeVersion?: number;
  activeReleaseId?: string;
  installationState: LocalAppInstallationState;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  installedAt?: number;
}

export interface LocalAppDetail extends LocalApp {
  previewUrl: string;
  permissions: string[];
  releases: LocalAppRelease[];
  acceptanceRuns: LocalAppAcceptanceRun[];
}

export interface LocalAppUiGrant {
  granted: boolean;
  extensionId: string;
  appId?: string;
  manifestDigest?: string;
  permissions: string[];
  grantedAt?: number;
}

export interface LocalAppAcceptanceCheck {
  id: 'document' | 'content' | 'interaction' | 'criteria';
  status: 'passed' | 'failed' | 'skipped';
  message: string;
}

export interface LocalAppAcceptanceRun {
  id: string;
  appId: string;
  sourceHash: string;
  status: 'passed' | 'failed';
  checks: LocalAppAcceptanceCheck[];
  interactiveCount: number;
  createdAt: number;
}

export interface RecordLocalAppAcceptanceInput {
  sourceHash: string;
  status: 'passed' | 'failed';
  checks: LocalAppAcceptanceCheck[];
  interactiveCount: number;
}

export interface LocalAppValidationIssue {
  code: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface LocalAppChangedFile {
  path: string;
  status: 'added' | 'modified' | 'deleted';
}

export interface LocalAppAcceptanceScenarioSummary {
  id: string;
  name: string;
  stepCount: number;
}

export interface LocalAppValidationResult {
  status: 'healthy' | 'failed';
  checkedAt: number;
  sourceHash?: string;
  hasDraftChanges: boolean;
  changedFiles: LocalAppChangedFile[];
  changedFileCount: number;
  permissions: string[];
  permissionDelta: { added: string[]; removed: string[] };
  acceptanceScenarioCount: number;
  acceptanceScenarios: LocalAppAcceptanceScenarioSummary[];
  issues: LocalAppValidationIssue[];
}

export interface CreateLocalAppInput {
  name: string;
  idea: string;
  description?: string;
}

export interface LocalAppPreviewTarget {
  app: LocalApp;
  previewToken: string;
  uiRoot: string;
}
