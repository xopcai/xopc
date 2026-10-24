import { Cpu } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { AutosaveStatus } from '@/components/ui/autosave-status';
import { SettingsPageSkeleton } from '@/features/settings/settings-loading-skeleton';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-layout';
import type { SettingsAiSetupTarget } from '@/features/settings/settings-ai-setup-action';
import { messages } from '@/i18n/messages';
import type { SettingsSectionId } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

import type { UseAgentDefaultsFormResult } from './use-browser-settings-form';

export function AgentDefaultsRouteLayout(props: {
  sectionId: SettingsSectionId;
  vm: UseAgentDefaultsFormResult;
  children: ReactNode;
  aiSetup?: SettingsAiSetupTarget;
}) {
  const { sectionId, vm, children, aiSetup } = props;
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const a = m.agentSettings;

  const pageTitle = m.settingsSections[sectionId] ?? sectionId;

  const header = <SettingsPageHeader title={pageTitle} aiSetup={aiSetup} subtitle={language === 'zh' ? '连接浏览器，让 AI 帮你完成网页任务。' : 'Connect a browser and let AI help with web tasks.'}
    meta={vm.hasToken && vm.form ? <AutosaveStatus className="mt-2 max-w-full" status={vm.autosaveStatus} error={vm.error} /> : undefined} />;

  if (!vm.hasToken) {
    return (
      <SettingsPageFrame className="max-w-[48rem]" gap="gap-3" padding="px-3 py-10 sm:px-5 xl:px-6">
        {header}
        <div className="flex items-start gap-3 rounded-2xl bg-surface-base p-6">
          <Cpu className="mt-0.5 size-5 shrink-0 text-fg-subtle" strokeWidth={1.75} />
          <div>
            <p className="mt-1 text-sm text-fg-muted">{a.needToken}</p>
          </div>
        </div>
      </SettingsPageFrame>
    );
  }

  if (vm.loading) {
    return (
      <SettingsPageFrame className="max-w-[48rem]" gap="gap-6" padding="px-3 py-8 sm:px-5 xl:px-6">
        {header}
        <SettingsPageSkeleton sections={1} />
      </SettingsPageFrame>
    );
  }

  if (!vm.form) {
    return (
      <SettingsPageFrame className="max-w-[48rem]" gap="gap-3" padding="px-3 py-10 sm:px-5 xl:px-6">
        {header}
        <p className="text-sm text-fg-muted">{vm.error ?? vm.fetchError ?? a.loadError}</p>
        <Button type="button" variant="secondary" onClick={() => void vm.mutate()}>
          {m.logs.refresh}
        </Button>
      </SettingsPageFrame>
    );
  }

  return (
    <SettingsPageFrame className="max-w-[48rem]" gap="gap-6" onBlurCapture={vm.onBlurCapture}>
      {header}

      {vm.error ? (
        <div
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-400"
          role="alert"
        >
          {vm.error}
        </div>
      ) : null}

      <div className="flex min-w-0 flex-col gap-5 pb-8">{children}</div>
    </SettingsPageFrame>
  );
}
