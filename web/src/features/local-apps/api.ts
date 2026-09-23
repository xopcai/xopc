import type {
  LocalAppAcceptanceResult,
  LocalAppAcceptanceRun,
  LocalAppDetail,
  LocalAppFixGuidance,
  LocalAppFixGuidanceInput,
  LocalAppPreviewSnapshot,
  LocalAppRecord,
  LocalAppValidationResult,
} from '@xopcai/gateway-contract';

import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type {
  LocalAppAcceptanceRun,
  LocalAppDetail,
  LocalAppDiagnostic,
  LocalAppFixGuidance,
  LocalAppPreviewSnapshot,
  LocalAppValidationResult,
} from '@xopcai/gateway-contract';
export type LocalApp = LocalAppRecord;

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

export async function getLocalAppSnapshot(id: string, sourceHash: string): Promise<LocalAppPreviewSnapshot> {
  return (await fetchJson<{ snapshot: LocalAppPreviewSnapshot }>(
    apiUrl(`/api/local-apps/${encodeURIComponent(id)}/snapshots/${encodeURIComponent(sourceHash)}`),
  )).snapshot;
}

export async function getLocalAppFixGuidance(
  id: string,
  input: LocalAppFixGuidanceInput,
): Promise<LocalAppFixGuidance> {
  return (await fetchJson<{ guidance: LocalAppFixGuidance }>(
    apiUrl(`/api/local-apps/${encodeURIComponent(id)}/fix-guidance`),
    { method: 'POST', body: JSON.stringify(input) },
  )).guidance;
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
