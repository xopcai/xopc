import { isMaskedSecret } from '@/lib/is-masked-secret';

import type { BrowserDiagnostic, DoctorCheck, DoctorCheckStatus, LogsHealth } from './setup-diagnostics-api';

export type SetupChecklistItemId =
  | 'gateway'
  | 'provider'
  | 'defaultModel'
  | 'channel'
  | 'skill';

export type SetupChecklistItemState = {
  id: SetupChecklistItemId;
  done: boolean;
  optional?: boolean;
  /** Short status line for the overview card (e.g. model ref, provider count). */
  detail?: string;
};

export type ReadinessPipelineItem = {
  id: 'gateway' | 'provider' | 'defaultModel' | 'ready';
  status: DoctorCheckStatus;
  title: string;
  detail: string;
  path?: string;
};

export type SetupHealthTier = 'ready' | 'setup' | 'attention' | 'blocked';

export type SetupIssue = {
  id: string;
  label: string;
  status: DoctorCheckStatus;
  message: string;
  hints: string[];
  path?: string;
  source: 'doctor' | 'logs' | 'browser' | 'setup';
};

export type SetupDiagnosticSignal = {
  id: string;
  label: string;
  status: DoctorCheckStatus;
  message: string;
  path?: string;
};

export type ScenarioStepState = {
  done: boolean;
  status: DoctorCheckStatus;
};

export type SetupStatusSnapshot = {
  gatewayConnected: boolean;
  providerConfigured: boolean;
  providerCount: number;
  providerMetaConfigured: number;
  providerMetaTotal: number;
  defaultModel: string;
  defaultModelConfigured: boolean;
  channelConfigured: boolean;
  skillInstalled: boolean;
  skillCount: number;
  checklist: SetupChecklistItemState[];
  readiness: ReadinessPipelineItem[];
  issues: SetupIssue[];
  healthTier: SetupHealthTier;
  diagnosticSignals: SetupDiagnosticSignal[];
  requiredComplete: boolean;
  allComplete: boolean;
};

type SetupDiagnosticsCopy = {
  labels: Record<string, string>;
  runtimeMissing: (runtimes: string) => string;
  runtimeInvalid: (runtimes: string) => string;
  gatewayNotInstalled: string;
  gatewayUnavailable: (detail: string) => string;
  gatewayNotRunning: (status: string) => string;
  providerAuthMissing: string;
  runCommand: (command: string) => string;
  installCommand: (command: string) => string;
  startCommand: (command: string) => string;
  logsHealthy: string;
  logsShuttingDown: string;
  logsErrors: (count: number) => string;
  chromiumInstalled: string;
  chromiumNotInstalled: string;
  extensionConnected: string;
  extensionNeedsRefresh: string;
  extensionNotConnected: string;
  extensionNotInstalled: string;
  browserDriverConfigured: (driver: string) => string;
};

function countConfiguredProviders(config: unknown): number {
  if (!config || typeof config !== 'object') return 0;
  const providers = (config as Record<string, unknown>).providers;
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) return 0;
  return Object.values(providers as Record<string, unknown>).filter(
    (v) => typeof v === 'string' && isMaskedSecret(v),
  ).length;
}

function readDefaultModel(config: unknown): string {
  if (!config || typeof config !== 'object') return '';
  const agents = (config as Record<string, unknown>).agents;
  if (!agents || typeof agents !== 'object' || Array.isArray(agents)) return '';
  const agentRecord = agents as Record<string, unknown>;
  const defaults = agentRecord.defaults;
  const models = defaults && typeof defaults === 'object' && !Array.isArray(defaults)
    ? (defaults as Record<string, unknown>).models
    : undefined;
  if (!models || typeof models !== 'object' || Array.isArray(models)) return '';
  const modelRecord = models as Record<string, unknown>;
  const chat = modelRecord.chat;
  if (!chat || typeof chat !== 'object' || Array.isArray(chat)) return '';
  const model = (chat as Record<string, unknown>).primary;
  return typeof model === 'string' ? model.trim() : '';
}

function isAnyChannelConfigured(config: unknown): boolean {
  if (!config || typeof config !== 'object') return false;
  const channels = (config as Record<string, unknown>).channels;
  if (!channels || typeof channels !== 'object' || Array.isArray(channels)) return false;
  return Object.values(channels as Record<string, unknown>).some((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const record = entry as Record<string, unknown>;
    if ('configured' in record || 'config' in record || 'schema' in record || 'uiHints' in record) {
      if (record.configured === true) return true;
      const channelConfig = record.config;
      if (!channelConfig || typeof channelConfig !== 'object' || Array.isArray(channelConfig)) return false;
      const channelRecord = channelConfig as Record<string, unknown>;
      return channelRecord.enabled === true || Object.keys(channelRecord).length > 0;
    }
    return record.enabled === true || Object.keys(record).length > 0;
  });
}

