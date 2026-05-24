import { ExternalLink } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ChannelsSettingsMessages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';
import { docsGuidePageUrl } from '@/navigation';

import { ChannelSettingsShell } from './channel-settings-shell';
import type { ChannelCatalogEntry } from './use-channel-catalog';
import type { ChannelHubStatus } from './channel-hub-view-model';

export function ExtensionChannelDetailPanel({
  open,
  onOpenChange,
  entry,
  vm,
  ch,
  language,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: ChannelCatalogEntry;
  vm: { enabled: boolean; connected: boolean; status: ChannelHubStatus };
  ch: ChannelsSettingsMessages;
  language: StoredLanguage;
}) {
  const statusLabel =
    vm.status === 'running'
      ? ch.hubStatusRunning
      : vm.status === 'offline'
        ? ch.hubStatusOffline
        : vm.status === 'disabled'
          ? ch.hubStatusDisabled
          : ch.hubStatusNotConfigured;

  return (
    <ChannelSettingsShell
      presentation="modal"
      open={open}
      onOpenChange={onOpenChange}
      srTitle={entry.title}
      srDescription={entry.subtitle}
      closeAriaLabel={ch.modalCancel}
      headerExtra={
        <div className="border-b border-edge-subtle px-6 pb-4 pt-6 dark:border-edge-subtle">
          <h2 className="text-lg font-semibold tracking-tight text-fg">{entry.title}</h2>
          <p className="mt-1 text-sm text-fg-muted">{entry.subtitle}</p>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-fg-muted">{ch.hubExtensionManageHint}</p>
        <dl className="grid gap-3 text-sm">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{ch.hubExtensionStatusLabel}</dt>
            <dd className="mt-1 text-fg">{statusLabel}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{ch.hubExtensionEnabledLabel}</dt>
            <dd className="mt-1 text-fg">{vm.enabled ? ch.hubExtensionYes : ch.hubExtensionNo}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{ch.hubExtensionConnectedLabel}</dt>
            <dd className="mt-1 text-fg">{vm.connected ? ch.hubExtensionYes : ch.hubExtensionNo}</dd>
          </div>
        </dl>
        <Button type="button" variant="secondary" asChild>
          <a href={docsGuidePageUrl(language, 'channels')} target="_blank" rel="noreferrer">
            {ch.hubViewDocs}
            <ExternalLink className="ml-2 size-3.5" />
          </a>
        </Button>
      </div>
    </ChannelSettingsShell>
  );
}
