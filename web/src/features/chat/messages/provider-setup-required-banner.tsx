import { KeyRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

import type { ProviderSetupPayload } from '@/features/chat/messages/provider-setup-required.types';

/** Shared card UI for provider setup required — used by both the error banner and assistant message interceptor. */
export function ProviderSetupRequiredCard({ payload }: { payload: ProviderSetupPayload }) {
  const navigate = useNavigate();
  const language = useLocaleStore((s) => s.language);
  const m = messages(language).chat;
  const authInvalid = payload.kind === 'provider_auth_invalid';
  const title = authInvalid ? m.agentRunErrorAuthInvalidTitle : m.providerSetupRequiredTitle;
  const bodyText = (
    authInvalid ? m.agentRunErrorAuthInvalidBody : m.providerSetupRequiredBody
  ).replace('{{provider}}', payload.provider);
  const cta = authInvalid ? m.agentRunErrorCtaProviders : m.providerSetupRequiredCta;
  const detailToggle = authInvalid
    ? m.agentRunErrorDetailToggle
    : m.providerSetupRequiredDetailToggle;

  return (
    <section
      role={authInvalid ? 'alert' : 'status'}
      aria-live="polite"
      className={cn(
        'flex flex-col gap-2 rounded-xl border border-amber-300/60 bg-amber-50/70 px-3 py-3',
        'dark:border-amber-500/30 dark:bg-amber-500/10',
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-lg',
            'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
          )}
          aria-hidden
        >
          <KeyRound className="size-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-100">
            {title}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-amber-900/85 dark:text-amber-100/80">
            {bodyText}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          className={cn(
            'inline-flex h-8 items-center rounded-lg px-3 py-1.5 text-xs font-medium',
            'bg-amber-600 text-white hover:bg-amber-700',
            'dark:bg-amber-500 dark:text-amber-950 dark:hover:bg-amber-400',
            'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50',
          )}
          onClick={() => navigate(payload.deepLink)}
        >
          {cta}
        </button>
      </div>
      {payload.message ? (
        <details className="group min-w-0 text-xs">
          <summary className="cursor-pointer select-none text-amber-800/80 underline-offset-2 hover:text-amber-900 dark:text-amber-200/80 dark:hover:text-amber-100">
            {detailToggle}
          </summary>
          <pre className="mt-2 max-h-40 w-full min-w-0 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words rounded-md bg-amber-100/60 p-2 font-mono text-[11px] text-amber-900 dark:bg-amber-500/15 dark:text-amber-100 [overflow-wrap:anywhere]">
            {payload.message}
          </pre>
        </details>
      ) : null}
    </section>
  );
}

export { AgentRunErrorBanner, ProviderSetupRequiredBanner } from '@/features/chat/messages/agent-run-error-banner';
