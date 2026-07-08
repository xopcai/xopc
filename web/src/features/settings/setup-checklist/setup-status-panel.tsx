import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Circle,
  Info,
  Loader2,
  RefreshCw,
  Stethoscope,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import {
  SettingsFormSection,
  SettingsFormSectionHeader,
} from '@/features/settings/settings-form-section';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-layout';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { useLocaleStore } from '@/stores/locale-store';

import type {
  ReadinessPipelineItem,
  SetupDiagnosticSignal,
  SetupHealthTier,
  SetupIssue,
} from './setup-checklist-state';
import { useSetupChecklist } from './use-setup-checklist';

function statusClass(status: 'pass' | 'warn' | 'fail' | 'skip'): string {
  if (status === 'pass') return 'border-success/30 bg-success-soft text-success';
  if (status === 'warn') return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  if (status === 'fail') return 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300';
  return 'border-edge bg-surface-hover text-fg-muted';
}

function statusIcon(status: 'pass' | 'warn' | 'fail' | 'skip') {
  if (status === 'pass') return CheckCircle2;
  if (status === 'warn') return AlertTriangle;
  if (status === 'fail') return XCircle;
  return Info;
}

function healthMeta(tier: SetupHealthTier, s: ReturnType<typeof messages>['setupStatus']) {
  if (tier === 'blocked') {
    return {
      icon: XCircle,
      className: 'bg-red-500/10 text-red-950 dark:text-red-100',
      title: s.health.blockedTitle,
      body: s.health.blockedBody,
      action: s.health.viewIssues,
      targetId: 'next-steps',
    };
  }
  if (tier === 'attention') {
    return {
      icon: AlertTriangle,
      className: 'bg-amber-500/10 text-amber-950 dark:text-amber-100',
      title: s.health.attentionTitle,
      body: s.health.attentionBody,
      action: s.health.viewIssues,
      targetId: 'next-steps',
    };
  }
  if (tier === 'setup') {
    return {
      icon: Circle,
      className: 'bg-surface-base text-fg shadow-surface',
      title: s.health.setupTitle,
      body: s.health.setupBody,
      action: s.health.continueSetup,
      targetId: 'next-steps',
    };
  }
  return {
    icon: CheckCircle2,
    className: 'bg-success-soft text-success',
    title: s.health.readyTitle,
    body: s.health.readyBody,
    action: s.health.startChat,
    actionPath: '/chat',
  };
}

