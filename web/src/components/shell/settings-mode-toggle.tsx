import { SlidersHorizontal } from 'lucide-react';
import { memo } from 'react';

import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';
import { useSettingsModeStore } from '@/stores/settings-mode-store';

type Props = {
  className?: string;
};

/** Rail footer control — toggles power-user settings navigation items. */
export const SettingsModeToggle = memo(function SettingsModeToggle({ className }: Props) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language).settingsMode;
  const showAdvanced = useSettingsModeStore((s) => s.mode === 'advanced');
  const setShowAdvanced = useSettingsModeStore((s) => s.setShowAdvanced);

  return (
    <div
      className={cn(
        'shrink-0 border-t border-edge-subtle/80 px-4 py-3',
        className,
      )}
    >
      <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-surface-hover/35 px-3 py-2.5 transition-colors hover:bg-surface-hover/55 dark:bg-surface-hover/20 dark:hover:bg-surface-hover/35">
        <SlidersHorizontal className="mt-0.5 size-4 shrink-0 text-fg-muted" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 flex-1 text-sm font-medium text-fg">{m.toggleLabel}</span>
        <input
          type="checkbox"
          className="ui-checkbox mt-0.5 shrink-0"
          checked={showAdvanced}
          onChange={(e) => setShowAdvanced(e.target.checked)}
          aria-label={m.toggleAria}
        />
      </label>
    </div>
  );
});
