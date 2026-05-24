import { AlertCircle, AlertTriangle, Info, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import useSWR, { mutate } from 'swr';

import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import {
  fetchGatewaySecurityAudit,
  gatewaySecurityAuditSwrKey,
  type GatewaySecurityAuditFinding,
  type GatewaySecurityAuditResult,
  type GatewaySecurityAuditSeverity,
  type GatewaySecurityAuditStatus,
} from '@/features/settings/gateway-security-audit-api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { messages, type GatewaySettingsMessages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

type Props = {
  enabled: boolean;
  /** Bump to re-fetch after config save. */
  refreshToken?: number;
};

export function GatewaySecurityAuditCard({ enabled, refreshToken = 0 }: Props) {
  const language = useLocaleStore((s) => s.language);
  const g = messages(language).gatewaySettings;

  const { data, error, isLoading, isValidating, mutate: localMutate } = useSWR(
    enabled ? [gatewaySecurityAuditSwrKey(), refreshToken] : null,
    () => fetchGatewaySecurityAudit(),
    { revalidateOnFocus: false },
  );

  const audit = data ?? null;
  const fetchError = error instanceof Error ? error.message : error ? String(error) : null;
  const refreshing = isLoading || isValidating;

  const refresh = () => {
    void localMutate();
    void mutate(gatewaySecurityAuditSwrKey());
  };

  return (
    <SettingsFormSection>
      <SettingsFormSectionHeader
        icon={ShieldCheck}
        title={g.securityAuditTitle}
        subtitle={g.securityAuditSubtitle}
        trailing={
          <Button
            type="button"
            variant="secondary"
            className="px-2.5 py-1.5 text-xs"
            disabled={!enabled || refreshing}
            onClick={refresh}
          >
            {refreshing ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="size-3.5" aria-hidden />
            )}
            <span className="ml-1.5">{g.securityAuditRefresh}</span>
          </Button>
        }
      />

      <p className="mb-4 text-xs text-fg-subtle">{g.securityAuditSavedConfigHint}</p>

      {fetchError ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {g.securityAuditLoadError}: {fetchError}
        </p>
      ) : null}

      {!fetchError && refreshing && !audit ? (
        <div className="flex items-center gap-2 text-sm text-fg-muted">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {g.securityAuditLoading}
        </div>
      ) : null}

      {audit ? <SecurityAuditBody g={g} audit={audit} /> : null}
    </SettingsFormSection>
  );
}

function SecurityAuditBody({ g, audit }: { g: GatewaySettingsMessages; audit: GatewaySecurityAuditResult }) {
  const summary = statusSummary(g, audit.status, audit.findings);

  return (
    <div className="space-y-4">
      <div
        className={cn(
          'rounded-lg border px-3 py-2.5 text-sm',
          summary.bannerClass,
        )}
        role="status"
      >
        <div className="flex items-start gap-2">
          <summary.icon className={cn('mt-0.5 size-4 shrink-0', summary.iconClass)} aria-hidden />
          <div>
            <p className="font-medium">{summary.title}</p>
            <p className="mt-0.5 text-xs opacity-90">{audit.message}</p>
          </div>
        </div>
      </div>

      {audit.findings.length > 0 ? (
        <ul className="space-y-2">
          {audit.findings.map((finding) => (
            <FindingRow key={finding.checkId} g={g} finding={finding} />
          ))}
        </ul>
      ) : audit.status === 'pass' || audit.status === 'skip' ? (
        <p className="text-xs text-fg-muted">{g.securityAuditNoFindings}</p>
      ) : null}

      {audit.hints.length > 0 ? (
        <div className="space-y-1 border-t border-edge pt-3">
          <p className="text-xs font-medium text-fg-muted">{g.securityAuditHintsTitle}</p>
          <ul className="space-y-1 text-xs text-fg-subtle">
            {audit.hints.map((hint) => (
              <li key={hint} className="font-mono">
                {hint}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function FindingRow({ g, finding }: { g: GatewaySettingsMessages; finding: GatewaySecurityAuditFinding }) {
  const meta = severityMeta(finding.severity);

  return (
    <li className="rounded-lg border border-edge bg-surface-panel/50 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <meta.icon className={cn('mt-0.5 size-4 shrink-0', meta.iconClass)} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-sm font-medium text-fg">{finding.title}</span>
            <span className="font-mono text-[0.65rem] text-fg-subtle">{finding.checkId}</span>
          </div>
          <p className="mt-1 text-xs text-fg-muted">{finding.detail}</p>
          {finding.remediation ? (
            <p className="mt-1.5 text-xs text-fg-subtle">
              <span className="text-fg-muted">{g.securityAuditRemediation}</span> {finding.remediation}
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function severityMeta(severity: GatewaySecurityAuditSeverity) {
  switch (severity) {
    case 'critical':
      return {
        icon: AlertCircle,
        iconClass: 'text-red-600 dark:text-red-400',
      };
    case 'warn':
      return {
        icon: AlertTriangle,
        iconClass: 'text-amber-600 dark:text-amber-400',
      };
    default:
      return {
        icon: Info,
        iconClass: 'text-fg-muted',
      };
  }
}

function statusSummary(
  g: GatewaySettingsMessages,
  status: GatewaySecurityAuditStatus,
  findings: GatewaySecurityAuditFinding[],
) {
  const criticalCount = findings.filter((f) => f.severity === 'critical').length;
  const warnCount = findings.filter((f) => f.severity === 'warn').length;

  if (status === 'fail' || criticalCount > 0) {
    return {
      icon: AlertCircle,
      iconClass: 'text-red-600 dark:text-red-400',
      title: g.securityAuditStatusFail,
      bannerClass:
        'border-red-200 bg-red-50 text-red-950 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100',
    };
  }

  if (status === 'warn' || warnCount > 0) {
    return {
      icon: AlertTriangle,
      iconClass: 'text-amber-600 dark:text-amber-400',
      title: g.securityAuditStatusWarn,
      bannerClass:
        'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100',
    };
  }

  if (status === 'skip') {
    return {
      icon: Info,
      iconClass: 'text-fg-muted',
      title: g.securityAuditStatusSkip,
      bannerClass: 'border-edge bg-surface-panel/60 text-fg',
    };
  }

  return {
    icon: ShieldCheck,
    iconClass: 'text-emerald-600 dark:text-emerald-400',
    title: g.securityAuditStatusPass,
    bannerClass:
      'border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100',
  };
}