function readBrowserConfig(config: unknown): { enabled: boolean; driverKind: string } {
  if (!config || typeof config !== 'object') return { enabled: false, driverKind: 'extension' };
  const browser = (config as Record<string, unknown>).browser;
  if (!browser || typeof browser !== 'object' || Array.isArray(browser)) return { enabled: false, driverKind: 'extension' };
  const record = browser as Record<string, unknown>;
  const driver = record.driver && typeof record.driver === 'object' && !Array.isArray(record.driver)
    ? record.driver as Record<string, unknown>
    : undefined;
  return {
    enabled: record.enabled === true,
    driverKind: typeof driver?.kind === 'string' && driver.kind.trim() ? driver.kind.trim() : 'extension',
  };
}

function statusFromDone(done: boolean): DoctorCheckStatus {
  return done ? 'pass' : 'fail';
}

function issuePath(id: string): string | undefined {
  if (id === 'tool-runtimes') return '/settings/runtimes';
  if (id === 'provider-auth') return '/settings/capabilities/models';
  if (id === 'config-health') return '/settings/gateway';
  if (id === 'state-integrity' || id === 'workspace-status') return '/capabilities/agents';
  if (id === 'database-schema' || id === 'session-integrity') return '/settings/sessions';
  if (id === 'channel-config' || id === 'channel-pairing-pending' || id.startsWith('channel:')) return '/capabilities/channels';
  if (id === 'security-audit') return '/settings/gateway';
  if (id === 'gateway-service' || id === 'gateway-health') return '/settings/gateway';
  if (id === 'version-check') return '/settings/desktop-app';
  return undefined;
}

function rankStatus(status: DoctorCheckStatus): number {
  return { fail: 4, warn: 3, skip: 2, pass: 1 }[status];
}

function localizeHint(hint: string, copy: SetupDiagnosticsCopy): string {
  const run = hint.match(/^Run(?::|\s)(.*)$/i);
  if (run?.[1]) return copy.runCommand(run[1].trim());
  const install = hint.match(/^Install(?::|\s)(.*)$/i);
  if (install?.[1]) return copy.installCommand(install[1].trim());
  const start = hint.match(/^Start(?::|\s)(.*)$/i);
  if (start?.[1]) return copy.startCommand(start[1].trim());
  return hint;
}

function localizeDoctorCheck(check: DoctorCheck, copy?: SetupDiagnosticsCopy): DoctorCheck {
  if (!copy) return check;

  let message = check.message;
  if (check.id === 'tool-runtimes') {
    const missing = check.message.match(/^(.*) runtime is not installed\.$/);
    const invalid = check.message.match(/^(.*) runtime installation is invalid\.$/);
    if (missing?.[1]) message = copy.runtimeMissing(missing[1]);
    else if (invalid?.[1]) message = copy.runtimeInvalid(invalid[1]);
  } else if (check.id === 'gateway-service') {
    if (check.message === 'Gateway is not installed as a system service.') {
      message = copy.gatewayNotInstalled;
    } else {
      const unavailable = check.message.match(/^Service backend unavailable: (.*)$/);
      const notRunning = check.message.match(/^Gateway service is installed but not running \(status: (.*)\)\.$/);
      if (unavailable?.[1]) message = copy.gatewayUnavailable(unavailable[1]);
      else if (notRunning?.[1]) message = copy.gatewayNotRunning(notRunning[1]);
    }
  } else if (check.id === 'provider-auth' && check.message === 'No API keys detected for configured providers.') {
    message = copy.providerAuthMissing;
  }

  return {
    ...check,
    label: copy.labels[check.id] ?? check.label,
    message,
    hints: check.hints.map((hint) => localizeHint(hint, copy)),
  };
}

function buildDoctorIssues(checks: DoctorCheck[], copy?: SetupDiagnosticsCopy): SetupIssue[] {
  return checks
    .filter((check) => check.status === 'fail' || check.status === 'warn')
    .map((rawCheck) => {
      const check = localizeDoctorCheck(rawCheck, copy);
      return {
        id: check.id,
        label: check.label,
        status: check.status,
        message: check.message,
        hints: check.hints,
        path: issuePath(check.id),
        source: 'doctor' as const,
      };
    })
    .toSorted((a, b) => rankStatus(b.status) - rankStatus(a.status) || a.label.localeCompare(b.label));
}

