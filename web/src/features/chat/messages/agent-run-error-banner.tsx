import { useMemo, useState } from 'react';
import { AlertCircle, Clock, KeyRound, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import {
  parseAgentRunError,
  safeErrorDetail,
  type AgentRunErrorPayload,
} from '@/features/chat/messages/agent-run-error-parser';

type ErrorCopy = { title: string; body: string; cta?: string; deepLink?: string };

function resolveErrorCopy(payload: AgentRunErrorPayload, m: ReturnType<typeof messages>['chat']): ErrorCopy {
  switch (payload.code) {
    case 'provider_setup_required':
      return {
        title: m.providerSetupRequiredTitle,
        body: m.providerSetupRequiredBody.replace(
          '{{provider}}',
          payload.provider ?? m.agentRunErrorUnknownProvider,
        ),
        cta: m.providerSetupRequiredCta,
        deepLink: payload.deepLink ?? '/settings/capabilities/models',
      };
    case 'provider_auth_invalid':
      return {
        title: m.agentRunErrorAuthInvalidTitle,
        body: m.agentRunErrorAuthInvalidBody.replace(
          '{{provider}}',
          payload.provider ?? m.agentRunErrorUnknownProvider,
        ),
        cta: m.agentRunErrorCtaProviders,
        deepLink: payload.deepLink ?? '/settings/capabilities/models',
      };
    case 'rate_limit':
      return { title: m.agentRunErrorRateLimitTitle, body: m.agentRunErrorRateLimitBody };
    case 'timeout':
      return { title: m.agentRunErrorTimeoutTitle, body: m.agentRunErrorTimeoutBody };
    case 'provider_connection_error':
      return { title: m.agentRunErrorConnectionTitle, body: m.agentRunErrorConnectionBody };
    case 'billing':
      return { title: m.agentRunErrorBillingTitle, body: m.agentRunErrorBillingBody };
    case 'credit_budget_exhausted':
      return { title: m.creditBudgetExhaustedTitle, body: m.creditBudgetExhaustedBody, cta: m.creditBudgetSettingsCta, deepLink: '/settings/agent-defaults?panel=runtime' };
    case 'model_quota_exhausted':
      return { title: m.xopcQuotaExhaustedTitle, body: m.xopcQuotaExhaustedBody };
    case 'platform_token_limit_exceeded':
      return {
        title: m.xopcPlatformLimitTitle,
        body: m.xopcPlatformLimitBody,
        cta: m.xopcPlatformLimitCta,
        deepLink: '/settings/capabilities/models?add=1',
      };
    case 'send_failed':
      return { title: m.agentRunErrorSendFailedTitle, body: m.agentRunErrorSendFailedBody };
    case 'session_not_found':
      return {
        title: m.sessionNotFoundTitle,
        body: m.sessionNotFoundBody,
        cta: m.sessionNotFoundCta,
        deepLink: '/chat/new',
      };
    default:
      return { title: m.agentRunErrorUnknownTitle, body: m.agentRunErrorUnknownBody };
  }
}

function ErrorIcon({ code }: { code: string }) {
  const className = 'size-4';
  switch (code) {
    case 'provider_setup_required':
    case 'provider_auth_invalid':
      return <KeyRound className={className} strokeWidth={1.75} />;
    case 'rate_limit':
    case 'timeout':
      return <Clock className={className} strokeWidth={1.75} />;
    case 'billing':
    case 'credit_budget_exhausted':
    case 'model_quota_exhausted':
    case 'platform_token_limit_exceeded':
      return <Wallet className={className} strokeWidth={1.75} />;
    default:
      return <AlertCircle className={className} strokeWidth={1.75} />;
  }
}

function AgentRunErrorCard({ payload, onRetry }: { payload: AgentRunErrorPayload; onRetry?: () => void }) {
  const navigate = useNavigate();
  const language = useLocaleStore((s) => s.language);
  const m = messages(language).chat;
  const [copyStatus, setCopyStatus] = useState('');
  const copy = resolveErrorCopy(payload, m);
  const shellClass = 'border-edge bg-surface-panel';
  const iconShellClass = 'bg-surface-inset text-warning';
  const titleClass = 'text-fg';
  const bodyClass = 'text-fg-muted';
  const detailClass = 'text-fg-muted hover:text-fg';
  const detailPreClass = 'bg-surface-inset text-fg-muted';
  const ctaClass = 'bg-accent text-on-accent hover:bg-accent-hover';
  const recoverable = ['provider_connection_error', 'timeout', 'rate_limit', 'unknown', 'send_failed'].includes(payload.code);
  const quotaExhausted = payload.code === 'model_quota_exhausted';
  const openConsole = (path: string) => window.open(
    `https://console.xopc.ai${path}`,
    '_blank',
    'noopener,noreferrer',
  );

  return (
    <section
      role="alert"
      aria-live="polite"
      className={cn('flex flex-col gap-2 rounded-xl border p-3', shellClass)}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', iconShellClass)}
          aria-hidden
        >
          <ErrorIcon code={payload.code} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className={cn('text-sm font-semibold', titleClass)}>{copy.title}</h3>
          <p className={cn('mt-1 text-xs leading-relaxed', bodyClass)}>{copy.body}</p>
        </div>
      </div>
      {recoverable ? (
        <div className="flex flex-wrap items-center gap-2">
          {onRetry ? (
          <button type="button" className={cn('min-h-9 rounded-md px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent', ctaClass)} onClick={onRetry}>
            {m.runRecovery.retry}
          </button>
          ) : null}
          <button type="button" className="min-h-9 rounded-md px-3 text-xs text-fg-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" onClick={() => navigate('/settings/capabilities/models')}>
            {m.runRecovery.models}
          </button>
        </div>
      ) : quotaExhausted ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" className={cn('inline-flex h-8 items-center rounded-lg px-3 py-1.5 text-xs font-medium transition-colors', ctaClass)} onClick={() => openConsole('/models/credits/purchase')}>
            {m.xopcQuotaPurchaseCta}
          </button>
          <button type="button" className="inline-flex h-8 items-center rounded-lg border border-current px-3 py-1.5 text-xs font-medium transition-colors hover:bg-amber-500/10" onClick={() => openConsole('/models/credits/request')}>
            {m.xopcQuotaRequestCta}
          </button>
          <button type="button" className="inline-flex h-8 items-center rounded-lg border border-current px-3 py-1.5 text-xs font-medium transition-colors hover:bg-amber-500/10" onClick={() => navigate('/settings/capabilities/models?add=1')}>
            {m.xopcQuotaOwnProviderCta}
          </button>
        </div>
      ) : copy.cta && copy.deepLink ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            className={cn(
              'inline-flex h-8 items-center rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50',
              ctaClass,
            )}
            onClick={() => navigate(copy.deepLink!)}
          >
            {copy.cta}
          </button>
        </div>
      ) : null}
      {payload.message ? (
        <details className="group min-w-0 text-xs">
          <summary className={cn('cursor-pointer select-none underline-offset-2', detailClass)}>
            {m.agentRunErrorDetailToggle}
          </summary>
          <pre
            className={cn(
              'mt-2 max-h-40 w-full min-w-0 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words rounded-md p-2 font-mono text-[11px] [overflow-wrap:anywhere]',
              detailPreClass,
            )}
          >
            {safeErrorDetail(payload.message)}
          </pre>
          <button type="button" className="mt-1 min-h-9 rounded-md px-2 text-xs text-fg-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" onClick={async () => {
            try {
              await navigator.clipboard.writeText(safeErrorDetail(payload.message));
              setCopyStatus(m.runRecovery.copied);
            } catch { setCopyStatus(m.runRecovery.copyFailed); }
          }}>
            {m.runRecovery.copyDetails}
          </button>
          <span role="status" aria-live="polite" className="ml-2 text-fg-muted">{copyStatus}</span>
        </details>
      ) : null}
    </section>
  );
}

/** Unified agent-run error banner with i18n and actionable cards. */
export function AgentRunErrorBanner({ errorText, onRetry }: { errorText: string; onRetry?: () => void }) {
  const payload = useMemo(() => parseAgentRunError(errorText), [errorText]);

  if (!payload) return null;


  return (
    <div className="mb-4">
      <AgentRunErrorCard payload={payload} onRetry={onRetry} />
    </div>
  );
}
