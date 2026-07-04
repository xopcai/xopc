import { Loader2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { DreamingConfigState } from '@/features/settings/dreaming-config-api';
import { type DreamingSettingsI18n } from '@/features/settings/dreaming-settings-shared';
import { SettingsPageHeader } from '@/features/settings/settings-page-layout';

type Props = {
  t: DreamingSettingsI18n;
  hasToken: boolean;
  cfgForm: DreamingConfigState | null;
  cfgSaving: boolean;
  cfgDirty: boolean;
  saveConfig: () => void | Promise<void>;
  doRefresh: () => void | Promise<void>;
};

export function DreamingHeader({
  t,
  hasToken,
  cfgForm,
  cfgSaving,
  cfgDirty,
  saveConfig,
  doRefresh,
}: Props) {
  return (
    <SettingsPageHeader
      title={t.title}
      subtitle={t.subtitle}
      actions={
        <>
        <Button
          type="button"
          variant="primary"
          disabled={!hasToken || !cfgForm || cfgSaving || !cfgDirty}
          onClick={() => void saveConfig()}
        >
          {cfgSaving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {t.saveConfig}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="size-9 shrink-0 p-0"
          disabled={!hasToken}
          title={t.refresh}
          aria-label={t.refresh}
          onClick={() => void doRefresh()}
        >
          <RefreshCw className="size-4" strokeWidth={1.75} aria-hidden />
        </Button>
        </>
      }
    />
  );
}
