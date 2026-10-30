import { fetchJson, apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type PhoneDevice = { id: string; platform?: 'android' | 'harmonyos'; serial: string; name: string; enabled: boolean; appAccess?: 'all' | 'selected'; textInput?: 'auto' | 'manual'; allowedApps: string[]; revision: number; createdAt: number; wireless?: { guid: string; hardwareSerial: string; host: string; port: number }; connection?: { kind: 'aliyun-adb'; endpoint: string; credentialId: string } };
export type PhoneConfig = { executionMode?: 'collaborative' | 'direct'; enabled: boolean; adbPath?: string; hdcPath?: string; hdcVideo?: { sdkJar?: string; devecoPath?: string; javaHome?: string }; maxActionsPerSession: number; maxModelRequests: number; maxOperationDurationMs: number; maxSessionDurationMs: number; idleDisconnectMs?: number };
export type PhoneSettings = { config: PhoneConfig; defaultDeviceId?: string; runner: string; agentId: string; hdcVideo?: { available: boolean } };
export type PhoneDevices = { devices: PhoneDevice[]; discovery: Array<{ serial: string; state: string; name: string; emulator: boolean; platform?: 'android' | 'harmonyos' }>; diagnostic?: string; defaultDeviceId?: string };
export type PhoneModel = { id: string; name: string; profile: string; mock: boolean; configured: boolean };
export type PhoneReport = { sessionId: string; deviceId: string; deviceName: string; modelRef: string; mock: boolean; status: string; mode: string; actions: number; modelRequests: number; verified: boolean; verificationLevel: string; stopReason?: string; errorCode?: string; facts?: string[]; foregroundApp?: string; message?: string; steps: Array<{ action: string; dispatch: string }> };
export const MOCK_MODEL = 'phone-mock/settings-about';

export async function phoneRequest<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  const result = await fetchJson<{ ok: boolean; payload: T; error?: { message: string } }>(apiUrl(`/api/phone${path}`), {
    method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!result.ok) throw new Error(result.error?.message ?? 'Phone operation failed');
  return result.payload;
}
export const fetchPhoneSettings = () => phoneRequest<PhoneSettings>('/settings');
export const fetchPhoneDevices = () => phoneRequest<PhoneDevices>('/devices');
export const fetchPhoneModels = () => phoneRequest<{ models: PhoneModel[] }>('/models');

export async function fetchPhoneScreen(id: string, signal?: AbortSignal): Promise<Blob> {
  const result = await apiFetch(apiUrl(`/api/phone/devices/${encodeURIComponent(id)}/screen`), { signal });
  if (!result.ok) {
    const data = await result.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(data.error?.message ?? `HTTP ${result.status}`);
  }
  return result.blob();
}

export type PhoneApplication = { packageName: string; label: string };
export async function fetchPhoneApplications(deviceId: string | undefined, serial: string, platform?: 'android' | 'harmonyos'): Promise<PhoneApplication[]> {
  const result = await phoneRequest<{ applications: PhoneApplication[] }>(deviceId ? `/devices/${encodeURIComponent(deviceId)}/apps` : `/apps?serial=${encodeURIComponent(serial)}${platform ? `&platform=${platform}` : ''}`);
  return result.applications;
}
