import { ChannelsSettingsPanel } from '@/features/settings/channels-settings';

/** Standalone route with main sidebar visible (vs full-screen settings). Scroll lives in {@link ChannelsSettingsPanel} like cron/skills. */
export function ChannelsPage() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden overscroll-contain [scrollbar-gutter:stable]">
      <ChannelsSettingsPanel />
    </div>
  );
}
