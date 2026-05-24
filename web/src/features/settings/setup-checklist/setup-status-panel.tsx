import { Check, ChevronRight, Circle, Loader2, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';

import {
  SettingsFormSection,
  SettingsFormSectionHeader,
} from '@/features/settings/settings-form-section';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

import type { SetupChecklistItemId } from './setup-checklist-state';
import { useSetupChecklist } from './use-setup-checklist';

const CHECKLIST_PATHS: Record<SetupChecklistItemId, string> = {
  gateway: '/settings/gateway',
  provider: '/settings/providers',
  defaultModel: '/settings/agent-defaults?tab=chat',
  channel: '/channels',
  skill: '/skills',
  presets: '/agents',
};

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        ok ? 'bg-success-soft text-success' : 'bg-surface-hover text-fg-muted',
      )}
    >
      {label}
    </span>
  );
}

export function SetupStatusPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const s = m.setupStatus;
  const { ready, error, snapshot, refresh } = useSetupChecklist();

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-lg font-semibold tracking-tight text-fg">{s.title}</h1>
          <p className="text-sm text-fg-muted">{s.subtitle}</p>
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
          {s.refresh}
        </button>
      </header>

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
          <SettingsFormSection>
            <SettingsFormSectionHeader icon={Check} title={s.summaryTitle} subtitle={s.summarySubtitle} />
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-edge-subtle bg-surface-panel px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{s.summaryGateway}</p>
                <div className="mt-2">
                  <StatusPill
                    ok={snapshot.gatewayConnected}
                    label={snapshot.gatewayConnected ? s.statusOnline : s.statusOffline}
                  />
                </div>
              </div>
              <div className="rounded-xl border border-edge-subtle bg-surface-panel px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{s.summaryProviders}</p>
                <p className="mt-2 truncate text-sm font-medium text-fg">
                  {snapshot.providerConfigured
                    ? snapshot.providerMetaTotal > 0
                      ? s.labels.providersMetaReady
                          .replace('{{configured}}', String(snapshot.providerMetaConfigured))
                          .replace('{{total}}', String(snapshot.providerMetaTotal))
                      : s.labels.providersConfigured.replace('{{count}}', String(snapshot.providerCount))
                    : s.labels.providersMissing}
                </p>
              </div>
              <div className="rounded-xl border border-edge-subtle bg-surface-panel px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{s.summaryModel}</p>
                <p className="mt-2 truncate text-sm font-medium text-fg">
                  {snapshot.defaultModelConfigured
                    ? snapshot.defaultModel
                    : s.labels.modelMissing}
                </p>
              </div>
            </div>
            {snapshot.requiredComplete ? (
              <p className="mt-4 text-sm text-success">{s.requiredCompleteMessage}</p>
            ) : (
              <p className="mt-4 text-sm text-fg-muted">{s.requiredIncompleteMessage}</p>
            )}
          </SettingsFormSection>

          <SettingsFormSection>
            <SettingsFormSectionHeader
              icon={Circle}
              title={s.checklistTitle}
              subtitle={s.checklistSubtitle}
            />
            <ul className="mt-4 flex flex-col gap-1">
              {snapshot.checklist.map((item) => {
                const itemCopy = s.items[item.id];
                return (
                  <li key={item.id}>
                    <Link
                      to={CHECKLIST_PATHS[item.id]}
                      className={cn(
                        'flex items-center gap-3 rounded-xl px-3 py-3 transition-colors',
                        'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                      )}
                    >
                      <span
                        className={cn(
                          'flex size-6 shrink-0 items-center justify-center rounded-full border',
                          item.done
                            ? 'border-success/40 bg-success-soft text-success'
                            : 'border-edge bg-surface-panel text-fg-subtle',
                        )}
                        aria-hidden
                      >
                        {item.done ? <Check className="size-3.5" strokeWidth={2.5} /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-fg">{itemCopy.title}</span>
                          {item.optional ? (
                            <span className="rounded-md bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                              {s.optionalBadge}
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block text-xs text-fg-muted">{itemCopy.description}</span>
                        {item.detail ? (
                          <span className="mt-1 block truncate text-xs text-fg-subtle">{item.detail}</span>
                        ) : null}
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </SettingsFormSection>
        </>
      )}
    </div>
  );
}
