import { Cpu } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-layout';
import { messages } from '@/i18n/messages';
import type { SettingsSectionId } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

import type { UseAgentDefaultsFormResult } from './use-browser-settings-form';

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
      <SettingsPageFrame gap="gap-3" padding="px-3 py-10 sm:px-5 xl:px-6">
        <div className="flex items-start gap-3 rounded-2xl bg-surface-base p-6">
          <Cpu className="mt-0.5 size-5 shrink-0 text-fg-subtle" strokeWidth={1.75} />
          <div>
            <h1 className="text-base font-semibold text-fg">{pageTitle}</h1>
            <p className="mt-1 text-sm text-fg-muted">{a.needToken}</p>
          </div>
        </div>
      </SettingsPageFrame>
    );
  }

  if (vm.loading) {
    return (
      <SettingsPageFrame gap="gap-0" padding="px-3 py-8 sm:px-5 xl:px-6">
        <div className="h-8 w-48 animate-pulse rounded bg-surface-hover" />
        <div className="mt-6 h-32 animate-pulse rounded-xl bg-surface-hover" />
        <p className="mt-4 text-sm text-fg-muted">{m.logs.loading}</p>
      </SettingsPageFrame>
    );
  }

  if (!vm.form) {
    return (
      <SettingsPageFrame gap="gap-3" padding="px-3 py-10 sm:px-5 xl:px-6">
        <p className="text-sm text-fg-muted">{vm.error ?? vm.fetchError ?? a.loadError}</p>
        <Button type="button" variant="secondary" onClick={() => void vm.mutate()}>
          {m.logs.refresh}
        </Button>
      </SettingsPageFrame>
    );
  }

  return (
    <SettingsPageFrame gap="gap-6">
      <SettingsPageHeader
        title={pageTitle}
        subtitle={!tabbed ? intro : undefined}
        meta={<p className="mt-1 text-xs text-fg-subtle">{a.sectionDesc}</p>}
        actions={
          <>
          {vm.saveOk && !vm.dirty ? (
            <span className="text-sm text-fg-muted" role="status">
              {a.saved}
            </span>
          ) : null}
          <Button type="button" variant="secondary" disabled={!vm.dirty || vm.saving} onClick={vm.discard}>
            {a.discard}
          </Button>
          <Button type="button" variant="primary" disabled={!vm.dirty || vm.saving} onClick={() => void vm.save()}>
            {vm.saving ? a.saving : a.save}
          </Button>
          </>
        }
      />

      {vm.error ? (
        <div
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/50 dark:text-red-400"
          role="alert"
        >
          {vm.error}
        </div>
      ) : null}

      <div className="flex min-w-0 flex-col gap-5 pb-8">{children}</div>
    </SettingsPageFrame>
  );
}