function HealthBanner({
  tier,
  issueCount,
  onRunDoctor,
  ready,
  doctorRunning,
  doctorRunState,
}: {
  tier: SetupHealthTier;
  issueCount: number;
  onRunDoctor: () => void;
  ready: boolean;
  doctorRunning: boolean;
  doctorRunState: 'idle' | 'success' | 'error';
}) {
  const language = useLocaleStore((state) => state.language);
  const s = messages(language).setupStatus;
  const meta = healthMeta(tier, s);
  const Icon = meta.icon;
  const targetId = 'targetId' in meta && typeof meta.targetId === 'string' ? meta.targetId : null;
  const actionPath = 'actionPath' in meta && typeof meta.actionPath === 'string' ? meta.actionPath : '/chat';
  const action =
    targetId ? (
      <button
        type="button"
        onClick={() => document.getElementById(targetId)?.scrollIntoView({ block: 'start', behavior: 'smooth' })}
        className="inline-flex items-center gap-1 rounded-lg bg-surface-base px-3 py-2 text-sm font-medium text-fg shadow-sm hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {meta.action}
        <ChevronRight className="size-4" aria-hidden />
      </button>
    ) : (
      <Link
        to={actionPath}
        className="inline-flex items-center gap-1 rounded-lg bg-surface-base px-3 py-2 text-sm font-medium text-fg shadow-sm hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {meta.action}
        <ChevronRight className="size-4" aria-hidden />
      </Link>
    );

  return (
    <section className={cn('rounded-xl px-4 py-4', meta.className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{meta.title}</h2>
            <p className="mt-1 text-sm opacity-85">{meta.body}</p>
            <p className="mt-2 text-xs opacity-75">{s.health.issueCount.replace('{{count}}', String(issueCount))}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {action}
          <button
            type="button"
            className={cn(
              'inline-flex items-center gap-2 rounded-lg border border-edge bg-surface-base px-3 py-2 text-sm font-medium text-fg',
              'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              interaction.press,
            )}
            onClick={onRunDoctor}
            disabled={!ready || doctorRunning}
            aria-busy={doctorRunning}
          >
            {doctorRunning ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="size-4" aria-hidden />
            )}
            {doctorRunning ? s.health.runDoctorRunning : s.health.runDoctor}
          </button>
        </div>
      </div>
      <p className="mt-3 text-xs opacity-75" role="status" aria-live="polite">
        {doctorRunning
          ? s.health.doctorRunningMessage
          : doctorRunState === 'success'
            ? s.health.doctorCompleteMessage
            : doctorRunState === 'error'
              ? s.health.doctorFailedMessage
              : s.health.doctorIdleMessage}
      </p>
    </section>
  );
}

function IssueRow({ issue, fixLabel }: { issue: SetupIssue; fixLabel: string }) {
  const Icon = statusIcon(issue.status);
  const content = (
    <>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-fg">{issue.label}</span>
          <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase', statusClass(issue.status))}>
            {issue.status}
          </span>
        </span>
        <span className="mt-1 block text-sm text-fg-muted">{issue.message}</span>
        {issue.hints[0] ? <span className="mt-1 block truncate text-xs text-fg-subtle">{issue.hints[0]}</span> : null}
      </span>
      {issue.path ? (
        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-accent-fg">
          {fixLabel}
          <ChevronRight className="size-4" aria-hidden />
        </span>
      ) : null}
    </>
  );

  if (issue.path) {
    return (
      <Link
        to={issue.path}
        className="flex items-start gap-3 rounded-lg bg-surface-panel/80 px-3 py-3 shadow-surface hover:bg-surface-hover/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {content}
      </Link>
    );
  }

  return <div className="flex items-start gap-3 rounded-lg bg-surface-panel/80 px-3 py-3 shadow-surface">{content}</div>;
}

function ReadinessRow({ item, labels }: { item: ReadinessPipelineItem; labels: Record<string, string> }) {
  const Icon = statusIcon(item.status);
  const title = labels[item.id] ?? item.title;
  const content = (
    <>
      <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-full border', statusClass(item.status))}>
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-fg">{title}</span>
        <span className="mt-0.5 block truncate text-xs text-fg-muted">{item.detail}</span>
      </span>
      {item.path ? <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden /> : null}
    </>
  );

  if (item.path) {
    return (
      <Link
        to={item.path}
        className="flex items-center gap-3 rounded-lg px-3 py-3 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {content}
      </Link>
    );
  }
  return <div className="flex items-center gap-3 rounded-lg px-3 py-3">{content}</div>;
}

function DiagnosticSignalRow({ signal, fixLabel }: { signal: SetupDiagnosticSignal; fixLabel: string }) {
  const Icon = statusIcon(signal.status);
  const content = (
    <>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-fg">{signal.label}</span>
        <span className="mt-0.5 block truncate text-xs text-fg-muted">{signal.message}</span>
      </span>
      <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase', statusClass(signal.status))}>
        {signal.status}
      </span>
      {signal.path ? <span className="sr-only">{fixLabel}</span> : null}
    </>
  );

  if (signal.path) {
    return (
      <Link
        to={signal.path}
        className="flex min-w-0 items-start gap-2 rounded-lg bg-surface-panel/80 px-3 py-2.5 shadow-surface hover:bg-surface-hover/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {content}
      </Link>
    );
  }
  return <div className="flex min-w-0 items-start gap-2 rounded-lg bg-surface-panel/80 px-3 py-2.5 shadow-surface">{content}</div>;
}

export function SetupStatusPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const s = m.setupStatus;
  const { ready, error, snapshot, refresh } = useSetupChecklist();
  const [doctorRunning, setDoctorRunning] = useState(false);
  const [doctorRunState, setDoctorRunState] = useState<'idle' | 'success' | 'error'>('idle');
  const diagnosticAttentionSignals =
    snapshot?.diagnosticSignals.filter((signal) => signal.status === 'fail' || signal.status === 'warn') ?? [];

  const runDoctor = async () => {
    if (doctorRunning || !ready) return;
    setDoctorRunning(true);
    setDoctorRunState('idle');
    try {
      await refresh();
      setDoctorRunState('success');
    } catch {
      setDoctorRunState('error');
    } finally {
      setDoctorRunning(false);
    }
  };

  return (
    <SettingsPageFrame gap="gap-6">
      <SettingsPageHeader
        title={s.title}
        subtitle={s.subtitle}
        actions={
        <button
          type="button"
          className={cn(
            'inline-flex shrink-0 items-center gap-2 rounded-lg border border-edge px-3 py-2 text-sm font-medium text-fg',
            'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            interaction.press,
          )}
          onClick={() => void runDoctor()}
          disabled={!ready || doctorRunning}
          aria-busy={doctorRunning}
        >
          <RefreshCw className={cn('size-4', (!ready || doctorRunning) && 'animate-spin')} aria-hidden />
          {doctorRunning ? s.health.runDoctorRunning : s.refresh}
        </button>
        }
      />

      {error ? (
        <p className="rounded-xl border border-red-300/40 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
          {s.loadError}
        </p>
      ) : null}

      {!ready || !snapshot ? (
        <div className="flex items-center gap-2 text-sm text-fg-muted" aria-busy>
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {s.loading}
        </div>
      ) : (
        <>
          <HealthBanner
            tier={snapshot.healthTier}
            issueCount={snapshot.issues.length}
            ready={ready}
            onRunDoctor={() => void runDoctor()}
            doctorRunning={doctorRunning}
            doctorRunState={doctorRunState}
          />

          <SettingsFormSection id="next-steps">
            <SettingsFormSectionHeader
              icon={snapshot.issues.length ? AlertTriangle : Activity}
              title={s.nextStepsTitle}
              subtitle={snapshot.issues.length ? s.nextStepsIssuesSubtitle : s.nextStepsReadySubtitle}
            />
            {snapshot.issues.length ? (
              <div className="mt-4 flex flex-col gap-2">
                {snapshot.issues.slice(0, 8).map((issue) => (
                  <IssueRow key={`${issue.source}:${issue.id}`} issue={issue} fixLabel={s.fixIssue} />
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-lg bg-surface-panel/80 shadow-surface">
                {snapshot.readiness.map((item) => (
                  <ReadinessRow key={item.id} item={item} labels={s.readinessLabels} />
                ))}
              </div>
            )}
          </SettingsFormSection>

          <SettingsFormSection>
            <SettingsFormSectionHeader
              icon={Stethoscope}
              title={s.diagnosticsTitle}
              subtitle={s.diagnosticsSubtitle}
            />
            {diagnosticAttentionSignals.length ? (
              <div className="mt-4 grid gap-2 md:grid-cols-2">
                {diagnosticAttentionSignals.map((signal) => (
                  <DiagnosticSignalRow key={signal.id} signal={signal} fixLabel={s.fixIssue} />
                ))}
              </div>
            ) : (
              <p className="mt-4 rounded-lg bg-surface-panel/80 px-3 py-3 text-sm text-fg-muted shadow-surface">
                {snapshot.diagnosticSignals.length ? s.diagnosticsAllClear : s.diagnosticsEmpty}
              </p>
            )}
          </SettingsFormSection>
        </>
      )}
    </SettingsPageFrame>
  );
}
