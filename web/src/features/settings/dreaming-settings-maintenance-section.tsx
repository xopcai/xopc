import { Loader2, Trash2, Unlock, Wrench } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  sectionHeaderTightClass,
  sectionTightClass,
} from '@/features/settings/dreaming-settings-shared.styles';
import {
  type DreamingSettingsI18n,
} from '@/features/settings/dreaming-settings-shared';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import { cn } from '@/lib/cn';

type Props = {
  t: DreamingSettingsI18n;
  disabled: boolean;
  actionBusy: 'reset_store' | 'clear_lock' | null;
  doAction: (action: 'reset_store' | 'clear_lock') => void | Promise<void>;
};

export function DreamingMaintenanceSection({ t, disabled, actionBusy, doAction }: Props) {
  return (
    <SettingsFormSection className={cn('max-w-2xl', sectionTightClass)}>
      <SettingsFormSectionHeader
        className={sectionHeaderTightClass}
        icon={Wrench}
        title={t.maintenanceTitle}
        subtitle={t.maintenanceHint}
      />
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => {
            if (!confirm(t.confirmResetStore)) return;
            void doAction('reset_store');
          }}
        >
          {actionBusy === 'reset_store' ? (
            <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
          ) : (
            <Trash2 className="mr-2 size-4" aria-hidden />
          )}
          {t.resetStore}
        </Button>
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => {
            if (!confirm(t.confirmClearLock)) return;
            void doAction('clear_lock');
          }}
        >
          {actionBusy === 'clear_lock' ? (
            <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
          ) : (
            <Unlock className="mr-2 size-4" aria-hidden />
          )}
          {t.clearLock}
        </Button>
      </div>
    </SettingsFormSection>
  );
}
