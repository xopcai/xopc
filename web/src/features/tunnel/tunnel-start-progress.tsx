import { Check, Circle, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { TunnelStatusResponse } from '@/features/tunnel/tunnel-api';
import type { TunnelSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';

type StepId = 'preparing_frpc' | 'registering' | 'provisioning_tls' | 'starting_frpc';

function formatByteCount(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const STEP_ORDER: StepId[] = ['preparing_frpc', 'registering', 'provisioning_tls', 'starting_frpc'];

function phaseIndex(phase: StepId | 'reconnecting_frpc' | undefined): number {
  if (!phase) return -1;
  if (phase === 'reconnecting_frpc') return STEP_ORDER.indexOf('starting_frpc');
  return STEP_ORDER.indexOf(phase);
}

function stepState(
  stepId: StepId,
  status: TunnelStatusResponse,
): 'done' | 'active' | 'pending' {
  if (status.state === 'connected') return 'done';
  const current = status.startProgress?.phase;
  const idx = STEP_ORDER.indexOf(stepId);
  const currentIdx = phaseIndex(current);
  if (currentIdx < 0) {
    return status.state === 'connecting' || status.state === 'reconnecting' ? 'active' : 'pending';
  }
  if (idx < currentIdx) return 'done';
  if (idx === currentIdx) return 'active';
  return 'pending';
}

function stepDetail(
  t: TunnelSettingsMessages,
  stepId: StepId,
  status: TunnelStatusResponse,
): string | null {
  const progress = status.startProgress;
  if (stepState(stepId, status) !== 'active') return null;

  if (stepId === 'preparing_frpc' && status.frpcDownload) {
    if (status.frpcDownload.phase === 'extracting') return t.frpcExtracting;
    if (status.frpcDownload.percent != null) {
      return t.frpcDownloadingPercent.replace('{{percent}}', String(status.frpcDownload.percent));
    }
    return t.frpcDownloading;
  }

  if (stepId === 'registering' && progress?.publicUrl) {
    return t.stepRegisterDetail;
  }

  if (stepId === 'provisioning_tls' && progress?.acmeStep) {
    switch (progress.acmeStep) {
      case 'checking':
        return t.stepTlsChecking;
      case 'dns_challenge':
        return t.stepTlsDnsChallenge;
      case 'dns_propagation':
        return t.stepTlsDnsPropagation;
      case 'ca_validation':
        return t.stepTlsCaValidation;
      case 'issuing':
        return t.stepTlsIssuing;
      default:
        return t.stepTlsDetail;
    }
  }

  if (stepId === 'starting_frpc') {
    return progress?.phase === 'reconnecting_frpc' ? t.stepReconnectDetail : t.stepFrpcDetail;
  }

  return null;
}

function stepLabel(t: TunnelSettingsMessages, stepId: StepId): string {
  switch (stepId) {
    case 'preparing_frpc':
      return t.stepPrepareFrpc;
    case 'registering':
      return t.stepRegister;
    case 'provisioning_tls':
      return t.stepTls;
    case 'starting_frpc':
      return t.stepFrpcLogin;
  }
}

export function formatPhaseElapsed(startedAt: string | undefined): string | null {
  if (!startedAt) return null;
  const sec = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

export function TunnelStartProgressPanel({
  status,
  t,
}: {
  status: TunnelStatusResponse;
  t: TunnelSettingsMessages;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (status.state !== 'connecting' && status.state !== 'reconnecting') return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [status.state, status.startProgress?.startedAt]);

  const showSteps =
    status.state === 'connecting' ||
    status.state === 'reconnecting' ||
    (status.state === 'connected' && Boolean(status.startProgress));

  if (!showSteps) return null;

  const e2eEnabled = status.config?.e2e?.enabled !== false;
  const steps = STEP_ORDER.filter((id) => id !== 'provisioning_tls' || e2eEnabled);
  const elapsed = formatPhaseElapsed(status.startProgress?.startedAt);
  const showPendingUrlNotice =
    Boolean(status.publicUrl) &&
    status.state !== 'connected' &&
    status.startProgress?.phase !== 'registering';

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-edge-subtle bg-surface-panel px-3 py-3">
      <div>
        <p className="text-xs font-medium text-fg">{t.startProgressTitle}</p>
        <p className="mt-1 text-xs text-fg-muted">{t.startProgressHint}</p>
      </div>

      <ol className="space-y-2">
        {steps.map((stepId) => {
          const state = stepState(stepId, status);
          const detail = stepDetail(t, stepId, status);
          return (
            <li key={stepId} className="flex gap-2 text-xs">
              <span className="mt-0.5 shrink-0 text-fg-subtle" aria-hidden>
                {state === 'done' ? (
                  <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                ) : state === 'active' ? (
                  <Loader2 className="size-3.5 animate-spin text-accent" />
                ) : (
                  <Circle className="size-3.5" />
                )}
              </span>
              <div className="min-w-0">
                <div
                  className={cn(
                    'font-medium',
                    state === 'active' ? 'text-fg' : state === 'done' ? 'text-fg-muted' : 'text-fg-subtle',
                  )}
                >
                  {stepLabel(t, stepId)}
                </div>
                {detail ? <div className="mt-0.5 text-fg-muted">{detail}</div> : null}
                {stepId === 'preparing_frpc' &&
                state === 'active' &&
                status.frpcDownload &&
                status.frpcDownload.phase === 'downloading' ? (
                  <div className="mt-2 space-y-1">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-panel">
                      <div
                        className={cn(
                          'h-full rounded-full bg-accent transition-[width] duration-300',
                          status.frpcDownload.percent == null && 'w-1/3 animate-pulse',
                        )}
                        style={
                          status.frpcDownload.percent != null
                            ? { width: `${status.frpcDownload.percent}%` }
                            : undefined
                        }
                      />
                    </div>
                    {status.frpcDownload.bytesReceived != null && status.frpcDownload.totalBytes ? (
                      <p className="text-fg-subtle">
                        {formatByteCount(status.frpcDownload.bytesReceived)} /{' '}
                        {formatByteCount(status.frpcDownload.totalBytes)}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {elapsed && status.startProgress ? (
        <p className="text-xs text-fg-subtle">
          {t.startProgressElapsed.replace('{{elapsed}}', elapsed)}
        </p>
      ) : null}

      {showPendingUrlNotice ? (
        <p className="text-xs text-fg-muted">{t.publicUrlPendingNotice}</p>
      ) : null}
    </div>
  );
}
