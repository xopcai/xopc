import { useMemo } from 'react';
import { AlertCircle, Clock, KeyRound, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import {
  parseAgentRunError,
  toProviderSetupPayload,
  type AgentRunErrorPayload,
} from '@/features/chat/messages/agent-run-error-parser';
import { ProviderSetupRequiredCard } from '@/features/chat/messages/provider-setup-required-banner';

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
        deepLink: '/settings/capabilities/models',
      };
    case 'provider_auth_invalid':
      return {
        title: m.agentRunErrorAuthInvalidTitle,
        body: m.agentRunErrorAuthInvalidBody.replace(
          '{{provider}}',
          payload.provider ?? m.agentRunErrorUnknownProvider,
        ),
        cta: m.agentRunErrorCtaProviders,
        deepLink: '/settings/capabilities/models',
      };
    case 'rate_limit':
      return { title: m.agentRunErrorRateLimitTitle, body: m.agentRunErrorRateLimitBody };
    case 'timeout':
      return { title: m.agentRunErrorTimeoutTitle, body: m.agentRunErrorTimeoutBody };
    case 'billing':
      return { title: m.agentRunErrorBillingTitle, body: m.agentRunErrorBillingBody };
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
      return <Wallet className={className} strokeWidth={1.75} />;
    default:
      return <AlertCircle className={className} strokeWidth={1.75} />;
  }
}

function toneForCode(code: string): 'amber' | 'red' {
  if (
    code === 'provider_setup_required' ||
    code === 'provider_auth_invalid' ||
    code === 'rate_limit' ||
    code === 'timeout' ||
    code === 'billing' ||
    code === 'session_not_found'
  ) {
    return 'amber';
  }
  return 'red';
}

function AgentRunErrorCard({ payload }: { payload: AgentRunErrorPayload }) {
  const navigate = useNavigate();
  const language = useLocaleStore((s) => s.language);
  const m = messages(language).chat;
  const copy = resolveErrorCopy(payload, m);
  const tone = toneForCode(payload.code);

  const shellClass =
    tone === 'amber'
      ? 'border-amber-300/60 bg-amber-50/70 dark:border-amber-500/30 dark:bg-amber-500/10'
      : 'border-red-300/60 bg-red-50/70 dark:border-red-500/30 dark:bg-red-500/10';
  const iconShellClass =
    tone === 'amber'
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
      : 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300';
  const titleClass =
    tone === 'amber'
      ? 'text-amber-900 dark:text-amber-100'
      : 'text-red-900 dark:text-red-100';
  const bodyClass =
    tone === 'amber'
      ? 'text-amber-900/85 dark:text-amber-100/80'
      : 'text-red-900/85 dark:text-red-100/80';
  const detailClass =
    tone === 'amber'
      ? 'text-amber-800/80 hover:text-amber-900 dark:text-amber-200/80 dark:hover:text-amber-100'
      : 'text-red-800/80 hover:text-red-900 dark:text-red-200/80 dark:hover:text-red-100';
  const detailPreClass =
    tone === 'amber'
      ? 'bg-amber-100/60 text-amber-900 dark:bg-amber-500/15 dark:text-amber-100'
      : 'bg-red-100/60 text-red-900 dark:bg-red-500/15 dark:text-red-100';
  const ctaClass =
    tone === 'amber'
      ? 'bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-500 dark:text-amber-950 dark:hover:bg-amber-400'
      : 'bg-red-600 text-white hover:bg-red-700 dark:bg-red-500 dark:text-red-950 dark:hover:bg-red-400';

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
      {copy.cta && copy.deepLink ? (
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
            {payload.message}
          </pre>
        </details>
      ) : null}
    </section>
  );
}

/** Unified agent-run error banner with i18n and actionable cards. */
export function AgentRunErrorBanner({ errorText }: { errorText: string }) {
  const payload = useMemo(() => parseAgentRunError(errorText), [errorText]);

  if (!payload) return null;

  const providerPayload = toProviderSetupPayload(payload);
  if (providerPayload) {
    return (
      <div className="mb-4">
        <ProviderSetupRequiredCard payload={providerPayload} />
      </div>
    );
  }

  return (
    <div className="mb-4">
      <AgentRunErrorCard payload={payload} />
    </div>
  );
}

/** @deprecated Use {@link AgentRunErrorBanner} */
export const ProviderSetupRequiredBanner = AgentRunErrorBanner;
