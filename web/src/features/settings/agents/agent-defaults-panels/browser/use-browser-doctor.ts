import { useCallback, useEffect, useState } from 'react';

import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import type {
  CdpPingResult,
  CloakDoctor,
  CloudTestResult,
  DoctorState,
  ExtensionProbe,
  LaunchedCdpInstance,
  PlaywrightDoctor,
} from './types';

interface ApiEnvelope<T> {
  ok?: boolean;
  payload?: T;
  error?: string | { message?: string };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await apiFetch(url);
  const body = (await res.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!res.ok || body.ok === false) {
    const msg = typeof body.error === 'string' ? body.error : body.error?.message;
    throw new Error(msg || `Request failed: ${res.status}`);
  }
  if (body.payload === undefined) throw new Error('Empty payload');
  return body.payload;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const json = (await res.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!res.ok || json.ok === false) {
    const msg = typeof json.error === 'string' ? json.error : json.error?.message;
    throw new Error(msg || `Request failed: ${res.status}`);
  }
  if (json.payload === undefined) throw new Error('Empty payload');
  return json.payload;
}

export interface BrowserDoctor {
  playwright: DoctorState<PlaywrightDoctor>;
  cloak: DoctorState<CloakDoctor>;
  /** Periodic probe of the extension bridge (polled every 5 s when active). */
  extension: DoctorState<ExtensionProbe>;
  refetchPlaywright: () => Promise<void>;
  refetchCloak: (overrides?: { cacheDir?: string; binaryPath?: string }) => Promise<CloakDoctor | null>;
  pingCdp: (cdpUrl: string) => Promise<CdpPingResult>;
  testCloud: (provider: 'browserbase' | 'browser-use', apiKey: string) => Promise<CloudTestResult>;
  launchCdp: (executablePath?: string) => Promise<LaunchedCdpInstance>;
  stopCdp: (port: number) => Promise<void>;
  listCdpInstances: () => Promise<LaunchedCdpInstance[]>;
  startExtensionBridge: (opts?: { host?: string; port?: number }) => Promise<void>;
  stopExtensionBridge: () => Promise<void>;
  refetchExtension: () => Promise<void>;
}

export function useBrowserDoctor(opts: {
  cacheDir?: string;
  binaryPath?: string;
  /** When true, the extension probe polls every 5 s. */
  extensionEnabled?: boolean;
  extensionHost?: string;
  extensionPort?: number;
}): BrowserDoctor {
  const [playwright, setPlaywright] = useState<DoctorState<PlaywrightDoctor>>({ kind: 'idle' });
  const [cloak, setCloak] = useState<DoctorState<CloakDoctor>>({ kind: 'idle' });
  const [extension, setExtension] = useState<DoctorState<ExtensionProbe>>({ kind: 'idle' });

  const refetchPlaywright = useCallback(async () => {
    setPlaywright({ kind: 'loading' });
    try {
      const data = await getJson<PlaywrightDoctor>(apiUrl('/api/browser/playwright/doctor'));
      setPlaywright({ kind: 'ok', data });
    } catch (e) {
      setPlaywright({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const refetchCloak = useCallback(
    async (overrides?: { cacheDir?: string; binaryPath?: string }) => {
      setCloak({ kind: 'loading' });
      const cd = (overrides?.cacheDir ?? opts.cacheDir ?? '').trim();
      const bp = (overrides?.binaryPath ?? opts.binaryPath ?? '').trim();
      const qs = new URLSearchParams();
      if (cd) qs.set('cacheDir', cd);
      if (bp) qs.set('binaryPath', bp);
      try {
        const data = await getJson<CloakDoctor>(
          apiUrl(`/api/browser/cloakbrowser/doctor${qs.size ? `?${qs}` : ''}`),
        );
        setCloak({ kind: 'ok', data });
        return data;
      } catch (e) {
        setCloak({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
        return null;
      }
    },
    [opts.binaryPath, opts.cacheDir],
  );

  // One-shot probes on mount.
  useEffect(() => {
    void refetchPlaywright();
  }, [refetchPlaywright]);
  useEffect(() => {
    void refetchCloak();
  }, [refetchCloak]);

  const { extensionEnabled, extensionHost, extensionPort } = opts;

  const refetchExtension = useCallback(async () => {
    const qs = new URLSearchParams({ probe: '1' });
    if (extensionHost) qs.set('host', extensionHost);
    if (extensionPort !== undefined) qs.set('port', String(extensionPort));
    setExtension((prev) => (prev.kind === 'ok' ? prev : { kind: 'loading' }));
    try {
      const res = await apiFetch(apiUrl(`/api/browser/extension-status?${qs}`), {
        signal: AbortSignal.timeout(3000),
      });
      const data = (await res.json().catch(() => ({}))) as {
        running?: boolean;
        connected?: boolean;
        backend?: string;
      };
      if (!res.ok) {
        setExtension({ kind: 'error', message: `HTTP ${res.status}` });
        return;
      }
      setExtension({
        kind: 'ok',
        data: {
          running: data.running === true,
          connected: data.connected === true,
          backend: data.backend,
        },
      });
    } catch (e) {
      setExtension({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, [extensionHost, extensionPort]);

  useEffect(() => {
    if (!extensionEnabled) {
      setExtension({ kind: 'idle' });
      return undefined;
    }
    void refetchExtension();
    const id = setInterval(() => void refetchExtension(), 5000);
    return () => clearInterval(id);
  }, [extensionEnabled, refetchExtension]);

  const startExtensionBridge = useCallback(
    async (params?: { host?: string; port?: number }) => {
      await postJson<{ running: boolean }>(apiUrl('/api/browser/extension/start'), {
        host: params?.host ?? extensionHost,
        port: params?.port ?? extensionPort,
      });
      await refetchExtension();
    },
    [extensionHost, extensionPort, refetchExtension],
  );

  const stopExtensionBridge = useCallback(async () => {
    await postJson<{ running: boolean }>(apiUrl('/api/browser/extension/stop'), {});
    await refetchExtension();
  }, [refetchExtension]);

  const pingCdp = useCallback(async (cdpUrl: string) => {
    return postJson<CdpPingResult>(apiUrl('/api/browser/cdp/ping'), { cdpUrl });
  }, []);

  const testCloud = useCallback(
    async (provider: 'browserbase' | 'browser-use', apiKey: string) => {
      return postJson<CloudTestResult>(apiUrl('/api/browser/cloud/test-connection'), {
        provider,
        apiKey,
      });
    },
    [],
  );

  const launchCdp = useCallback(async (executablePath?: string) => {
    return postJson<LaunchedCdpInstance>(apiUrl('/api/browser/cdp/launch'), {
      executablePath,
    });
  }, []);

  const stopCdp = useCallback(async (port: number) => {
    await postJson<{ stopped: boolean }>(apiUrl('/api/browser/cdp/stop'), { port });
  }, []);

  const listCdpInstances = useCallback(async () => {
    const payload = await getJson<{ instances: LaunchedCdpInstance[] }>(
      apiUrl('/api/browser/cdp/instances'),
    );
    return payload.instances;
  }, []);

  return {
    playwright,
    cloak,
    extension,
    refetchPlaywright,
    refetchCloak,
    refetchExtension,
    pingCdp,
    testCloud,
    launchCdp,
    stopCdp,
    listCdpInstances,
    startExtensionBridge,
    stopExtensionBridge,
  };
}
