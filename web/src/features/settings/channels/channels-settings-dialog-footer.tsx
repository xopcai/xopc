import { Button } from '@/components/ui/button';
import type { ChannelsSettingsMessages } from '@/i18n/messages';

export function ChannelsSettingsDialogFooter({
  ch,
  dirty,
  saving,
  onCancel,
  onDiscard,
  onSave,
  showCancel = true,
}: {
  ch: ChannelsSettingsMessages;
  dirty: boolean;
  saving: boolean;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void | Promise<void | boolean>;
  showCancel?: boolean;
}) {
  return (
    <div className="sticky bottom-0 shrink-0 border-t border-edge-subtle bg-surface-panel px-6 py-4 dark:border-edge-subtle">
      {dirty ? (
        <p className="mb-3 text-xs text-amber-800 dark:text-amber-200">{ch.unsavedHint}</p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        {showCancel ? (
          <Button type="button" variant="secondary" onClick={onCancel}>
            {ch.modalCancel}
          </Button>
        ) : null}
        <Button type="button" variant="secondary" disabled={!dirty || saving} onClick={onDiscard}>
          {ch.discard}
        </Button>
        <Button type="button" variant="primary" disabled={!dirty || saving} onClick={() => void onSave()}>
          {saving ? ch.saving : ch.save}
        </Button>
      </div>
    </div>
  );
}
