import { ChevronRight, KeyRound, Loader2, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';

import {
  SettingsFormSection,
  SettingsFormSectionHeader,
} from '@/features/settings/settings-form-section';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

import type { CredentialDomainStatus } from './credentials-hub-state';
import { useCredentialsHub } from './use-credentials-hub';

function statusClass(status: CredentialDomainStatus): string {
  switch (status) {
    case 'ready':
      return 'bg-success-soft text-success';
    case 'partial':
      return 'bg-amber-500/15 text-amber-700 dark:text-amber-300';
    case 'notNeeded':
      return 'bg-surface-hover text-fg-muted';
    default:
      return 'bg-surface-hover text-fg-subtle';
  }
}

export function CredentialsHubPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const c = m.credentialsHub;
  const { ready, error, domains, refresh } = useCredentialsHub();

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-lg font-semibold tracking-tight text-fg">{c.title}</h1>
          <p className="text-sm text-fg-muted">{c.subtitle}</p>
        </div>
        <button
          type="button"
          className={cn(
            'inline-flex shrink-0 items-center gap-2 rounded-lg border border-edge px-3 py-2 text-sm font-medium text-fg',
            'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          )}
          onClick={() => void refresh()}
          disabled={!ready}
        >
          <RefreshCw className={cn('size-4', !ready && 'animate-spin')} aria-hidden />
          {c.refresh}
        </button>
      </header>

      {error ? (
        <p className="rounded-xl border border-red-300/40 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
          {c.loadError}
        </p>
      ) : null}

      {!ready || !domains ? (
        <div className="flex items-center gap-2 text-sm text-fg-muted" aria-busy>
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {c.loading}
        </div>
      ) : (
        <SettingsFormSection>
          <SettingsFormSectionHeader icon={KeyRound} title={c.domainsTitle} subtitle={c.domainsSubtitle} />
          <ul className="mt-4 flex flex-col gap-1">
            {domains.map((domain) => {
              const copy = c.domains[domain.id];
              const statusLabel = c.status[domain.status];
              return (
                <li key={domain.id}>
                  <Link
                    to={domain.managePath}
                    className={cn(
                      'flex items-center gap-3 rounded-xl px-3 py-3 transition-colors',
                      'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    )}
                  >
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                        statusClass(domain.status),
                      )}
                    >
                      {statusLabel}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-fg">{copy.title}</span>
                      <span className="mt-0.5 block text-xs text-fg-muted">{copy.description}</span>
                      <span className="mt-1 block truncate text-xs text-fg-subtle">{domain.detail}</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-xs leading-relaxed text-fg-subtle">{c.footerHint}</p>
        </SettingsFormSection>
      )}
    </div>
  );
}