function buildDiagnosticSignals(input: {
  doctorChecks: DoctorCheck[];
  logsHealth?: LogsHealth | null;
  browserDiagnostics?: BrowserDiagnostic[];
  copy?: SetupDiagnosticsCopy;
}): SetupDiagnosticSignal[] {
  const byId = new Map(input.doctorChecks.map((check) => [check.id, check]));
  const signals: SetupDiagnosticSignal[] = [];

  for (const id of ['security-audit', 'channel-config', 'channel-pairing-pending', 'gateway-health']) {
    const check = byId.get(id);
    if (check) {
      const localized = localizeDoctorCheck(check, input.copy);
      signals.push({
        id: localized.id,
        label: localized.label,
        status: localized.status,
        message: localized.message,
        path: issuePath(localized.id),
      });
    }
  }

  if (input.logsHealth) {
    const errors = input.logsHealth.stats?.errorsLast24h ?? 0;
    signals.push({
      id: 'logs-health',
      label: input.copy?.labels['logs-health'] ?? 'Logs',
      status: input.logsHealth.shuttingDown ? 'warn' : errors > 0 ? 'warn' : 'pass',
      message: input.copy
        ? input.logsHealth.shuttingDown
          ? input.copy.logsShuttingDown
          : errors > 0
            ? input.copy.logsErrors(errors)
            : input.copy.logsHealthy
        : input.logsHealth.shuttingDown
          ? 'Logger is shutting down.'
          : errors > 0
            ? `${errors} error(s) in the last 24 hours.`
            : 'Log system is healthy.',
      path: '/settings/logs',
    });
  }

  for (const item of input.browserDiagnostics ?? []) {
    let message = item.message;
    if (input.copy) {
      const knownMessages: Record<string, string> = {
        'Local Chromium is installed.': input.copy.chromiumInstalled,
        'Local Chromium is not installed.': input.copy.chromiumNotInstalled,
        'Chrome extension bridge is connected.': input.copy.extensionConnected,
        'Chrome extension needs refresh.': input.copy.extensionNeedsRefresh,
        'Chrome extension is installed but not connected.': input.copy.extensionNotConnected,
        'Chrome extension is not installed.': input.copy.extensionNotInstalled,
      };
      message = knownMessages[item.message] ?? item.message;
      const configured = item.message.match(/^Browser driver "(.*)" is configured\.$/);
      if (configured?.[1]) message = input.copy.browserDriverConfigured(configured[1]);
    }
    signals.push({
      ...item,
      label: input.copy?.labels[item.id] ?? item.label,
      message,
    });
  }

  return signals;
}

