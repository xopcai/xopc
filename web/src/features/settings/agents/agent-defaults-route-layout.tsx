import { Cpu } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import type { SettingsSectionId } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

import type { UseAgentDefaultsFormResult } from './use-agent-defaults-form';

export function AgentDefaultsRouteLayout(props: {
  sectionId: SettingsSectionId;
  intro: string;
  vm: UseAgentDefaultsFormResult;
  children: ReactNode;
  /** Merged tabbed page: single page title, per-tab intro below tabs. */
  tabbed?: boolean;
}) {
  const { sectionId, intro, vm, children, tabbed = false } = props;
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const a = m.agentSettings;

  const pageTitle = m.settingsSections[sectionId] ?? sectionId;

  if (!vm.hasToken) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-10">
        <div className="flex items-start gap-3 rounded-2xl bg-surface-base p-6">
          <Cpu className="mt-0.5 size-5 shrink-0 text-fg-subtle" strokeWidth={1.75} />
          <div>
            <h1 className="text-base font-semibold text-fg">{pageTitle}</h1>
            <p className="mt-1 text-sm text-fg-muted">{a.needToken}</p>
          </div>
        </div>
      </div>
    );
  }

  if (vm.loading) {
    return (
      <div className="mx-auto w-full max-w-app-main px-4 py-8">
        <div className="h-8 w-48 animate-pulse rounded bg-surface-hover" />
        <div className="mt-6 h-32 animate-pulse rounded-xl bg-surface-hover" />
        <p className="mt-4 text-sm text-fg-muted">{m.logs.loading}</p>
      </div>
    );
  }

  if (!vm.form) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-10">
        <p className="text-sm text-fg-muted">{vm.error ?? vm.fetchError ?? a.loadError}</p>
        <Button type="button" variant="secondary" onClick={() => void vm.mutate()}>
          {m.logs.refresh}
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-fg">{pageTitle}</h1>
          {!tabbed ? (
            <>
              <p className="mt-1 text-sm leading-relaxed text-fg-muted">{intro}</p>
              <p className="mt-1 text-xs text-fg-subtle">{a.sectionDesc}</p>
            </>
          ) : (
            <p className="mt-1 text-xs text-fg-subtle">{a.sectionDesc}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="secondary" disabled={!vm.dirty || vm.saving} onClick={vm.discard}>
            {a.discard}
          </Button>
          <Button type="button" variant="primary" disabled={!vm.dirty || vm.saving} onClick={() => void vm.save()}>
            {vm.saving ? a.saving : a.save}
          </Button>
        </div>
      </header>

      {vm.error ? (
        <div
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/50 dark:text-red-400"
          role="alert"
        >
          {vm.error}
        </div>
      ) : null}

      <div className="flex min-w-0 flex-col gap-5 pb-8">{children}</div>
    </div>
  );
}
