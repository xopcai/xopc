import { ChannelsSettingsPanel } from '@/features/settings/channels-settings';

/** Standalone route with main sidebar visible (vs full-screen settings). */
export function ChannelsPage() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain bg-surface-panel [scrollbar-gutter:stable]">
      <ChannelsSettingsPanel />
    </div>
  );
}
