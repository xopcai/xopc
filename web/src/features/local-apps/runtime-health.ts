export type LocalAppRuntimeIssue = {
  kind: 'script_error' | 'unhandled_rejection';
  message: string;
  filename?: string;
  line?: number;
  column?: number;
};

export type LocalAppAcceptanceCheck = {
  id: 'document' | 'content' | 'interaction' | 'criteria';
  status: 'passed' | 'failed' | 'skipped';
  message: string;
};

export type LocalAppAcceptanceResult = {
  status: 'passed' | 'failed';
  checks: LocalAppAcceptanceCheck[];
  interactiveCount: number;
};

export type LocalAppCriteriaScenarioResult = {
  id: string;
  name: string;
  status: 'passed' | 'failed';
  message: string;
};

export type LocalAppCriteriaResult = {
  status: 'passed' | 'failed';
  scenarioCount: number;
  scenarios: LocalAppCriteriaScenarioResult[];
};

export type LocalAppRuntimeMessage =
  | { type: 'ready'; detail: { readyState?: string } }
  | { type: 'error'; detail: LocalAppRuntimeIssue }
  | { type: 'acceptance'; detail: LocalAppAcceptanceResult }
  | { type: 'criteria'; detail: LocalAppCriteriaResult };

const ACCEPTANCE_CHECK_IDS = new Set<LocalAppAcceptanceCheck['id']>(['document', 'content', 'interaction', 'criteria']);
const ACCEPTANCE_CHECK_STATUSES = new Set<LocalAppAcceptanceCheck['status']>(['passed', 'failed', 'skipped']);

export function parseLocalAppRuntimeMessage(value: unknown): LocalAppRuntimeMessage | null {
  if (!value || typeof value !== 'object') return null;
  const message = value as Record<string, unknown>;
  if (message.source !== 'xopc-local-app-preview' || message.version !== 1) return null;
  if (message.type === 'ready') return { type: 'ready', detail: {} };
  if (message.type === 'criteria' && message.detail && typeof message.detail === 'object') {
    const detail = message.detail as Record<string, unknown>;
    if (detail.status !== 'passed' && detail.status !== 'failed') return null;
    if (!Array.isArray(detail.scenarios) || detail.scenarios.length > 10) return null;
    const scenarios = detail.scenarios.map((value) => {
      if (!value || typeof value !== 'object') return null;
      const scenario = value as Record<string, unknown>;
      if (typeof scenario.id !== 'string' || !scenario.id.trim() || scenario.id.length > 80) return null;
      if (typeof scenario.name !== 'string' || !scenario.name.trim() || scenario.name.length > 120) return null;
      if (scenario.status !== 'passed' && scenario.status !== 'failed') return null;
      if (typeof scenario.message !== 'string' || !scenario.message.trim()) return null;
      return {
        id: scenario.id,
        name: scenario.name,
        status: scenario.status,
        message: scenario.message.slice(0, 500),
      };
    });
    if (scenarios.some((scenario) => scenario === null)) return null;
    const scenarioCount = typeof detail.scenarioCount === 'number'
      && Number.isInteger(detail.scenarioCount)
      && detail.scenarioCount >= 0
      && detail.scenarioCount <= 10
      ? detail.scenarioCount
      : scenarios.length;
    return {
      type: 'criteria',
      detail: {
        status: detail.status,
        scenarioCount,
        scenarios: scenarios as LocalAppCriteriaScenarioResult[],
      },
    };
  }
  if (message.type === 'acceptance' && message.detail && typeof message.detail === 'object') {
    const detail = message.detail as Record<string, unknown>;
    if (detail.status !== 'passed' && detail.status !== 'failed') return null;
    if (!Array.isArray(detail.checks)) return null;
    const checks = detail.checks.slice(0, 10).map((value) => {
      if (!value || typeof value !== 'object') return null;
      const check = value as Record<string, unknown>;
      if (!ACCEPTANCE_CHECK_IDS.has(check.id as LocalAppAcceptanceCheck['id'])) return null;
      if (!ACCEPTANCE_CHECK_STATUSES.has(check.status as LocalAppAcceptanceCheck['status'])) return null;
      if (typeof check.message !== 'string' || !check.message.trim()) return null;
      return {
        id: check.id as LocalAppAcceptanceCheck['id'],
        status: check.status as LocalAppAcceptanceCheck['status'],
        message: check.message.slice(0, 500),
      };
    });
    if (!checks.length || checks.some((check) => check === null)) return null;
    const interactiveCount = typeof detail.interactiveCount === 'number'
      && Number.isFinite(detail.interactiveCount)
      && detail.interactiveCount >= 0
      ? Math.min(Math.floor(detail.interactiveCount), 10_000)
      : 0;
    return {
      type: 'acceptance',
      detail: {
        status: detail.status,
        checks: checks as LocalAppAcceptanceCheck[],
        interactiveCount,
      },
    };
  }
  if (message.type !== 'error' || !message.detail || typeof message.detail !== 'object') return null;
  const detail = message.detail as Record<string, unknown>;
  if (detail.kind !== 'script_error' && detail.kind !== 'unhandled_rejection') return null;
  if (typeof detail.message !== 'string' || !detail.message.trim()) return null;
  return {
    type: 'error',
    detail: {
      kind: detail.kind,
      message: detail.message.slice(0, 500),
      filename: typeof detail.filename === 'string' ? detail.filename.slice(0, 500) : undefined,
      line: typeof detail.line === 'number' ? detail.line : undefined,
      column: typeof detail.column === 'number' ? detail.column : undefined,
    },
  };
}

export function getLocalAppAcceptanceFailures(result: LocalAppAcceptanceResult | null): string[] {
  return result?.checks.filter((check) => check.status === 'failed').map((check) => check.message) ?? [];
}

export function formatLocalAppRuntimeIssue(issue: LocalAppRuntimeIssue): string {
  const location = issue.filename
    ? ` (${issue.filename}${issue.line ? `:${issue.line}${issue.column ? `:${issue.column}` : ''}` : ''})`
    : '';
  return `${issue.message}${location}`;
}
