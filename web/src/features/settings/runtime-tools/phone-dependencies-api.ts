import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { streamManagedToolOperation } from './runtime-tools-api';

export type PhoneDependencyKind = 'adb' | 'scrcpy' | 'hdc' | 'hoscrcpy' | 'java';
export type PhoneDependencyStatus = {
  kind: PhoneDependencyKind; state: 'ready' | 'absent' | 'corrupted' | 'unsupported' | 'installing';
  version?: string; requestedVersion: string; path?: string; source?: 'managed' | 'system' | 'custom'; canInstall: boolean; error?: string; distribution?: string; downloadUrl?: string;
};
export type PhoneDependencyProgress = { kind: PhoneDependencyKind; phase: string; downloadedBytes?: number; totalBytes?: number };
export const phoneDependenciesKey = () => apiUrl('/api/runtime-tools/phone-dependencies');
export async function loadPhoneDependencies() {
  return (await fetchJson<{ payload: { location: 'gateway'; installationEnabled: boolean; statuses: PhoneDependencyStatus[] } }>(phoneDependenciesKey())).payload;
}
export async function selectExistingPhoneAdb(path: string) {
  await fetchJson(apiUrl('/api/runtime-tools/phone-dependencies/adb/path'), { method: 'POST', body: JSON.stringify({ path }) });
}
export async function installPhoneDependency(kind: PhoneDependencyKind, action: 'install' | 'repair' | 'import', onProgress: (event: PhoneDependencyProgress) => void, path?: string) {
  return streamManagedToolOperation<PhoneDependencyProgress>({ path: `/api/runtime-tools/phone-dependencies/${kind}/${action}/stream`, body: path ? { path } : {}, onProgress });
}