export function buildSetupStatusSnapshot(input: {
  isElectron?: boolean;
  hasToken: boolean;
  realtimeConnected: boolean;
  config: unknown;
  skillCount: number;
  providerMeta?: { configured: number; total: number } | null;
  doctorChecks?: DoctorCheck[];
  logsHealth?: LogsHealth | null;
  browserDiagnostics?: BrowserDiagnostic[];
  labels: {
    gatewayOnline: string;
    gatewayOffline: string;
    providersConfigured: (count: number) => string;
    providersMetaReady: (configured: number, total: number) => string;
    providersMissing: string;
    modelConfigured: (model: string) => string;
    modelMissing: string;
    channelConfigured: string;
    channelMissing: string;
    skillsConfigured: (count: number) => string;
    skillsMissing: string;
    readyToChat: string;
    diagnostics?: SetupDiagnosticsCopy;
  };
}): SetupStatusSnapshot {
  const providerCount = countConfiguredProviders(input.config);
  const providerMetaConfigured = input.providerMeta?.configured ?? providerCount;
  const providerMetaTotal = input.providerMeta?.total ?? 0;
  const providerConfigured =
    providerMetaConfigured > 0 || providerCount > 0;
  const defaultModel = readDefaultModel(input.config);
  const defaultModelConfigured = defaultModel.length > 0;
  const gatewayConnected = input.hasToken && input.realtimeConnected;
  const channelConfigured = isAnyChannelConfigured(input.config);
  const skillInstalled = input.skillCount > 0;
  const doctorChecks = (input.doctorChecks ?? []).filter(
    (check) => !input.isElectron || check.id !== 'gateway-service',
  );
  const issues = buildDoctorIssues(doctorChecks, input.labels.diagnostics);

  const checklist: SetupChecklistItemState[] = [
    {
      id: 'gateway',
      done: gatewayConnected,
      detail: gatewayConnected ? input.labels.gatewayOnline : input.labels.gatewayOffline,
    },
    {
      id: 'provider',
      done: providerConfigured,
      detail: providerConfigured
        ? input.providerMeta && input.providerMeta.total > 0
          ? input.labels.providersMetaReady(providerMetaConfigured, providerMetaTotal)
          : input.labels.providersConfigured(providerCount)
        : input.labels.providersMissing,
    },
    {
      id: 'defaultModel',
      done: defaultModelConfigured,
      detail: defaultModelConfigured
        ? input.labels.modelConfigured(defaultModel)
        : input.labels.modelMissing,
    },
    {
      id: 'channel',
      done: channelConfigured,
      optional: true,
      detail: channelConfigured ? input.labels.channelConfigured : input.labels.channelMissing,
    },
    {
      id: 'skill',
      done: skillInstalled,
      optional: true,
      detail: skillInstalled
        ? input.labels.skillsConfigured(input.skillCount)
        : input.labels.skillsMissing,
    },
  ];

  const requiredComplete = checklist.filter((item) => !item.optional).every((item) => item.done);
  const allComplete = checklist.every((item) => item.done);
  const readiness: ReadinessPipelineItem[] = [
    {
      id: 'gateway',
      status: statusFromDone(gatewayConnected),
      title: 'Gateway',
      detail: gatewayConnected ? input.labels.gatewayOnline : input.labels.gatewayOffline,
      path: '/settings/gateway',
    },
    {
      id: 'provider',
      status: statusFromDone(providerConfigured),
      title: 'Model provider',
      detail: providerConfigured
        ? input.providerMeta && input.providerMeta.total > 0
          ? input.labels.providersMetaReady(providerMetaConfigured, providerMetaTotal)
          : input.labels.providersConfigured(providerCount)
        : input.labels.providersMissing,
      path: '/settings/capabilities/models',
    },
    {
      id: 'defaultModel',
      status: statusFromDone(defaultModelConfigured),
      title: 'Default model',
      detail: defaultModelConfigured ? input.labels.modelConfigured(defaultModel) : input.labels.modelMissing,
      path: '/settings/capabilities/models',
    },
    {
      id: 'ready',
      status: requiredComplete ? 'pass' : 'fail',
      title: 'Chat readiness',
      detail: requiredComplete ? input.labels.readyToChat : input.labels.modelMissing,
      path: '/chat',
    },
  ];
  const hasFail = issues.some((issue) => issue.status === 'fail');
  const hasWarn = issues.some((issue) => issue.status === 'warn');
  const healthTier: SetupHealthTier = hasFail
    ? 'blocked'
    : hasWarn
      ? 'attention'
      : requiredComplete
        ? 'ready'
        : 'setup';
  const diagnosticSignals = buildDiagnosticSignals({
    doctorChecks,
    logsHealth: input.logsHealth,
    browserDiagnostics: input.browserDiagnostics,
    copy: input.labels.diagnostics,
  });

  return {
    gatewayConnected,
    providerConfigured,
    providerCount,
    providerMetaConfigured,
    providerMetaTotal,
    defaultModel,
    defaultModelConfigured,
    channelConfigured,
    skillInstalled,
    skillCount: input.skillCount,
    checklist,
    readiness,
    issues,
    healthTier,
    diagnosticSignals,
    requiredComplete,
    allComplete,
  };
}

export function readOverviewBrowserDiagnosticsInput(config: unknown): { enabled: boolean; driverKind: string } {
  return readBrowserConfig(config);
}

export function scenarioStepState(
  stepLabelKey: string,
  snapshot: SetupStatusSnapshot,
): ScenarioStepState {
  if (stepLabelKey === 'stepProviders') {
    return { done: snapshot.providerConfigured, status: statusFromDone(snapshot.providerConfigured) };
  }
  if (stepLabelKey === 'stepDefaultModel') {
    return { done: snapshot.defaultModelConfigured, status: statusFromDone(snapshot.defaultModelConfigured) };
  }
  if (stepLabelKey === 'stepChannel') {
    return { done: snapshot.channelConfigured, status: snapshot.channelConfigured ? 'pass' : 'warn' };
  }
  if (stepLabelKey === 'stepSkills') {
    return { done: snapshot.skillInstalled, status: snapshot.skillInstalled ? 'pass' : 'warn' };
  }
  if (stepLabelKey === 'stepAutomation') {
    return { done: true, status: 'pass' };
  }
  return { done: false, status: 'skip' };
}
