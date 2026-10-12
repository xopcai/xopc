import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { useLocaleStore } from '@/stores/locale-store';
import { useSettingsModeStore } from '@/stores/settings-mode-store';

/** Keep advanced configuration discoverable without changing its saved values. */
export function SettingsAdvancedSection({ title, summary, children }: {
  title: string;
  summary: ReactNode;
  children: ReactNode;
}) {
  const advanced = useSettingsModeStore((state) => state.mode === 'advanced');
  const setMode = useSettingsModeStore((state) => state.setMode);
  const zh = useLocaleStore((state) => state.language) === 'zh';

  if (advanced) return children;

  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-hover/20 p-4">
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-medium text-fg">{title}</h3>
        <div className="mt-1 text-xs leading-5 text-fg-muted">{summary}</div>
      </div>
      <Button type="button" variant="ghost" onClick={() => setMode('advanced')}>
        {zh ? '查看高级设置' : 'Show advanced settings'}
      </Button>
    </section>
  );
}
