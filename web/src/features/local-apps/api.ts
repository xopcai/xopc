import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import type {
  LocalAppAcceptanceCheck,
  LocalAppAcceptanceResult,
} from '@/features/local-apps/runtime-health';

export type LocalAppStatus = 'preview_ready' | 'installed' | 'degraded';
export type LocalAppInstallationState = 'not_installed' | 'installed';

export type LocalAppRelease = {
  id: string;
  appId: string;
  version: number;
  sourceHash: string;
  healthStatus: 'healthy' | 'failed';
  createdAt: number;
  activatedAt?: number;
  isActive: boolean;
};

export type LocalAppAcceptanceRun = {
  id: string;
  appId: string;
  sourceHash: string;
  status: 'passed' | 'failed';
  checks: LocalAppAcceptanceCheck[];
  interactiveCount: number;
  createdAt: number;
};

export type LocalApp = {
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
};

export type LocalAppDetail = LocalApp & {
  previewUrl: string;
  permissions: string[];
  releases: LocalAppRelease[];
  acceptanceRuns: LocalAppAcceptanceRun[];
};

export type LocalAppValidationResult = {
  status: 'healthy' | 'failed';
  checkedAt: number;
  sourceHash?: string;
  hasDraftChanges: boolean;
  changedFiles: Array<{ path: string; status: 'added' | 'modified' | 'deleted' }>;
  changedFileCount: number;
  permissions: string[];
  permissionDelta: { added: string[]; removed: string[] };
  acceptanceScenarioCount: number;
  acceptanceScenarios: Array<{ id: string; name: string; stepCount: number }>;
  issues: Array<{ code: string; severity: 'error' | 'warning'; message: string }>;
};

export async function listLocalApps(): Promise<LocalApp[]> {
  return (await fetchJson<{ apps: LocalApp[] }>(apiUrl('/api/local-apps'))).apps;
}

export async function getLocalApp(id: string): Promise<LocalAppDetail> {
  return (await fetchJson<{ app: LocalAppDetail }>(apiUrl(`/api/local-apps/${encodeURIComponent(id)}`))).app;
}

export async function validateLocalApp(id: string): Promise<LocalAppValidationResult> {
  return (await fetchJson<{ validation: LocalAppValidationResult }>(
    apiUrl(`/api/local-apps/${encodeURIComponent(id)}/validate`),
    { method: 'POST' },
  )).validation;
}

export async function recordLocalAppAcceptance(
  id: string,
  sourceHash: string,
  result: LocalAppAcceptanceResult,
): Promise<LocalAppAcceptanceRun> {
  return (await fetchJson<{ acceptance: LocalAppAcceptanceRun }>(
    apiUrl(`/api/local-apps/${encodeURIComponent(id)}/acceptance-runs`),
    {
      method: 'POST',
      body: JSON.stringify({ sourceHash, ...result }),
    },
  )).acceptance;
}

export async function createLocalApp(input: { name: string; idea: string; description?: string }): Promise<LocalAppDetail> {
  return (await fetchJson<{ app: LocalAppDetail }>(apiUrl('/api/local-apps'), {
    method: 'POST',
    body: JSON.stringify(input),
  })).app;
}

export async function installLocalApp(id: string): Promise<LocalAppDetail> {
  return (await fetchJson<{ app: LocalAppDetail }>(apiUrl(`/api/local-apps/${encodeURIComponent(id)}/install`), {
    method: 'POST',
  })).app;
}

export async function rollbackLocalApp(id: string, releaseId: string): Promise<LocalAppDetail> {
  return (await fetchJson<{ app: LocalAppDetail }>(
    apiUrl(`/api/local-apps/${encodeURIComponent(id)}/releases/${encodeURIComponent(releaseId)}/rollback`),
    { method: 'POST' },
  )).app;
}

export async function setLocalAppEnabled(id: string, enabled: boolean): Promise<LocalAppDetail> {
  return (await fetchJson<{ app: LocalAppDetail }>(
    apiUrl(`/api/local-apps/${encodeURIComponent(id)}/${enabled ? 'enable' : 'disable'}`),
    { method: 'POST' },
  )).app;
}

export async function uninstallLocalApp(id: string): Promise<LocalAppDetail> {
  return (await fetchJson<{ app: LocalAppDetail }>(
    apiUrl(`/api/local-apps/${encodeURIComponent(id)}/install`),
    { method: 'DELETE' },
  )).app;
}
