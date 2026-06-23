import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type DoctorCheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

export type DoctorFinding = {
  checkId: string;
  severity: 'critical' | 'warn' | 'info';
  title: string;
  detail: string;
  remediation?: string;
};

export type DoctorCheck = {
  id: string;
  label: string;
  status: DoctorCheckStatus;
  message: string;
  hints: string[];
  fixed: boolean;
  findings?: DoctorFinding[];
};

type DoctorApiResponse = {
  ok?: boolean;
  checks?: Array<Partial<DoctorCheck>>;
};

export type LogsHealth = {
  status: 'healthy' | 'shutting_down' | string;
  config?: { dir?: string; uptimeMs?: number };
  stats?: {
    errorsLast24h?: number;
    modulesTracked?: number;
  };
  shuttingDown?: boolean;
};

type ApiPayload<T> = {
  ok?: boolean;
  payload?: T;
  error?: string;
};

export type BrowserDiagnostic = {
  id: 'browser-playwright' | 'browser-cloakbrowser' | 'browser-extension';
  label: string;
  status: DoctorCheckStatus;
  message: string;
  path: string;
};

export type BrowserDiagnosticsInput = {
  enabled: boolean;
  backend: string;
};

function normalizeDoctorCheck(check: Partial<DoctorCheck>): DoctorCheck | null {
  if (!check.id || !check.label || !check.status || !check.message) return null;
  if (!['pass', 'warn', 'fail', 'skip'].includes(check.status)) return null;
  return {
    id: check.id,
    label: check.label,
    status: check.status,
    message: check.message,
    hints: Array.isArray(check.hints) ? check.hints.filter((h): h is string => typeof h === 'string') : [],
    fixed: check.fixed === true,
    findings: Array.isArray(check.findings) ? check.findings : undefined,
  };
}

export function setupDoctorSwrKey(): string {
  return apiUrl('/api/doctor');
}

export async function fetchSetupDoctorChecks(): Promise<DoctorCheck[]> {
  const data = await fetchJson<DoctorApiResponse>(setupDoctorSwrKey());
  return (data.checks ?? []).map(normalizeDoctorCheck).filter((c): c is DoctorCheck => c !== null);
}

export function logsHealthSwrKey(): string {
  return apiUrl('/api/logs/health');
}

export async function fetchLogsHealth(): Promise<LogsHealth> {
  return fetchJson<LogsHealth>(logsHealthSwrKey());
}

function browserStatus(installed: boolean | undefined): DoctorCheckStatus {
  return installed ? 'pass' : 'warn';
}

export function browserDiagnosticsSwrKey(input: BrowserDiagnosticsInput | null): [string, BrowserDiagnosticsInput] | null {
  if (!input?.enabled) return null;
  return ['setup-browser-diagnostics', input];
}

export async function fetchBrowserDiagnostics(input: BrowserDiagnosticsInput): Promise<BrowserDiagnostic[]> {
  if (!input.enabled) return [];

  if (input.backend === 'local') {
    const data = await fetchJson<ApiPayload<{ installed?: boolean; reason?: string }>>(
      apiUrl('/api/browser/playwright/doctor'),
    );
    const installed = data.payload?.installed === true;
    return [{
      id: 'browser-playwright',
      label: 'Browser: Playwright',
      status: browserStatus(installed),
      message: installed ? 'Local Chromium is installed.' : (data.payload?.reason ?? 'Local Chromium is not installed.'),
      path: '/settings/agent-browser?tab=local',
    }];
  }

  if (input.backend === 'cloakbrowser') {
    const data = await fetchJson<ApiPayload<{ installed?: boolean; version?: string | null }>>(
      apiUrl('/api/browser/cloakbrowser/doctor'),
    );
    const installed = data.payload?.installed === true;
    return [{
      id: 'browser-cloakbrowser',
      label: 'Browser: CloakBrowser',
      status: browserStatus(installed),
      message: installed
        ? `CloakBrowser ${data.payload?.version ?? ''}`.trim()
        : 'CloakBrowser is not installed.',
      path: '/settings/agent-browser?tab=cloakbrowser',
    }];
  }

  if (input.backend === 'extension') {
    const data = await fetchJson<{
      running?: boolean;
      connected?: boolean;
      artifacts?: { installed?: boolean; needsRefresh?: boolean; needsChromeReload?: boolean };
    }>(apiUrl('/api/browser/extension-status?probe=true'));
    const installed = data.artifacts?.installed === true;
    const connected = data.connected === true;
    const needsRefresh = data.artifacts?.needsRefresh === true || data.artifacts?.needsChromeReload === true;
    return [{
      id: 'browser-extension',
      label: 'Browser: Chrome extension',
      status: connected ? 'pass' : installed && !needsRefresh ? 'warn' : 'warn',
      message: connected
        ? 'Chrome extension bridge is connected.'
        : installed
          ? needsRefresh
            ? 'Chrome extension needs refresh.'
            : 'Chrome extension is installed but not connected.'
          : 'Chrome extension is not installed.',
      path: '/settings/agent-browser?tab=extension',
    }];
  }

  return [{
    id: 'browser-playwright',
    label: 'Browser',
    status: 'skip',
    message: `Browser backend "${input.backend}" is not checked on this overview.`,
    path: '/settings/agent-browser',
  }];
}
