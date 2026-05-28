import { useCallback, useEffect, useReducer, useRef } from 'react';

import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import type {
  CdpPingResult,
  CloakDoctor,
  CloudTestResult,
  DoctorState,
  ExtensionArtifacts,
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

type BrowserDoctorState = {
  playwright: DoctorState<PlaywrightDoctor>;
  cloak: DoctorState<CloakDoctor>;
  extension: DoctorState<ExtensionProbe>;
  extensionArtifacts: DoctorState<ExtensionArtifacts>;
};

type BrowserDoctorAction =
  | { type: 'playwright'; state: DoctorState<PlaywrightDoctor> }
  | { type: 'cloak'; state: DoctorState<CloakDoctor> }
  | { type: 'extension'; state: DoctorState<ExtensionProbe> }
  | { type: 'extension-artifacts'; state: DoctorState<ExtensionArtifacts> }
  | { type: 'extension-idle' }
  | { type: 'extension-start-probe' }
  | { type: 'extension-artifacts-start-probe' };

const initialBrowserDoctorState: BrowserDoctorState = {
  playwright: { kind: 'idle' },
  cloak: { kind: 'idle' },
  extension: { kind: 'idle' },
  extensionArtifacts: { kind: 'idle' },
};

function browserDoctorReducer(state: BrowserDoctorState, action: BrowserDoctorAction): BrowserDoctorState {
  switch (action.type) {
    case 'playwright':
      return { ...state, playwright: action.state };
    case 'cloak':
      return { ...state, cloak: action.state };
    case 'extension':
      return { ...state, extension: action.state };
    case 'extension-artifacts':
      return { ...state, extensionArtifacts: action.state };
    case 'extension-idle':
      return { ...state, extension: { kind: 'idle' }, extensionArtifacts: { kind: 'idle' } };
    case 'extension-start-probe':
      return {
        ...state,
        extension: state.extension.kind === 'ok' ? state.extension : { kind: 'loading' },
      };
    case 'extension-artifacts-start-probe':
      return {
        ...state,
        extensionArtifacts:
          state.extensionArtifacts.kind === 'ok' ? state.extensionArtifacts : { kind: 'loading' },
      };
  }
}

export interface BrowserDoctor {
  playwright: DoctorState<PlaywrightDoctor>;
  cloak: DoctorState<CloakDoctor>;
  /** Periodic probe of the extension bridge (polled every 5 s when active). */
  extension: DoctorState<ExtensionProbe>;
  extensionArtifacts: DoctorState<ExtensionArtifacts>;
  refetchPlaywright: () => Promise<void>;
  applyPlaywrightDoctor: (data: PlaywrightDoctor) => void;
  refetchCloak: (overrides?: { cacheDir?: string; binaryPath?: string }) => Promise<CloakDoctor | null>;
  applyCloakDoctor: (data: CloakDoctor) => void;
  pingCdp: (cdpUrl: string) => Promise<CdpPingResult>;
  testCloud: (provider: 'browserbase' | 'browser-use', apiKey: string) => Promise<CloudTestResult>;
  launchCdp: (executablePath?: string) => Promise<LaunchedCdpInstance>;
  stopCdp: (port: number) => Promise<void>;
  listCdpInstances: () => Promise<LaunchedCdpInstance[]>;
  startExtensionBridge: (opts?: { host?: string; port?: number }) => Promise<void>;
  stopExtensionBridge: () => Promise<void>;
  refetchExtension: () => Promise<void>;
  refetchExtensionArtifacts: () => Promise<ExtensionArtifacts | null>;
  installExtensionArtifacts: (opts?: { force?: boolean }) => Promise<ExtensionArtifacts | null>;
  openExtensionChrome: () => Promise<void>;
  revealExtensionFolder: () => Promise<void>;
}

export function useBrowserDoctor(opts: {
  cacheDir?: string;
  binaryPath?: string;
  /** When true, the extension probe polls every 5 s. */
  extensionEnabled?: boolean;
  extensionHost?: string;
  extensionPort?: number;
}): BrowserDoctor {
  const [doctors, dispatch] = useReducer(browserDoctorReducer, initialBrowserDoctorState);
  const { playwright, cloak, extension, extensionArtifacts } = doctors;

  const refetchPlaywright = useCallback(async () => {
    dispatch({ type: 'playwright', state: { kind: 'loading' } });
    try {
      const data = await getJson<PlaywrightDoctor>(apiUrl('/api/browser/playwright/doctor'));
      dispatch({ type: 'playwright', state: { kind: 'ok', data } });
    } catch (e) {
      dispatch({
        type: 'playwright',
        state: { kind: 'error', message: e instanceof Error ? e.message : String(e) },
      });
    }
  }, []);

  const refetchCloak = useCallback(
    async (overrides?: { cacheDir?: string; binaryPath?: string }) => {
      dispatch({ type: 'cloak', state: { kind: 'loading' } });
      const cd = (overrides?.cacheDir ?? opts.cacheDir ?? '').trim();
      const bp = (overrides?.binaryPath ?? opts.binaryPath ?? '').trim();
      const qs = new URLSearchParams();
      if (cd) qs.set('cacheDir', cd);
      if (bp) qs.set('binaryPath', bp);
      try {
        const data = await getJson<CloakDoctor>(
          apiUrl(`/api/browser/cloakbrowser/doctor${qs.size ? `?${qs}` : ''}`),
        );
        dispatch({ type: 'cloak', state: { kind: 'ok', data } });
        return data;
      } catch (e) {
        dispatch({
          type: 'cloak',
          state: { kind: 'error', message: e instanceof Error ? e.message : String(e) },
        });
        return null;
      }
    },
    [opts.binaryPath, opts.cacheDir],
  );

  const applyPlaywrightDoctor = useCallback((data: PlaywrightDoctor) => {
    dispatch({ type: 'playwright', state: { kind: 'ok', data } });
  }, []);

  const applyCloakDoctor = useCallback((data: CloakDoctor) => {
    dispatch({ type: 'cloak', state: { kind: 'ok', data } });
  }, []);

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
    dispatch({ type: 'extension-start-probe' });
    try {
      const res = await apiFetch(apiUrl(`/api/browser/extension-status?${qs}`), {
        signal: AbortSignal.timeout(3000),
      });
      const data = (await res.json().catch(() => ({}))) as {
        running?: boolean;
        connected?: boolean;
        backend?: string;
        artifacts?: ExtensionArtifacts;
      };
      if (!res.ok) {
        dispatch({ type: 'extension', state: { kind: 'error', message: `HTTP ${res.status}` } });
        return;
      }
      dispatch({
        type: 'extension',
        state: {
          kind: 'ok',
          data: {
            running: data.running === true,
            connected: data.connected === true,
            backend: data.backend,
            artifacts: data.artifacts,
          },
        },
      });
    } catch (e) {
      dispatch({
        type: 'extension',
        state: { kind: 'error', message: e instanceof Error ? e.message : String(e) },
      });
    }
  }, [extensionHost, extensionPort]);

  const refetchExtensionArtifacts = useCallback(async () => {
    dispatch({ type: 'extension-artifacts-start-probe' });
    try {
      const data = await getJson<ExtensionArtifacts>(apiUrl('/api/browser/extension/doctor'));
      dispatch({ type: 'extension-artifacts', state: { kind: 'ok', data } });
      return data;
    } catch (e) {
      dispatch({
        type: 'extension-artifacts',
        state: { kind: 'error', message: e instanceof Error ? e.message : String(e) },
      });
      return null;
    }
  }, []);

  const installExtensionArtifacts = useCallback(
    async (params?: { force?: boolean }) => {
      const payload = await postJson<{ doctor: ExtensionArtifacts }>(
        apiUrl('/api/browser/extension/install'),
        { force: params?.force ?? false },
      );
      const doctor = payload.doctor;
      dispatch({ type: 'extension-artifacts', state: { kind: 'ok', data: doctor } });
      await refetchExtension();
      return doctor;
    },
    [refetchExtension],
  );

  const openExtensionChrome = useCallback(async () => {
    await postJson<{ extensionDir: string }>(apiUrl('/api/browser/extension/open'), {
      action: 'chrome',
    });
  }, []);

  const revealExtensionFolder = useCallback(async () => {
    await postJson<{ extensionDir: string }>(apiUrl('/api/browser/extension/open'), {
      action: 'folder',
    });
  }, []);

  const trackedExtensionEnabledRef = useRef(extensionEnabled);
  if (trackedExtensionEnabledRef.current !== extensionEnabled) {
    trackedExtensionEnabledRef.current = extensionEnabled;
    if (!extensionEnabled) {
      dispatch({ type: 'extension-idle' });
    }
  }

  useEffect(() => {
    if (!extensionEnabled) return undefined;
    void refetchExtension();
    void refetchExtensionArtifacts();
    const id = setInterval(() => void refetchExtension(), 5000);
    return () => clearInterval(id);
  }, [extensionEnabled, refetchExtension, refetchExtensionArtifacts]);

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
    extensionArtifacts,
    refetchPlaywright,
    applyPlaywrightDoctor,
    refetchCloak,
    applyCloakDoctor,
    refetchExtension,
    refetchExtensionArtifacts,
    installExtensionArtifacts,
    openExtensionChrome,
    revealExtensionFolder,
    pingCdp,
    testCloud,
    launchCdp,
    stopCdp,
    listCdpInstances,
    startExtensionBridge,
    stopExtensionBridge,
  };
}
