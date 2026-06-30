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
  const defaultPreset = typeof agentRecord.defaultPreset === 'string' && agentRecord.defaultPreset.trim()
    ? agentRecord.defaultPreset.trim()
    : 'default';
  const presets = agentRecord.capabilityPresets;
  const preset = presets && typeof presets === 'object' && !Array.isArray(presets)
    ? (presets as Record<string, unknown>)[defaultPreset]
    : undefined;
  const models = preset && typeof preset === 'object' && !Array.isArray(preset)
    ? (preset as Record<string, unknown>).models
    : undefined;
  if (!models || typeof models !== 'object' || Array.isArray(models)) return '';
  const modelRecord = models as Record<string, unknown>;
  const roles = modelRecord.roles;
  if (!roles || typeof roles !== 'object' || Array.isArray(roles)) return '';
  const roleMap = roles as Record<string, unknown>;
  const defaultRole = typeof modelRecord.defaultRole === 'string' && modelRecord.defaultRole.trim()
    ? modelRecord.defaultRole.trim()
    : Object.keys(roleMap)[0];
  const role = defaultRole ? roleMap[defaultRole] : undefined;
  if (!role || typeof role !== 'object' || Array.isArray(role)) return '';
  const model = (role as Record<string, unknown>).model;
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

function readBrowserConfig(config: unknown): { enabled: boolean; backend: string } {
  if (!config || typeof config !== 'object') return { enabled: false, backend: 'extension' };
  const browser = (config as Record<string, unknown>).browser;
  if (!browser || typeof browser !== 'object' || Array.isArray(browser)) return { enabled: false, backend: 'extension' };
  const record = browser as Record<string, unknown>;
  return {
    enabled: record.enabled === true,
    backend: typeof record.backend === 'string' && record.backend.trim() ? record.backend.trim() : 'extension',
  };
}

function statusFromDone(done: boolean): DoctorCheckStatus {
  return done ? 'pass' : 'fail';
}

function issuePath(id: string): string | undefined {
  if (id === 'provider-auth') return '/settings/credentials';
  if (id === 'config-health') return '/settings/gateway';
  if (id === 'state-integrity' || id === 'workspace-status') return '/agents';
  if (id === 'database-schema' || id === 'session-integrity') return '/settings/sessions';
  if (id === 'channel-config' || id === 'channel-pairing-pending' || id.startsWith('channel:')) return '/channels';
  if (id === 'security-audit') return '/settings/gateway';
  if (id === 'gateway-service' || id === 'gateway-health') return '/settings/gateway';
  if (id === 'cron-health') return '/settings/goals';
  if (id === 'version-check') return '/settings/app-management';
  return undefined;
}

function rankStatus(status: DoctorCheckStatus): number {
  return { fail: 4, warn: 3, skip: 2, pass: 1 }[status];
}

function buildDoctorIssues(checks: DoctorCheck[]): SetupIssue[] {
  return checks
    .filter((check) => check.status === 'fail' || check.status === 'warn')
    .map((check) => ({
      id: check.id,
      label: check.label,
      status: check.status,
      message: check.message,
      hints: check.hints,
      path: issuePath(check.id),
      source: 'doctor' as const,
    }))
    .toSorted((a, b) => rankStatus(b.status) - rankStatus(a.status) || a.label.localeCompare(b.label));
}

function buildDiagnosticSignals(input: {
  doctorChecks: DoctorCheck[];
  logsHealth?: LogsHealth | null;
  browserDiagnostics?: BrowserDiagnostic[];
}): SetupDiagnosticSignal[] {
  const byId = new Map(input.doctorChecks.map((check) => [check.id, check]));
  const signals: SetupDiagnosticSignal[] = [];

  for (const id of ['security-audit', 'channel-config', 'channel-pairing-pending', 'gateway-health', 'cron-health']) {
    const check = byId.get(id);
    if (check) {
      signals.push({
        id: check.id,
        label: check.label,
        status: check.status,
        message: check.message,
        path: issuePath(check.id),
      });
    }
  }

  if (input.logsHealth) {
    const errors = input.logsHealth.stats?.errorsLast24h ?? 0;
    signals.push({
      id: 'logs-health',
      label: 'Logs',
      status: input.logsHealth.shuttingDown ? 'warn' : errors > 0 ? 'warn' : 'pass',
      message: input.logsHealth.shuttingDown
        ? 'Logger is shutting down.'
        : errors > 0
          ? `${errors} error(s) in the last 24 hours.`
          : 'Log system is healthy.',
      path: '/settings/logs',
    });
  }

  for (const item of input.browserDiagnostics ?? []) {
    signals.push(item);
  }

  return signals;
}

export function buildSetupStatusSnapshot(input: {
  hasToken: boolean;
  sseConnected: boolean;
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
  };
}): SetupStatusSnapshot {
  const providerCount = countConfiguredProviders(input.config);
  const providerMetaConfigured = input.providerMeta?.configured ?? providerCount;
  const providerMetaTotal = input.providerMeta?.total ?? 0;
  const providerConfigured =
    providerMetaConfigured > 0 || providerCount > 0;
  const defaultModel = readDefaultModel(input.config);
  const defaultModelConfigured = defaultModel.length > 0;
  const gatewayConnected = input.hasToken && input.sseConnected;
  const channelConfigured = isAnyChannelConfigured(input.config);
  const skillInstalled = input.skillCount > 0;
  const doctorChecks = input.doctorChecks ?? [];
  const issues = buildDoctorIssues(doctorChecks);

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
      path: '/settings/credentials',
    },
    {
      id: 'defaultModel',
      status: statusFromDone(defaultModelConfigured),
      title: 'Default model',
      detail: defaultModelConfigured ? input.labels.modelConfigured(defaultModel) : input.labels.modelMissing,
      path: '/settings/credentials?tab=services',
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

export function readOverviewBrowserDiagnosticsInput(config: unknown): { enabled: boolean; backend: string } {
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
  if (stepLabelKey === 'stepCron') {
    const cron = snapshot.diagnosticSignals.find((signal) => signal.id === 'cron-health');
    return { done: cron?.status === 'pass', status: cron?.status ?? 'skip' };
  }
  return { done: false, status: 'skip' };
}
