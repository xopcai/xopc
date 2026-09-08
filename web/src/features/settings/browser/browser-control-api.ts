import { apiFetch, fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type BrowserDriverKind = 'extension' | 'playwright' | 'cdp' | 'remote';

export type BrowserExtensionArtifacts = {
  installed: boolean;
  bundledAvailable: boolean;
  extensionDir?: string;
  xopcVersion?: string;
  installedVersion?: string;
  needsRefresh: boolean;
  needsChromeReload?: boolean;
};

export type BrowserExtensionStatus = {
  running: boolean;
  socketConnected: boolean;
  connected: boolean;
  driverKind: 'extension';
  protocolVersion: number | null;
  expectedProtocolVersion: number | null;
  extensionVersion: string | null;
  artifacts?: BrowserExtensionArtifacts;
  bridgeHeld?: boolean;
  refCount?: number;
  error?: string;
};

export type PlaywrightDoctorStatus = {
  installed: boolean;
  executablePath?: string | null;
  reason?: string;
};

export type BrowserStatus = {
  enabled: boolean;
  driverKind: BrowserDriverKind;
  state: 'disabled' | 'ready' | 'needs_attention';
  reason?: string;
  detail?: string;
  driverStatus?: BrowserExtensionStatus | PlaywrightDoctorStatus | { error: string };
};

type ApiResult<T> = { ok: true; payload: T };

export function fetchBrowserStatus(): Promise<ApiResult<BrowserStatus>> {
  return fetchJson(apiUrl('/api/browser/status'));
}

export function testBrowserConnection(): Promise<ApiResult<{ driverKind: BrowserDriverKind; durationMs: number }>> {
  return fetchJson(apiUrl('/api/browser/test'), { method: 'POST' });
}

export function installBrowserExtension(force = false): Promise<ApiResult<{
  extensionDir: string;
  xopcVersion: string;
  copied: boolean;
  doctor: BrowserExtensionArtifacts;
}>> {
  return fetchJson(apiUrl('/api/browser/extension/install'), {
    method: 'POST',
    body: JSON.stringify({ force }),
  });
}

export function openBrowserExtension(action: 'chrome' | 'folder' | 'both'): Promise<ApiResult<{
  extensionDir: string;
  browser?: 'chrome' | 'edge';
}>> {
  return fetchJson(apiUrl('/api/browser/extension/open'), {
    method: 'POST',
    body: JSON.stringify({ action }),
  });
}

export type BrowserInstallPhase = 'starting' | 'downloading' | 'verifying' | 'extracting' | 'running' | 'ready';

export type BrowserInstallProgress = {
  phase: BrowserInstallPhase;
  message?: string;
  percent?: number | null;
  line?: string;
};

export type BrowserInstallResult<T> =
  | { ok: true; payload: T }
  | { ok: false; error: string; message?: string };

export async function installPlaywrightChromium(
  onProgress: (progress: BrowserInstallProgress) => void,
  signal: AbortSignal,
): Promise<BrowserInstallResult<PlaywrightDoctorStatus>> {
  const response = await apiFetch(apiUrl('/api/browser/playwright/install/stream'), {
    method: 'POST',
    headers: { Accept: 'text/event-stream' },
    signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`Chromium install request failed (HTTP ${response.status}).`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: BrowserInstallResult<PlaywrightDoctorStatus> | undefined;
  try {
    while (!result) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';
      for (const block of blocks) {
        const event = block.split('\n').find((line) => line.startsWith('event:'))?.slice(6).trim();
        const data = block.split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('');
        if (!data) continue;
        if (event === 'progress') onProgress(JSON.parse(data) as BrowserInstallProgress);
        if (event === 'result') result = JSON.parse(data) as BrowserInstallResult<PlaywrightDoctorStatus>;
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (!result) throw new Error('Chromium installer ended without a result.');
  return result;
}

export async function cancelPlaywrightChromiumInstall(): Promise<void> {
  await fetchJson(apiUrl('/api/browser/playwright/install/cancel'), { method: 'POST' });
}
